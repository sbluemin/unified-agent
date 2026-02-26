/**
 * AcpConnection - ACP (Agent Communication Protocol) 연결 구현
 * Gemini, Claude, Codex(bridge), OpenCode 공통 ACP 프로토콜 통신
 */

import type {
  JsonRpcNotification,
  JsonRpcRequest,
} from '../types/common.js';
import type {
  AcpInitializeResult,
  AcpPermissionRequestParams,
  AcpSessionNewResult,
  AcpSessionPromptParams,
  AcpSessionSetModeParams,
  AcpSessionSetConfigParams,
  AcpSessionUpdateParams,
  AcpFileReadParams,
  AcpFileWriteParams,
} from '../types/acp.js';
import { BaseConnection, type BaseConnectionOptions } from './BaseConnection.js';

/** AcpConnection 생성 옵션 */
export interface AcpConnectionOptions extends BaseConnectionOptions {
  /** 클라이언트 정보 */
  clientInfo?: {
    name: string;
    version: string;
  };
  /** ACP 프로토콜 버전 (uint16 숫자, 기본: 1) */
  protocolVersion?: number;
  /** 자동 권한 승인 여부 */
  autoApprove?: boolean;
}

/** AcpConnection 이벤트 맵 */
export interface AcpConnectionEventMap {
  messageChunk: [text: string, sessionId: string];
  thoughtChunk: [text: string, sessionId: string];
  toolCall: [title: string, status: string, sessionId: string];
  toolCallUpdate: [title: string, status: string, sessionId: string];
  plan: [plan: string, sessionId: string];
  sessionUpdate: [update: AcpSessionUpdateParams];
  permissionRequest: [params: AcpPermissionRequestParams, requestId: number];
  fileRead: [params: AcpFileReadParams, requestId: number];
  fileWrite: [params: AcpFileWriteParams, requestId: number];
  promptComplete: [sessionId: string];
}

/**
 * ACP 프로토콜 연결 클래스.
 * ACP JSON-RPC 2.0 over stdio 프로토콜을 구현합니다.
 */
export class AcpConnection extends BaseConnection {
  private readonly clientInfo: { name: string; version: string };
  private readonly protocolVersion: number;
  private readonly autoApprove: boolean;

  constructor(options: AcpConnectionOptions) {
    super(options);
    this.clientInfo = options.clientInfo ?? {
      name: 'UnifiedAgent',
      version: '1.0.0',
    };
    this.protocolVersion = options.protocolVersion ?? 1;
    this.autoApprove = options.autoApprove ?? false;
  }

  /**
   * ACP 연결을 시작합니다.
   * 프로세스 spawn → initialize → 세션 생성까지 수행합니다.
   *
   * @param workspace - 작업 디렉토리 경로
   * @returns 세션 정보
   */
  async connect(workspace: string): Promise<AcpSessionNewResult> {
    // 1. 프로세스 spawn
    this.spawnProcess();
    this.setState('initializing');

    // 2. initialize 요청 (60초 타임아웃)
    await this.sendRequest<AcpInitializeResult>(
      'initialize',
      {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: this.clientInfo,
      },
      this.initTimeout,
    );

    // 3. 세션 생성 (공식 ACP 스키마: cwd + mcpServers)
    const session = await this.sendRequest<AcpSessionNewResult>(
      'session/new',
      {
        cwd: workspace,
        mcpServers: [],
      },
      this.initTimeout,
    );

    this.setState('ready');
    return session;
  }

  /**
   * 메시지를 전송합니다.
   *
   * @param sessionId - 세션 ID
   * @param content - 메시지 내용
   */
  async sendPrompt(
    sessionId: string,
    content: string,
  ): Promise<void> {
    // 공식 ACP 스키마: prompt는 ContentBlock 배열
    const params: AcpSessionPromptParams = {
      sessionId,
      prompt: [{ type: 'text', text: content }],
    };
    return this.sendRequest(
      'session/prompt',
      params as unknown as Record<string, unknown>,
    );
  }

  /**
   * YOLO 모드(자동 승인)를 설정합니다.
   * session/set_mode RPC를 사용합니다.
   *
   * @param sessionId - 세션 ID
   * @param mode - 모드 ('bypassPermissions' | 'default')
   */
  async setMode(
    sessionId: string,
    mode: string = 'bypassPermissions',
  ): Promise<void> {
    const params: AcpSessionSetModeParams = { sessionId, modeId: mode };
    return this.sendRequest(
      'session/set_mode',
      params as unknown as Record<string, unknown>,
    );
  }

