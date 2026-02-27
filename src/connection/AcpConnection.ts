/**
 * AcpConnection - 공식 ACP SDK 기반 연결 구현
 * ClientSideConnection을 래핑하여 Gemini, Claude, Codex, OpenCode 통합 통신
 */

import {
  ClientSideConnection,
  type Client,
  type Agent,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
  type NewSessionResponse,
  type PromptResponse,
} from '@agentclientprotocol/sdk';
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
  sessionUpdate: [update: SessionNotification];
  permissionRequest: [params: RequestPermissionRequest, resolve: (response: RequestPermissionResponse) => void];
  fileRead: [params: ReadTextFileRequest, resolve: (response: ReadTextFileResponse) => void];
  fileWrite: [params: WriteTextFileRequest, resolve: (response: WriteTextFileResponse) => void];
  promptComplete: [sessionId: string];
}

/**
 * ACP 프로토콜 연결 클래스.
 * 공식 ACP SDK의 ClientSideConnection을 래핑하여 통합 이벤트 인터페이스를 제공합니다.
 */
export class AcpConnection extends BaseConnection {
  private readonly clientInfo: { name: string; version: string };
  private readonly protocolVersion: number;
  private readonly autoApprove: boolean;
  private agentProxy: Agent | null = null;

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
   * 프로세스 spawn → ClientSideConnection 생성 → initialize → 세션 생성까지 수행합니다.
   *
   * @param workspace - 작업 디렉토리 경로
   * @returns 세션 정보
   */
  async connect(workspace: string): Promise<NewSessionResponse> {
    // 1. 프로세스 spawn + Web Streams 생성
    const { stream } = this.spawnProcess();
    this.setState('initializing');

    // 2. ClientSideConnection 생성 (Client 인터페이스 구현)
    const connection = new ClientSideConnection(
      (agent: Agent): Client => {
        // Agent 참조 저장 (나중에 RPC 호출용)
        this.agentProxy = agent;
        return this.createClientHandler();
      },
      stream,
    );

    // 연결 종료 감지
    connection.closed.then(() => {
      this.setState('closed');
    });

    // 3. initialize 요청 (공식 SDK 타입: clientCapabilities, clientInfo)
    await this.agentProxy!.initialize({
      protocolVersion: this.protocolVersion,
      clientCapabilities: {},
      clientInfo: this.clientInfo,
    });

    // 4. 세션 생성 (공식 ACP 스키마: cwd + mcpServers)
    const session = await this.agentProxy!.newSession({
      cwd: workspace,
      mcpServers: [],
    });

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
  ): Promise<PromptResponse> {
    if (!this.agentProxy) {
      throw new Error('ACP 연결이 설정되지 않았습니다');
    }
    return this.agentProxy.prompt({
      sessionId,
      prompt: [{ type: 'text', text: content }],
    });
  }

  /**
   * 에이전트 모드를 설정합니다.
   * session/set_mode RPC를 사용합니다.
   *
   * @param sessionId - 세션 ID
   * @param mode - 모드 ('bypassPermissions' | 'default')
   */
  async setMode(
    sessionId: string,
    mode: string = 'bypassPermissions',
  ): Promise<void> {
    if (!this.agentProxy) {
      throw new Error('ACP 연결이 설정되지 않았습니다');
    }
    await this.agentProxy.setSessionMode?.({ sessionId, modeId: mode });
  }

  /**
   * 모델을 변경합니다.
   * session/set_model (primary) → session/set_config_option (fallback)
   *
   * @param sessionId - 세션 ID
   * @param model - 모델 이름
   */
  async setModel(sessionId: string, model: string): Promise<void> {
    if (!this.agentProxy) {
      throw new Error('ACP 연결이 설정되지 않았습니다');
    }
    try {
      // Primary: session/set_model
      await this.agentProxy.unstable_setSessionModel?.({ sessionId, modelId: model });
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
    if (!this.agentProxy) {
      throw new Error('ACP 연결이 설정되지 않았습니다');
    }
    await this.agentProxy.setSessionConfigOption?.({ sessionId, configId, value });
  }

  /**
   * Client 인터페이스 구현체를 생성합니다.
   * Agent → Client 방향의 요청/알림을 이벤트로 전파합니다.
   */
  private createClientHandler(): Client {
    return {
      // 권한 요청 처리
      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        if (this.autoApprove && params.options && params.options.length > 0) {
          // 자동 승인: 첫 번째 옵션 선택
          return {
            outcome: {
              outcome: 'selected',
              optionId: params.options[0].optionId,
            },
          };
        }

        // 이벤트로 전파하고 응답 대기
        return new Promise<RequestPermissionResponse>((resolve) => {
          this.emit('permissionRequest', params, resolve);
        });
      },

      // 세션 업데이트 알림 처리
      sessionUpdate: async (notification: SessionNotification): Promise<void> => {
        this.emit('sessionUpdate', notification);
        this.processSessionUpdate(notification);
      },

      // 파일 읽기 요청 처리
      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        return new Promise<ReadTextFileResponse>((resolve) => {
          this.emit('fileRead', params, resolve);
        });
      },

      // 파일 쓰기 요청 처리
      writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        return new Promise<WriteTextFileResponse>((resolve) => {
          this.emit('fileWrite', params, resolve);
        });
      },
    };
  }

  /**
   * 세션 업데이트 알림을 파싱하여 개별 이벤트를 발생시킵니다.
   */
  private processSessionUpdate(notification: SessionNotification): void {
    if (!notification?.update) return;

    const { update } = notification;
    const sessionId = notification.sessionId;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
      case 'user_message_chunk': {
        // ContentChunk.content는 ContentBlock (TextContent | ImageContent | ...)
        const content = update.content as Record<string, unknown>;
        if (content?.type === 'text' && typeof content?.text === 'string') {
          this.emit('messageChunk', content.text, sessionId);
        }
        break;
      }

      case 'agent_thought_chunk': {
        const content = update.content as Record<string, unknown>;
        if (content?.type === 'text' && typeof content?.text === 'string') {
          this.emit('thoughtChunk', content.text, sessionId);
        }
        break;
      }

      case 'tool_call': {
        this.emit(
          'toolCall',
          update.title ?? '',
          update.status ?? '',
          sessionId,
        );
        break;
      }

      case 'tool_call_update': {
        const toolUpdate = update as Record<string, unknown>;
        this.emit(
          'toolCallUpdate',
          (toolUpdate.title as string) ?? '',
          (toolUpdate.status as string) ?? '',
          sessionId,
        );
        break;
      }

      case 'plan': {
        const entries = update.entries;
        if (entries) {
          this.emit('plan', JSON.stringify(entries), sessionId);
        }
        break;
      }
    }
  }
}
