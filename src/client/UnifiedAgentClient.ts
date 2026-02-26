/**
 * UnifiedAgentClient - 통합 에이전트 클라이언트
 * 모든 CLI를 하나의 인터페이스로 통합하는 최상위 클래스
 */

import { EventEmitter } from 'events';
import type {
  CliType,
  ProtocolType,
  UnifiedClientOptions,
  CliDetectionResult,
} from '../types/config.js';
import type {
  AcpSessionNewResult,
  AcpSessionUpdateParams,
  AcpPermissionRequestParams,
  AcpFileReadParams,
  AcpFileWriteParams,
} from '../types/acp.js';
import type {
  McpInitializeResult,
  McpTool,
  McpToolCallResult,
  ElicitationDecision,
  CodexEventParams,
} from '../types/mcp.js';
import type { ConnectionState } from '../types/common.js';
import { AcpConnection } from '../connection/AcpConnection.js';
import { McpConnection } from '../connection/McpConnection.js';
import { CliDetector } from '../detector/CliDetector.js';
import {
  createSpawnConfig,
  createCodexMcpSpawnConfig,
} from '../config/CliConfigs.js';
import { cleanEnvironment } from '../utils/env.js';

/** 통합 클라이언트 이벤트 맵 */
export interface UnifiedClientEvents {
  /** 연결 상태 변경 */
  stateChange: [state: ConnectionState];
  /** AI 응답 텍스트 청크 (스트리밍) */
  messageChunk: [text: string, sessionId: string];
  /** AI 사고 과정 청크 */
  thoughtChunk: [text: string, sessionId: string];
  /** 도구 호출 */
  toolCall: [title: string, status: string, sessionId: string];
  /** 계획 업데이트 */
  plan: [plan: string, sessionId: string];
  /** ACP 세션 업데이트 (원자적) */
  sessionUpdate: [update: AcpSessionUpdateParams];
  /** ACP 권한 요청 */
  permissionRequest: [params: AcpPermissionRequestParams, requestId: number];
  /** 파일 읽기 요청 */
  fileRead: [params: AcpFileReadParams, requestId: number];
  /** 파일 쓰기 요청 */
  fileWrite: [params: AcpFileWriteParams, requestId: number];
  /** MCP 승인 요청 */
  approvalRequest: [
    callId: string,
    message: string,
    respond: (decision: ElicitationDecision) => void,
  ];
  /** Codex 이벤트 */
  codexEvent: [params: CodexEventParams];
  /** 도구 목록 변경 */
  toolsChanged: [];
  /** 에러 */
  error: [error: Error];
  /** 프로세스 종료 */
  exit: [code: number | null, signal: string | null];
  /** 로그 */
  log: [message: string];
}

/** 연결 결과 */
export interface ConnectResult {
  /** 사용한 CLI */
  cli: CliType;
  /** 사용한 프로토콜 */
  protocol: ProtocolType;
  /** ACP 세션 정보 (ACP 연결인 경우) */
  session?: AcpSessionNewResult;
  /** MCP 초기화 결과 (MCP 연결인 경우) */
  mcpResult?: McpInitializeResult;
}

/**
 * 통합 에이전트 클라이언트.
 * CLI 자동 감지, ACP/MCP 프로토콜 추상화, 이벤트 기반 스트리밍을 제공합니다.
 */
export class UnifiedAgentClient extends EventEmitter {
  private acpConnection: AcpConnection | null = null;
  private mcpConnection: McpConnection | null = null;
  private activeCli: CliType | null = null;
  private activeProtocol: ProtocolType | null = null;
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

    // Codex MCP 직접 연결 여부 결정
    const useCodexMcp =
      selectedCli === 'codex' && options.codexProtocol === 'mcp';

    if (useCodexMcp) {
      return this.connectCodexMcp(selectedCli, options);
    } else {
      return this.connectAcp(selectedCli, options);
    }
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

    // Codex MCP용 환경변수 추가
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
    this.activeProtocol = 'acp';
    this.sessionId = session.sessionId;