  /**
   * 모델을 변경합니다.
   * session/set_model (primary) → session/set_config_option (fallback)
   * AionUi 구현과 동일한 전략을 사용합니다.
   *
   * @param sessionId - 세션 ID
   * @param model - 모델 이름
   */
  async setModel(sessionId: string, model: string): Promise<void> {
    try {
      // Primary: session/set_model (파라미터: modelId)
      await this.sendRequest(
        'session/set_model',
        { sessionId, modelId: model } as unknown as Record<string, unknown>,
      );
    } catch {
      // Fallback: session/set_config_option
      await this.setConfigOption(sessionId, 'model', model);
    }
  }

  /**
   * 설정 옵션을 변경합니다.
   * ACP session/set_config_option 메서드를 호출합니다.
   *
   * @param sessionId - 세션 ID
   * @param configId - 설정 옵션 ID (e.g., 'model', 'reasoning_effort')
   * @param value - 설정 값 ID
   */
  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<void> {
    const params: AcpSessionSetConfigParams = { sessionId, configId, value };
    return this.sendRequest(
      'session/set_config_option',
      params as unknown as Record<string, unknown>,
    );
  }

  /**
   * 권한 요청에 응답합니다.
   *
   * @param requestId - JSON-RPC 요청 ID
   * @param optionId - 선택한 옵션 ID
   */
  respondToPermission(requestId: number, optionId: string): void {
    this.sendResponse(requestId, { optionId });
  }

  /**
   * 파일 읽기 요청에 응답합니다.
   *
   * @param requestId - JSON-RPC 요청 ID
   * @param content - 파일 내용
   */
  respondToFileRead(requestId: number, content: string): void {
    this.sendResponse(requestId, { content });
  }

  /**
   * 파일 쓰기 요청에 응답합니다.
   *
   * @param requestId - JSON-RPC 요청 ID
   * @param success - 성공 여부
   */
  respondToFileWrite(requestId: number, success: boolean): void {
    this.sendResponse(requestId, { success });
  }

  /**
   * 서버 → 클라이언트 요청 처리 (권한 요청, 파일 I/O)
   */
  protected handleServerRequest(request: JsonRpcRequest): void {
    switch (request.method) {
      case 'session/request_permission': {
        const params = request.params as unknown as AcpPermissionRequestParams;
        if (this.autoApprove && params.options?.length > 0) {
          // 자동 승인: 첫 번째 옵션 선택
          this.respondToPermission(request.id, params.options[0].optionId);
        } else {
          this.emit('permissionRequest', params, request.id);
        }
        break;
      }

      case 'fs/read_text_file': {
        const params = request.params as unknown as AcpFileReadParams;
        this.emit('fileRead', params, request.id);
        break;
      }

      case 'fs/write_text_file': {
        const params = request.params as unknown as AcpFileWriteParams;
        this.emit('fileWrite', params, request.id);
        break;
      }

      default:
        // 알 수 없는 서버 요청은 에러 응답
        this.sendErrorResponse(
          request.id,
          -32601,
          `지원하지 않는 메서드: ${request.method}`,
        );
    }
  }

  /**
   * 알림 메시지 처리 (session/update 등)
   */
  protected handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'session/update': {
        const params = notification.params as unknown as AcpSessionUpdateParams;
        this.emit('sessionUpdate', params);

        if (!params?.update) break;

        const { update } = params;
        const sessionId = params.sessionId;

        switch (update.sessionUpdate) {
          case 'agent_message_chunk':
            if (update.content?.text) {
              this.emit('messageChunk', update.content.text, sessionId);
            }
            break;

          case 'agent_thought_chunk':
            if (update.content?.text) {
              this.emit('thoughtChunk', update.content.text, sessionId);
            }
            break;

          case 'tool_call':
            this.emit(
              'toolCall',
              update.title ?? '',
              update.status ?? '',
              sessionId,
            );
            break;

          case 'tool_call_update':
            this.emit(
              'toolCallUpdate',
              update.title ?? '',
              update.status ?? '',
              sessionId,
            );
            break;

          case 'plan':
            if (update.plan) {
              this.emit('plan', update.plan, sessionId);
            }
            break;
        }
        break;
      }

      default:
        // 기타 알림은 generic 이벤트로 전달
        this.emit('notification', notification.method, notification.params);
    }
  }
}
