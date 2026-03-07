/**
 * UnifiedAgentClient - 통합 에이전트 클라이언트
 * 모든 CLI를 하나의 인터페이스로 통합하는 최상위 클래스
 */

import { EventEmitter } from 'events';
import type { PromptResponse } from '@agentclientprotocol/sdk';
import type {
  CliType,
  UnifiedClientOptions,
  CliDetectionResult,
  AgentMode,
} from '../types/config.js';
import type {
  AcpContentBlock,
  AcpSessionUpdateParams,
  AcpPermissionRequestParams,
  AcpPermissionResponse,
  AcpFileReadParams,
  AcpFileReadResponse,
  AcpFileWriteParams,
  AcpFileWriteResponse,
  AcpSessionNewResult,
} from '../types/acp.js';
import type { ConnectionState } from '../types/common.js';
import type {
  IUnifiedAgentClient,
  ConnectResult,
  ConnectionInfo,
  AvailableModelsResult,
  UnifiedClientEvents,
} from './IUnifiedAgentClient.js';
import { AcpConnection } from '../connection/AcpConnection.js';
import { CliDetector } from '../detector/CliDetector.js';
import {
  createSpawnConfig,
  getBackendConfig,
} from '../config/CliConfigs.js';
import { cleanEnvironment } from '../utils/env.js';

// 인터페이스 파일에서 타입 re-export
export type { UnifiedClientEvents, ConnectResult, ConnectionInfo, AvailableModelsResult, IUnifiedAgentClient } from './IUnifiedAgentClient.js';
export type { ModelInfo } from './IUnifiedAgentClient.js';

/**
 * 통합 에이전트 클라이언트.
 * CLI 자동 감지, ACP 프로토콜 추상화, 이벤트 기반 스트리밍을 제공합니다.
 */
export class UnifiedAgentClient extends EventEmitter implements IUnifiedAgentClient {
  private acpConnection: AcpConnection | null = null;
  private activeCli: CliType | null = null;
  private sessionId: string | null = null;
  private sessionCwd: string | null = null;
  /** session/new 또는 session/load 응답에서 캐싱된 모델 상태 */
  private cachedModels: AvailableModelsResult | null = null;
  private detector = new CliDetector();

