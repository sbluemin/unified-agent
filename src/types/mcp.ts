/**
 * MCP (Model Context Protocol) 타입 정의
 * Codex MCP 서버 직접 통합용
 */

/** MCP 초기화 요청 파라미터 */
export interface McpInitializeParams {
  protocolVersion: string;
  capabilities: {
    roots?: { listChanged?: boolean };
    sampling?: Record<string, unknown>;
    elicitation?: Record<string, unknown>;
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

/** MCP 초기화 응답 */
export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: { listChanged?: boolean };
    elicitation?: Record<string, unknown>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

/** MCP 도구 정의 */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** MCP 도구 호출 파라미터 */
export interface McpToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/** MCP 도구 호출 결과 */
export interface McpToolCallResult {
  content: McpContent[];
  isError?: boolean;
}

/** MCP 콘텐츠 */
export interface McpContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

/** Codex 이벤트 알림 (codex/event) */
export interface CodexEventParams {
  msg: {
    type: 'exec_approval_request' | 'exec_result' | 'agent_message' | string;
    call_id?: string;
    [key: string]: unknown;
  };
}

/** Elicitation 생성 요청 파라미터 */
export interface ElicitationCreateParams {
  codex_call_id: string;
  message?: string;
  schema?: Record<string, unknown>;
}

/** Elicitation 응답 결정 */
export type ElicitationDecision =
  | 'approved'
  | 'approved_for_session'
  | 'denied'
  | 'abort';

/** Elicitation 응답 */
export interface ElicitationResponse {
  decision: ElicitationDecision;
}

/** Codex MCP 이벤트 타입 */
export interface McpEvents {
  /** 도구 목록 변경 */
  toolsChanged: () => void;
  /** Codex 이벤트 */
  codexEvent: (params: CodexEventParams) => void;
  /** 실행 승인 요청 */
  approvalRequest: (
    callId: string,
    message: string,
    respond: (decision: ElicitationDecision) => void,
  ) => void;
  /** 도구 호출 결과 */
  toolResult: (result: McpToolCallResult) => void;
}
