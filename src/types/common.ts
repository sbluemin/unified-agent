/**
 * JSON-RPC 2.0 공통 타입 정의
 */

/** JSON-RPC 2.0 요청 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 응답 */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: JsonRpcError;
}

/** JSON-RPC 2.0 알림 (id 없음) */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 에러 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC 메시지 유니온 타입 */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/** 보류 중인 요청 추적 */
export interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  method: string;
  timer: ReturnType<typeof setTimeout>;
}

/** 연결 상태 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'initializing'
  | 'ready'
  | 'error'
  | 'closed';

/** 클라이언트 정보 */
export interface ClientInfo {
  name: string;
  version: string;
}

/** 연결 이벤트 타입 */
export interface ConnectionEvents {
  /** 상태 변경 */
  stateChange: (state: ConnectionState) => void;
  /** 에러 발생 */
  error: (error: Error) => void;
  /** 프로세스 종료 */
  exit: (code: number | null, signal: string | null) => void;
  /** stderr 로그 */
  log: (message: string) => void;
  /** 알림 수신 */
  notification: (method: string, params?: Record<string, unknown>) => void;
}
