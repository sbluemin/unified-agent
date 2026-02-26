/**
 * ACP (Agent Communication Protocol) 타입 정의
 * 프로토콜 공식: https://agentclientprotocol.com/get-started/introduction
 */

/** ACP 초기화 요청 파라미터 */
export interface AcpInitializeParams {
  /** 프로토콜 버전 (uint16 숫자, e.g., 1) */
  protocolVersion: number;
  capabilities: Record<string, unknown>;
  clientInfo: {
    name: string;
    version: string;
  };
}

/** ACP 초기화 응답 */
export interface AcpInitializeResult {
  protocolVersion: number;
  capabilities: Record<string, unknown>;
  serverInfo?: {
    name: string;
    version: string;
  };
  /** 인증 방법 목록 */
  authMethods?: Array<{ id: string; name: string; description: string | null }>;
  /** 에이전트 기능 */
  agentCapabilities?: Record<string, unknown>;
}

/** 세션 생성 파라미터 (공식 ACP 스키마) */
export interface AcpSessionNewParams {
  /** 작업 디렉토리 (절대 경로 필수) */
  cwd: string;
  /** MCP 서버 목록 */
  mcpServers: AcpMcpServer[];
}

/** MCP 서버 설정 */
export interface AcpMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
}

/** 세션 생성 응답 */
export interface AcpSessionNewResult {
  sessionId: string;
  configOptions?: AcpConfigOption[];
  models?: string[];
}

/** 설정 옵션 */
export interface AcpConfigOption {
  id: string;
  label: string;
  type: 'boolean' | 'string' | 'enum';
  value?: unknown;
  options?: string[];
}

/** ACP ContentBlock — discriminated union */
export type AcpContentBlock =
  | AcpTextContent
  | AcpImageContent
  | AcpResourceLink;

/** 텍스트 콘텐츠 블록 */
export interface AcpTextContent {
  type: 'text';
  text: string;
}

/** 이미지 콘텐츠 블록 */
export interface AcpImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/** 리소스 링크 블록 */
export interface AcpResourceLink {
  type: 'resource_link';
  uri: string;
  name?: string;
}

/** 프롬프트 전송 파라미터 (공식 ACP 스키마) */
export interface AcpSessionPromptParams {
  sessionId: string;
  /** ContentBlock 배열 */
  prompt: AcpContentBlock[];
}

/**
 * 세션 모드 설정 파라미터
 * @deprecated session/set_config_option (configId: 'mode')을 사용하세요
 */
export interface AcpSessionSetModeParams {
  sessionId: string;
  modeId: string;
}

/**
 * 세션 모델 설정 파라미터
 * @deprecated session/set_config_option (configId: 'model')을 사용하세요
 */
export interface AcpSessionSetModelParams {
  sessionId: string;
  model: string;
}

/** 세션 설정 옵션 변경 파라미터 (공식 ACP 스키마) */
export interface AcpSessionSetConfigParams {
  sessionId: string;
  /** 설정 옵션 ID (e.g., 'model', 'reasoning_effort') */
  configId: string;
  /** 설정 값 ID */
  value: string;
}

/** session/update 알림의 update 타입 */
export type AcpSessionUpdateType =
  | 'agent_message_chunk'
  | 'agent_thought_chunk'
  | 'tool_call'
  | 'tool_call_update'
  | 'plan'
  | 'config_option_update';

/** session/update 알림 파라미터 */
export interface AcpSessionUpdateParams {
  sessionId: string;
  update: AcpSessionUpdate;
}

/** session/update의 update 본체 */
export interface AcpSessionUpdate {
  sessionUpdate: AcpSessionUpdateType;
  /** agent_message_chunk 일 때 텍스트 */
  content?: {
    text?: string;
  };
  /** tool_call 관련 */
  title?: string;
  status?: 'running' | 'completed' | 'failed';
  toolCallId?: string;
  /** plan 관련 */
  plan?: string;
}

/** 권한 요청 파라미터 (Server → Client) */
export interface AcpPermissionRequestParams {
  sessionId: string;
  description: string;
  options: AcpPermissionOption[];
}

/** 권한 요청 옵션 */
export interface AcpPermissionOption {
  optionId: string;
  label: string;
}

/** 권한 응답 (Client → Server) */
export interface AcpPermissionResponse {
  optionId: string;
}

/** 파일 읽기 요청 파라미터 (Server → Client) */
export interface AcpFileReadParams {
  path: string;
}

/** 파일 쓰기 요청 파라미터 (Server → Client) */
export interface AcpFileWriteParams {
  path: string;
  content: string;
}

/** ACP 이벤트 타입 */
export interface AcpEvents {
  /** AI 응답 텍스트 청크 */
  messageChunk: (text: string, sessionId: string) => void;
  /** AI 사고 과정 청크 */
  thoughtChunk: (text: string, sessionId: string) => void;
  /** 도구 호출 */
  toolCall: (title: string, status: string, sessionId: string) => void;
  /** 계획 업데이트 */
  plan: (plan: string, sessionId: string) => void;
  /** 권한 요청 */
  permissionRequest: (params: AcpPermissionRequestParams) => void;
  /** 파일 읽기 요청 */
  fileRead: (params: AcpFileReadParams, respond: (content: string) => void) => void;
  /** 파일 쓰기 요청 */
  fileWrite: (params: AcpFileWriteParams, respond: (success: boolean) => void) => void;
  /** 세션 업데이트 (원자적) */
  sessionUpdate: (update: AcpSessionUpdate, sessionId: string) => void;
}