    return {
      cli,
      protocol: 'acp',
      session,
    };
  }

  /**
   * Codex MCP 프로토콜로 직접 연결합니다.
   */
  private async connectCodexMcp(
    cli: CliType,
    options: UnifiedClientOptions,
  ): Promise<ConnectResult> {
    const spawnConfig = createCodexMcpSpawnConfig(options);
    const cleanEnv = cleanEnvironment(process.env, options.env);

    const env: Record<string, string | undefined> = {
      ...cleanEnv,
      CODEX_NO_INTERACTIVE: '1',
      CODEX_AUTO_CONTINUE: '1',
    };

    this.mcpConnection = new McpConnection({
      command: spawnConfig.command,
      args: spawnConfig.args,
      cwd: options.cwd,
      env,
      requestTimeout: options.timeout,
      clientInfo: options.clientInfo,
      yoloMode: options.yoloMode,
      autoApprove: options.autoApprove,
    });

    // 이벤트 전파
    this.setupMcpEventForwarding();

    // 연결 실행
    const result = await this.mcpConnection.connect();

    this.activeCli = cli;
    this.activeProtocol = 'mcp';

    return {
      cli,
      protocol: 'mcp',
      mcpResult: result,
    };
  }

  /**
   * 메시지를 전송합니다 (ACP 모드).
   *
   * @param content - 메시지 내용
   */
  async sendMessage(content: string): Promise<void> {
    if (this.activeProtocol === 'acp' && this.acpConnection && this.sessionId) {
      return this.acpConnection.sendPrompt(this.sessionId, content);
    }

    if (this.activeProtocol === 'mcp' && this.mcpConnection) {
      // MCP 모드에서는 codex_chat 도구를 호출
      await this.mcpConnection.callTool('codex_chat', { message: content });
      return;
    }

    throw new Error('연결되어 있지 않습니다');
  }

  /**
   * 도구를 호출합니다 (MCP 모드).
   *
   * @param name - 도구 이름
   * @param args - 도구 인자
   * @returns 도구 호출 결과
   */
  async callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    if (this.activeProtocol !== 'mcp' || !this.mcpConnection) {
      throw new Error('MCP 모드에서만 도구를 직접 호출할 수 있습니다');
    }

    return this.mcpConnection.callTool(name, args);
  }

  /**
   * 사용 가능한 도구 목록을 반환합니다 (MCP 모드).
   */
  getTools(): McpTool[] {
    if (this.activeProtocol !== 'mcp' || !this.mcpConnection) {
      return [];
    }
    return this.mcpConnection.getTools();
  }

  /**
   * 모델을 변경합니다 (ACP 모드).
   *
   * @param model - 모델 이름
   */
  async setModel(model: string): Promise<void> {
    if (this.activeProtocol !== 'acp' || !this.acpConnection || !this.sessionId) {
      throw new Error('ACP 모드에서만 모델을 변경할 수 있습니다');
    }
    return this.acpConnection.setModel(this.sessionId, model);
  }

  /**
   * YOLO 모드를 설정합니다 (ACP 모드).
   *
   * @param enabled - 활성화 여부
   */
  async setYoloMode(enabled: boolean): Promise<void> {
    if (this.activeProtocol !== 'acp' || !this.acpConnection || !this.sessionId) {
      throw new Error('ACP 모드에서만 YOLO 모드를 설정할 수 있습니다');
    }
    return this.acpConnection.setMode(
      this.sessionId,
      enabled ? 'bypassPermissions' : 'default',
    );
  }

  /**
   * ACP 권한 요청에 응답합니다.
   *
   * @param requestId - 요청 ID
   * @param optionId - 선택한 옵션 ID
   */
  respondToPermission(requestId: number, optionId: string): void {
    if (!this.acpConnection) {
      throw new Error('ACP 연결이 없습니다');
    }
    this.acpConnection.respondToPermission(requestId, optionId);
  }

  /**
   * ACP 파일 읽기 요청에 응답합니다.
   */
  respondToFileRead(requestId: number, content: string): void {
    if (!this.acpConnection) {
      throw new Error('ACP 연결이 없습니다');
    }
    this.acpConnection.respondToFileRead(requestId, content);
  }

  /**
   * ACP 파일 쓰기 요청에 응답합니다.
   */
  respondToFileWrite(requestId: number, success: boolean): void {
    if (!this.acpConnection) {
      throw new Error('ACP 연결이 없습니다');
    }
    this.acpConnection.respondToFileWrite(requestId, success);
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
  getConnectionInfo(): {
    cli: CliType | null;
    protocol: ProtocolType | null;
    sessionId: string | null;
    state: ConnectionState;
  } {
    let state: ConnectionState = 'disconnected';
    if (this.acpConnection) {
      state = this.acpConnection.connectionState;
    } else if (this.mcpConnection) {
      state = this.mcpConnection.connectionState;
    }

    return {
      cli: this.activeCli,
      protocol: this.activeProtocol,
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

    if (this.mcpConnection) {
      await this.mcpConnection.disconnect();
      this.mcpConnection.removeAllListeners();
      this.mcpConnection = null;
    }

    this.activeCli = null;
    this.activeProtocol = null;
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
    this.acpConnection.on('permissionRequest', (params: AcpPermissionRequestParams, id: number) => {
      this.emit('permissionRequest', params, id);
    });
    this.acpConnection.on('fileRead', (params: AcpFileReadParams, id: number) => {
      this.emit('fileRead', params, id);
    });
    this.acpConnection.on('fileWrite', (params: AcpFileWriteParams, id: number) => {
      this.emit('fileWrite', params, id);
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

  /**
   * MCP 이벤트를 통합 클라이언트로 전파합니다.
   */
  private setupMcpEventForwarding(): void {
    if (!this.mcpConnection) return;

    this.mcpConnection.on('stateChange', (state: ConnectionState) => {
      this.emit('stateChange', state);
    });
    this.mcpConnection.on('codexEvent', (params: CodexEventParams) => {
      this.emit('codexEvent', params);
    });
    this.mcpConnection.on('approvalRequest', (callId: string, message: string, respond: (d: ElicitationDecision) => void) => {
      this.emit('approvalRequest', callId, message, respond);
    });
    this.mcpConnection.on('toolsChanged', () => {
      this.emit('toolsChanged');
    });
    this.mcpConnection.on('error', (err: Error) => {
      this.emit('error', err);
    });
    this.mcpConnection.on('exit', (code: number | null, signal: string | null) => {
      this.emit('exit', code, signal);
    });
    this.mcpConnection.on('log', (msg: string) => {
      this.emit('log', msg);
    });
  }
}
