/**
 * UnifiedAgentClient - 통합 에이전트 클라이언트
 * 모든 CLI를 하나의 인터페이스로 통합하는 최상위 클래스
 */

import { EventEmitter } from 'events';
import type {
  CliType,
  UnifiedClientOptions,
  CliDetectionResult,
  AgentMode,
} from '../types/config.js';
import type {
  AcpSessionUpdateParams,
  AcpPermissionRequestParams,
  AcpPermissionResponse,
  AcpFileReadParams,
  AcpFileReadResponse,
  AcpFileWriteParams,
  AcpFileWriteResponse,
} from '../types/acp.js';
import type { ConnectionState } from '../types/common.js';
import type {
  IUnifiedAgentClient,
  ConnectResult,
  ConnectionInfo,
} from './IUnifiedAgentClient.js';
import { AcpConnection } from '../connection/AcpConnection.js';
import { CliDetector } from '../detector/CliDetector.js';
import {
  createSpawnConfig,
  getBackendConfig,
} from '../config/CliConfigs.js';
import { cleanEnvironment } from '../utils/env.js';

// 인터페이스 파일에서 타입 re-export
export type { UnifiedClientEvents, ConnectResult, ConnectionInfo, IUnifiedAgentClient } from './IUnifiedAgentClient.js';

/**
 * 통합 에이전트 클라이언트.
 * CLI 자동 감지, ACP 프로토콜 추상화, 이벤트 기반 스트리밍을 제공합니다.
 */
export class UnifiedAgentClient extends EventEmitter implements IUnifiedAgentClient {
  private acpConnection: AcpConnection | null = null;
  private activeCli: CliType | null = null;
  private sessionId: string | null = null;
  private detector = new CliDetector();

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
      clientInfo: options.clientInfo,
      autoApprove: options.autoApprove,
    });

    // 이벤트 전파
    this.setupAcpEventForwarding();

    // 연결 실행
    const session = await this.acpConnection.connect(options.cwd);

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

    return {
      cli,
      protocol: 'acp',
      session,
    };
  }

  /**
   * 메시지를 전송합니다.
   *
   * @param content - 메시지 내용
   */
  async sendMessage(content: string): Promise<void> {
    if (this.acpConnection && this.sessionId) {
      await this.acpConnection.sendPrompt(this.sessionId, content);
      return;
    }

    throw new Error('연결되어 있지 않습니다');
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
  }

  /**
   * ACP 이벤트를 통합 클라이언트로 전파합니다.
   */
  private setupAcpEventForwarding(): void {
    if (!this.acpConnection) return;

    this.acpConnection.on('stateChange', (state: ConnectionState) => {
      this.emit('stateChange', state);
    });
    this.acpConnection.on('messageChunk', (text: string, sessionId: string) => {
      this.emit('messageChunk', text, sessionId);
    });
    this.acpConnection.on('thoughtChunk', (text: string, sessionId: string) => {
      this.emit('thoughtChunk', text, sessionId);
    });
    this.acpConnection.on('toolCall', (title: string, status: string, sessionId: string) => {
      this.emit('toolCall', title, status, sessionId);
    });
    this.acpConnection.on('plan', (plan: string, sessionId: string) => {
      this.emit('plan', plan, sessionId);
    });
    this.acpConnection.on('sessionUpdate', (update: AcpSessionUpdateParams) => {
      this.emit('sessionUpdate', update);
    });
    this.acpConnection.on('permissionRequest', (params: AcpPermissionRequestParams, resolve: (response: AcpPermissionResponse) => void) => {
      this.emit('permissionRequest', params, resolve);
    });
    this.acpConnection.on('fileRead', (params: AcpFileReadParams, resolve: (response: AcpFileReadResponse) => void) => {
      this.emit('fileRead', params, resolve);
    });
    this.acpConnection.on('fileWrite', (params: AcpFileWriteParams, resolve: (response: AcpFileWriteResponse) => void) => {
      this.emit('fileWrite', params, resolve);
    });
    this.acpConnection.on('error', (err: Error) => {
      this.emit('error', err);
    });
    this.acpConnection.on('exit', (code: number | null, signal: string | null) => {
      this.emit('exit', code, signal);
    });
    this.acpConnection.on('log', (msg: string) => {
      this.emit('log', msg);
    });
  }
}