  /** 타입 안전한 이벤트 리스너 등록 */
  on<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  /** 타입 안전한 1회성 이벤트 리스너 등록 */
  once<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.once(event, listener);
  }

  /** 타입 안전한 이벤트 리스너 해제 */
  off<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.off(event, listener);
  }

  /** 타입 안전한 이벤트 발생 */
  private emitTyped<K extends keyof UnifiedClientEvents>(
    event: K,
    ...args: UnifiedClientEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * CLI에 연결합니다.
   *
   * @param options - 연결 옵션
   * @returns 연결 결과
   */
  async connect(options: UnifiedClientOptions): Promise<ConnectResult> {
    // 기존 연결 정리
    await this.disconnect();

    // CLI 선택 (명시적 또는 자동 감지)
    let selectedCli: CliType;
    if (options.cli) {
      selectedCli = options.cli;
    } else {
      const preferred = await this.detector.getPreferred();
      if (!preferred) {
        throw new Error(
          '사용 가능한 CLI가 없습니다. gemini, claude, codex, opencode 중 하나를 설치해주세요.',
        );
      }
      selectedCli = preferred.cli;
    }

    return this.connectAcp(selectedCli, options);
  }

  /**
   * ACP 프로토콜로 연결합니다.
   */
  private async connectAcp(
    cli: CliType,
    options: UnifiedClientOptions,
  ): Promise<ConnectResult> {
    const spawnConfig = createSpawnConfig(cli, options);
    const cleanEnv = cleanEnvironment(process.env, options.env);

    const env: Record<string, string | undefined> = { ...cleanEnv };

    this.acpConnection = new AcpConnection({
      command: spawnConfig.command,
      args: spawnConfig.args,
      cwd: options.cwd,
      env,
      requestTimeout: options.timeout,
      initTimeout: options.timeout,
      clientInfo: options.clientInfo,
      autoApprove: options.autoApprove,
    });

    // 이벤트 전파
    this.setupAcpEventForwarding();

    const recentLogs: string[] = [];
    const collectLog = (message: string): void => {
      recentLogs.push(message);
      if (recentLogs.length > 30) {
        recentLogs.shift();
      }
    };
    this.acpConnection.on('log', collectLog);

    let session: AcpSessionNewResult;
    try {
      // 연결 실행
      session = await this.acpConnection.connect(options.cwd);
    } catch (error) {
      const connectionError = this.buildConnectionError(cli, error, recentLogs);
      await this.cleanupFailedAcpConnection();
      throw connectionError;
    } finally {
      this.acpConnection?.off('log', collectLog);
    }

    // YOLO 모드 설정
    if (options.yoloMode && session.sessionId) {
      try {
        await this.acpConnection.setMode(session.sessionId, 'bypassPermissions');
      } catch {
        // YOLO 모드 미지원 CLI인 경우 무시
      }
    }

    // 모델 설정
    if (options.model && session.sessionId) {
      try {
        await this.acpConnection.setModel(session.sessionId, options.model);
      } catch {
        // 모델 설정 미지원 CLI인 경우 무시
      }
    }

    this.activeCli = cli;
    this.sessionId = session.sessionId;
    this.sessionCwd = options.cwd;
    this.updateCachedModels(session);

    return {
      cli,
      protocol: 'acp',
      session,
    };
  }

  /**
   * 메시지를 전송합니다.
   *
   * @param content - 메시지 내용 (텍스트 또는 ACP ContentBlock 배열)
   * @returns 프롬프트 처리 결과
   */
  async sendMessage(content: string | AcpContentBlock[]): Promise<PromptResponse> {
    if (this.acpConnection && this.sessionId) {
      return this.acpConnection.sendPrompt(this.sessionId, content);
    }

    throw new Error('연결되어 있지 않습니다');
  }

  /**
   * 현재 진행 중인 프롬프트를 취소합니다.
   */
  async cancelPrompt(): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.cancelSession(this.sessionId);
  }

  /**
   * 모델을 변경합니다.
   *
   * @param model - 모델 이름
   */
  async setModel(model: string): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.setModel(this.sessionId, model);
  }

  /**
   * 세션 설정 옵션을 변경합니다.
   *
   * @param configId - 설정 옵션 ID
   * @param value - 설정 값
   */
  async setConfigOption(configId: string, value: string): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.setConfigOption(this.sessionId, configId, value);
  }

  /**
   * 에이전트 모드를 설정합니다.
   * CLI별 지원 모드: OpenCode(build/plan), Claude(default/plan/bypassPermissions) 등.
   *
   * @param mode - 모드 ID (e.g., 'build', 'plan', 'bypassPermissions')
   */
  async setMode(mode: string): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.setMode(this.sessionId, mode);
  }

  /**
   * YOLO 모드를 설정합니다.
   * setMode()의 편의 래퍼입니다.
   *
   * @param enabled - 활성화 여부
   */
  async setYoloMode(enabled: boolean): Promise<void> {
    return this.setMode(enabled ? 'bypassPermissions' : 'default');
  }

  /**
   * 현재 CLI에서 사용 가능한 에이전트 모드 목록을 반환합니다.
   *
   * @returns 모드 목록 (모드 미지원 시 빈 배열)
   */
  getAvailableModes(): AgentMode[] {
    if (!this.activeCli) return [];
    const config = getBackendConfig(this.activeCli);
    return config.modes ?? [];
  }

  /**
   * 현재 CLI에서 사용 가능한 모델 목록을 반환합니다.
   * session/new 또는 session/load 응답의 models 필드에서 가져옵니다.
   *
   * @returns 모델 목록 및 현재 모델 (models 미지원 CLI인 경우 null)
   */
  getAvailableModels(): AvailableModelsResult | null {
    return this.cachedModels;
  }

  /**
   * 기존 세션을 로드합니다.
   *
   * @param sessionId - 로드할 세션 ID
   */
  async loadSession(sessionId: string): Promise<void> {
    if (!this.acpConnection) {
      throw new Error('연결되어 있지 않습니다');
    }

    const loaded = await this.acpConnection.loadSession({
      sessionId,
      cwd: this.sessionCwd ?? process.cwd(),
      mcpServers: [],
    });

    this.sessionId = sessionId;
    this.updateCachedModels(loaded);
  }

  /**
   * 사용 가능한 CLI 목록을 감지합니다.
   */
  async detectClis(): Promise<CliDetectionResult[]> {
    return this.detector.detectAll(true);
  }

  /**
   * 연결 정보를 반환합니다.
   */
  getConnectionInfo(): ConnectionInfo {
    const state: ConnectionState = this.acpConnection
      ? this.acpConnection.connectionState
      : 'disconnected';

    return {
      cli: this.activeCli,
      protocol: this.activeCli ? 'acp' : null,
      sessionId: this.sessionId,
      state,
    };
  }

  /**
   * 연결을 닫습니다.
   */
  async disconnect(): Promise<void> {
    if (this.acpConnection) {
      await this.acpConnection.disconnect();
      this.acpConnection.removeAllListeners();
      this.acpConnection = null;
    }

    this.activeCli = null;
    this.sessionId = null;
    this.sessionCwd = null;
    this.cachedModels = null;
  }

  /**
   * ACP 이벤트를 통합 클라이언트로 전파합니다.
   */
  private setupAcpEventForwarding(): void {
    if (!this.acpConnection) return;

    this.acpConnection.on('stateChange', (state: ConnectionState) => {
      this.emitTyped('stateChange', state);
    });
    this.acpConnection.on('userMessageChunk', (text: string, sessionId: string) => {
      this.emitTyped('userMessageChunk', text, sessionId);
    });
    this.acpConnection.on('messageChunk', (text: string, sessionId: string) => {
      this.emitTyped('messageChunk', text, sessionId);
    });
    this.acpConnection.on('thoughtChunk', (text: string, sessionId: string) => {
      this.emitTyped('thoughtChunk', text, sessionId);
    });
    this.acpConnection.on('toolCall', (title: string, status: string, sessionId: string) => {
      this.emitTyped('toolCall', title, status, sessionId);
    });
    this.acpConnection.on('plan', (plan: string, sessionId: string) => {
      this.emitTyped('plan', plan, sessionId);
    });
    this.acpConnection.on('sessionUpdate', (update: AcpSessionUpdateParams) => {
      this.emitTyped('sessionUpdate', update);
    });
    this.acpConnection.on('permissionRequest', (params: AcpPermissionRequestParams, resolve: (response: AcpPermissionResponse) => void) => {
      this.emitTyped('permissionRequest', params, resolve);
    });
    this.acpConnection.on('fileRead', (params: AcpFileReadParams, resolve: (response: AcpFileReadResponse) => void) => {
      this.emitTyped('fileRead', params, resolve);
    });
    this.acpConnection.on('fileWrite', (params: AcpFileWriteParams, resolve: (response: AcpFileWriteResponse) => void) => {
      this.emitTyped('fileWrite', params, resolve);
    });
    this.acpConnection.on('promptComplete', (sessionId: string) => {
      this.emitTyped('promptComplete', sessionId);
    });
    this.acpConnection.on('error', (err: Error) => {
      this.emitTyped('error', err);
    });
    this.acpConnection.on('exit', (code: number | null, signal: string | null) => {
      this.emitTyped('exit', code, signal);
    });
    this.acpConnection.on('log', (msg: string) => {
      this.emitTyped('log', msg);
    });
  }

  /**
   * newSession/loadSession 응답에서 모델 캐시를 갱신합니다.
   */
  private updateCachedModels(session: Pick<AcpSessionNewResult, 'models'>): void {
    if (!session.models) {
      this.cachedModels = null;
      return;
    }

    this.cachedModels = {
      availableModels: session.models.availableModels.map((m) => ({
        modelId: m.modelId,
        name: m.name,
        description: m.description,
      })),
      currentModelId: session.models.currentModelId,
    };
  }

  private async cleanupFailedAcpConnection(): Promise<void> {
    if (!this.acpConnection) {
      return;
    }

    try {
      await this.acpConnection.disconnect();
    } catch {
    }

    this.acpConnection.removeAllListeners();
    this.acpConnection = null;
    this.activeCli = null;
    this.sessionId = null;
    this.sessionCwd = null;
    this.cachedModels = null;
  }

  /**
   * 연결 실패 시 인증 필요 여부를 판별해 사용자가 이해하기 쉬운 에러로 변환합니다.
   */
  private buildConnectionError(cli: CliType, error: unknown, recentLogs: string[]): Error {
    const backend = getBackendConfig(cli);
    if (backend.authRequired && this.isAuthenticationError(error, recentLogs)) {
      return new Error(
        `[${cli}] 인증이 필요하거나 인증이 만료되었습니다. 먼저 해당 CLI에서 로그인/인증을 완료한 뒤 다시 시도해주세요.`,
      );
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(String(error));
  }

  /**
   * 예외/로그 패턴 기반으로 인증 관련 실패를 판별합니다.
   */
  private isAuthenticationError(error: unknown, recentLogs: string[]): boolean {
    const authPatterns = [
      /auth_required/i,
      /authentication required/i,
      /not authenticated/i,
      /please login/i,
      /please log in/i,
      /sign in/i,
      /reauth/i,
      /unauthorized/i,
      /invalid api key/i,
    ];

    if (this.matchAnyPattern(this.extractErrorText(error), authPatterns)) {
      return true;
    }

    return recentLogs.some((log) => this.matchAnyPattern(log, authPatterns));
  }

  /**
   * 에러 객체에서 메시지 분석용 텍스트를 추출합니다.
   */
  private extractErrorText(error: unknown): string {
    if (error instanceof Error) {
      const code = (error as { code?: unknown }).code;
      if (code === -32000) {
        return `auth_required ${error.message}`;
      }
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return String(error);
  }

  /**
   * 문자열이 패턴 목록 중 하나와 일치하는지 검사합니다.
   */
  private matchAnyPattern(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
  }
}
