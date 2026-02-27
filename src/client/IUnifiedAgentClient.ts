/**
 * IUnifiedAgentClient - 통합 에이전트 클라이언트 공개 인터페이스
 *
 * UnifiedAgentClient가 외부에 노출하는 API 계약을 정의합니다.
 * 이벤트 맵, 연결 결과, public 메서드 시그니처를 포함합니다.
 */

import type {
  CliType,
  ProtocolType,
  UnifiedClientOptions,
  CliDetectionResult,
  AgentMode,
} from '../types/config.js';
import type {
  AcpSessionNewResult,
  AcpSessionUpdateParams,
  AcpPermissionRequestParams,
  AcpPermissionResponse,
  AcpFileReadParams,
  AcpFileReadResponse,
  AcpFileWriteParams,
  AcpFileWriteResponse,
} from '../types/acp.js';
import type { ConnectionState } from '../types/common.js';

// ─── 이벤트 맵 ────────────────────────────────────────────

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
  /** ACP 권한 요청 (콜백 기반 응답) */
  permissionRequest: [params: AcpPermissionRequestParams, resolve: (response: AcpPermissionResponse) => void];
  /** 파일 읽기 요청 (콜백 기반 응답) */
  fileRead: [params: AcpFileReadParams, resolve: (response: AcpFileReadResponse) => void];
  /** 파일 쓰기 요청 (콜백 기반 응답) */
  fileWrite: [params: AcpFileWriteParams, resolve: (response: AcpFileWriteResponse) => void];
  /** 에러 */
  error: [error: Error];
  /** 프로세스 종료 */
  exit: [code: number | null, signal: string | null];
  /** 로그 */
  log: [message: string];
}

// ─── 연결 결과 ────────────────────────────────────────────

/** 연결 결과 */
export interface ConnectResult {
  /** 사용한 CLI */
  cli: CliType;
  /** 사용한 프로토콜 */
  protocol: ProtocolType;
  /** ACP 세션 정보 */
  session?: AcpSessionNewResult;
}

// ─── 연결 정보 ────────────────────────────────────────────

/** 연결 정보 */
export interface ConnectionInfo {
  /** 현재 연결된 CLI */
  cli: CliType | null;
  /** 현재 사용 중인 프로토콜 */
  protocol: ProtocolType | null;
  /** 현재 ACP 세션 ID */
  sessionId: string | null;
  /** 연결 상태 */
  state: ConnectionState;
}

// ─── 모델 정보 ────────────────────────────────────────────

/** 사용 가능한 모델 정보 */
export interface ModelInfo {
  /** 모델 고유 식별자 (session/set_model에 전달되는 값) */
  modelId: string;
  /** 사람이 읽을 수 있는 모델 이름 */
  name: string;
  /** 모델 설명 (선택) */
  description?: string | null;
}

/** 사용 가능한 모델 목록 결과 */
export interface AvailableModelsResult {
  /** 사용 가능한 모델 목록 */
  availableModels: ModelInfo[];
  /** 현재 선택된 모델 ID */
  currentModelId: string;
}

// ─── 클라이언트 인터페이스 ──────────────────────────────────

/**
 * 통합 에이전트 클라이언트 인터페이스.
 * CLI 자동 감지, ACP 프로토콜 추상화, 이벤트 기반 스트리밍을 제공합니다.
 */
export interface IUnifiedAgentClient {
  // ─── 연결 관리 ──────────────────────────────────────

  /**
   * CLI에 연결합니다.
   *
   * @param options - 연결 옵션
   * @returns 연결 결과
   */
  connect(options: UnifiedClientOptions): Promise<ConnectResult>;

  /**
   * 연결을 닫습니다.
   */
  disconnect(): Promise<void>;

  /**
   * 연결 정보를 반환합니다.
   */
  getConnectionInfo(): ConnectionInfo;

  /**
   * 사용 가능한 CLI 목록을 감지합니다.
   */
  detectClis(): Promise<CliDetectionResult[]>;

  // ─── 메시지 ──────────────────────────────────────────

  /**
   * 메시지를 전송합니다.
   *
   * @param content - 메시지 내용
   */
  sendMessage(content: string): Promise<void>;

  // ─── 설정 변경 ──────────────────────────────────────

  /**
   * 모델을 변경합니다.
   *
   * @param model - 모델 이름
   */
  setModel(model: string): Promise<void>;

  /**
   * 에이전트 모드를 설정합니다.
   * CLI별 지원 모드: OpenCode(build/plan), Claude(default/plan/bypassPermissions) 등.
   *
   * @param mode - 모드 ID (e.g., 'build', 'plan', 'bypassPermissions')
   */
  setMode(mode: string): Promise<void>;

  /**
   * YOLO 모드를 설정합니다.
   * setMode()의 편의 래퍼입니다.
   *
   * @param enabled - 활성화 여부
   */
  setYoloMode(enabled: boolean): Promise<void>;

  /**
   * 현재 CLI에서 사용 가능한 에이전트 모드 목록을 반환합니다.
   *
   * @returns 모드 목록 (모드 미지원 시 빈 배열)
   */
  getAvailableModes(): AgentMode[];

  // ─── 모델 조회 ──────────────────────────────────────────

  /**
   * 현재 CLI에서 사용 가능한 모델 목록을 반환합니다.
   * session/new 응답의 models 필드에서 가져옵니다.
   *
   * @returns 모델 목록 및 현재 모델 (models 미지원 CLI인 경우 null)
   */
  getAvailableModels(): AvailableModelsResult | null;
}
