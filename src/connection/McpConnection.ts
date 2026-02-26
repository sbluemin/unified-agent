/**
 * McpConnection - Codex MCP 서버 직접 통합
 * codex mcp-server를 통한 JSON-RPC 통신 + Elicitation 메커니즘
 */

import { execSync } from 'child_process';
import type {
  JsonRpcNotification,
  JsonRpcRequest,
} from '../types/common.js';
import type {
  McpInitializeResult,
  McpTool,
  McpToolCallResult,
  CodexEventParams,
  ElicitationCreateParams,
  ElicitationDecision,
} from '../types/mcp.js';
import { BaseConnection, type BaseConnectionOptions } from './BaseConnection.js';

/** McpConnection 생성 옵션 */
export interface McpConnectionOptions extends BaseConnectionOptions {
  /** 클라이언트 정보 */
  clientInfo?: {
    name: string;
    version: string;
  };
  /** MCP 프로토콜 버전 */
  protocolVersion?: string;
  /** YOLO 모드 (자동 승인) */
  yoloMode?: boolean;
  /** 자동 승인 모드 */
  autoApprove?: boolean;
}

/**
 * Codex MCP 서버 연결 클래스.
 * codex mcp-server를 직접 실행하여 MCP JSON-RPC 프로토콜로 통신합니다.
 */
export class McpConnection extends BaseConnection {
  private readonly clientInfo: { name: string; version: string };
  private readonly protocolVersion: string;
  private readonly yoloMode: boolean;
  private readonly autoApprove: boolean;
  private tools: McpTool[] = [];

  /**
   * 자동 승인 대기열.
   * codex/event(exec_approval_request)가 elicitation/create보다 먼저 올 수 있다.
   */
  private pendingAutoApprovals = new Map<string, ElicitationDecision>();

  constructor(options: McpConnectionOptions) {
    super(options);
    this.clientInfo = options.clientInfo ?? {
      name: 'UnifiedAgent',
      version: '1.0.0',
    };
    this.protocolVersion = options.protocolVersion ?? '2024-11-05';
    this.yoloMode = options.yoloMode ?? false;
    this.autoApprove = options.autoApprove ?? false;
  }

  /**
   * MCP 서버에 연결합니다.
   * 프로세스 spawn → initialize → initialized 알림 전송
   */
  async connect(): Promise<McpInitializeResult> {
    this.spawnProcess();
    this.setState('initializing');

    // 1. initialize 요청
    const result = await this.sendRequest<McpInitializeResult>(
      'initialize',
      {
        protocolVersion: this.protocolVersion,
        capabilities: {
          roots: { listChanged: true },
          sampling: {},
          elicitation: {},
        },
        clientInfo: this.clientInfo,
      },
      this.initTimeout,
    );

    // 2. initialized 알림 전송
    this.sendNotification('notifications/initialized');

    // 3. 도구 목록 조회
    const toolsResult = await this.sendRequest<{ tools: McpTool[] }>(
      'tools/list',
    );
    this.tools = toolsResult?.tools ?? [];

    this.setState('ready');
    return result;
  }

  /**
   * 사용 가능한 도구 목록을 반환합니다.
   */
  getTools(): McpTool[] {
    return [...this.tools];
  }

  /**
   * 도구를 호출합니다.
   *
   * @param name - 도구 이름
   * @param args - 도구 인자
   * @returns 도구 호출 결과
   */
  async callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    return this.sendRequest<McpToolCallResult>('tools/call', {
      name,
      arguments: args ?? {},
    });
  }

  /**
   * Elicitation 요청에 응답합니다.
   *
   * @param requestId - JSON-RPC 요청 ID
   * @param decision - 승인 결정
   */
  respondToElicitation(
    requestId: number,
    decision: ElicitationDecision,
  ): void {
    this.sendResponse(requestId, { decision });
  }

  /**
   * 서버 → 클라이언트 요청 처리 (elicitation/create 등)
   */
  protected handleServerRequest(request: JsonRpcRequest): void {
    switch (request.method) {
      case 'elicitation/create': {
        const params = request.params as unknown as ElicitationCreateParams;
        const callId = params.codex_call_id;

        // Race Condition 대응: 먼저 도착한 자동 승인이 있는지 확인
        if (callId && this.pendingAutoApprovals.has(callId)) {
          const decision = this.pendingAutoApprovals.get(callId)!;
          this.pendingAutoApprovals.delete(callId);
          this.respondToElicitation(request.id, decision);
          return;
        }

        if (this.autoApprove || this.yoloMode) {
          this.respondToElicitation(request.id, 'approved');
        } else {
          this.emit(
            'approvalRequest',
            callId ?? '',
            params.message ?? '',
            (decision: ElicitationDecision) => {
              this.respondToElicitation(request.id, decision);
            },
          );
        }
        break;
      }

      case 'sampling/createMessage': {
        // Sampling 요청은 현재 미지원 — 에러 응답
        this.sendErrorResponse(
          request.id,
          -32601,
          'sampling/createMessage은 현재 지원하지 않습니다',
        );
        break;
      }

      default:
        this.sendErrorResponse(
          request.id,
          -32601,
          `지원하지 않는 메서드: ${request.method}`,
        );
    }
  }

  /**
   * 알림 메시지 처리 (codex/event 등)
   */
  protected handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'codex/event': {
        const params = notification.params as unknown as CodexEventParams;
        this.emit('codexEvent', params);

        // exec_approval_request 자동 승인 처리
        if (
          params?.msg?.type === 'exec_approval_request' &&
          params.msg.call_id &&
          (this.autoApprove || this.yoloMode)
        ) {
          // elicitation/create가 아직 안 온 경우 대기열에 추가
          this.pendingAutoApprovals.set(
            params.msg.call_id,
            'approved',
          );
        }
        break;
      }

      case 'notifications/tools/list_changed': {
        // 도구 목록 재조회
        this.sendRequest<{ tools: McpTool[] }>('tools/list')
          .then((result) => {
            this.tools = result?.tools ?? [];
            this.emit('toolsChanged');
          })
          .catch((err) => {
            this.emit('error', err);
          });
        break;
      }

      default:
        this.emit('notification', notification.method, notification.params);
    }
  }

  /**
   * Codex CLI 버전을 감지하여 MCP 서브커맨드를 결정합니다.
   *
   * @param cliPath - Codex CLI 경로
   * @param env - 환경변수
   * @returns MCP 서브커맨드 인자 배열
   */
  static detectMcpCommand(
    cliPath: string,
    env?: Record<string, string | undefined>,
  ): string[] {
    try {
      const version = execSync(`${cliPath} --version`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe',
        env: env as NodeJS.ProcessEnv,
      }).trim();

      const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        // v0.40.0+ → 'mcp-server', v0.39.x → 'mcp serve'
        return major > 0 || minor >= 40
          ? ['mcp-server']
          : ['mcp', 'serve'];
      }
    } catch {
      // 버전 감지 실패 시 최신 형식 사용
    }
    return ['mcp-server'];
  }

  /**
   * Codex MCP 연결을 위한 인자를 구성합니다.
   *
   * @param cliPath - Codex CLI 경로
   * @param yoloMode - YOLO 모드 여부
   * @param env - 환경변수
   * @returns spawn 인자 배열
   */
  static buildCodexArgs(
    cliPath: string,
    yoloMode = false,
    env?: Record<string, string | undefined>,
  ): string[] {
    const mcpCommand = McpConnection.detectMcpCommand(cliPath, env);
    const args = [...mcpCommand];

    if (yoloMode) {
      args.push('-c', 'approval_policy=never');
    }

    return args;
  }
}
