/**
 * @sbluemin/unified-agent
 * Codex CLI, Claude Code, Gemini CLI, OpenCode CLI 통합 SDK
 *
 * @example
 * ```typescript
 * import { UnifiedAgentClient } from '@sbluemin/unified-agent';
 *
 * const client = new UnifiedAgentClient();
 * client.on('messageChunk', (text) => process.stdout.write(text));
 * await client.connect({ cwd: '/my/workspace', cli: 'gemini' });
 * await client.sendMessage('이 프로젝트를 분석해줘');
 * ```
 */

// === 통합 클라이언트 ===
export {
  UnifiedAgentClient,
  type UnifiedClientEvents,
  type ConnectResult,
} from './client/UnifiedAgentClient.js';

// === 연결 모듈 ===
export { BaseConnection, type BaseConnectionOptions } from './connection/BaseConnection.js';
export { AcpConnection, type AcpConnectionOptions, type AcpConnectionEventMap } from './connection/AcpConnection.js';
export { McpConnection, type McpConnectionOptions } from './connection/McpConnection.js';

// === CLI 감지 ===
export { CliDetector } from './detector/CliDetector.js';

// === CLI 설정 ===
export {
  CLI_BACKENDS,
  createSpawnConfig,
  createCodexMcpSpawnConfig,
  getBackendConfig,
  getAllBackendConfigs,
} from './config/CliConfigs.js';

// === 타입 ===
export type {
  // 공통
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
  JsonRpcMessage,
  PendingRequest,
  ConnectionState,
  ClientInfo,
  ConnectionEvents,
} from './types/common.js';

export type {
  // ACP
  AcpInitializeParams,
  AcpInitializeResult,
  AcpSessionNewParams,
  AcpSessionNewResult,
  AcpSessionPromptParams,
  AcpSessionSetModeParams,
  AcpSessionSetModelParams,
  AcpSessionSetConfigParams,
  AcpSessionUpdateType,
  AcpSessionUpdateParams,
  AcpSessionUpdate,
  AcpPermissionRequestParams,
  AcpPermissionOption,
  AcpPermissionResponse,
  AcpFileReadParams,
  AcpFileWriteParams,
  AcpEvents,
} from './types/acp.js';

export type {
  // MCP
  McpInitializeParams,
  McpInitializeResult,
  McpTool,
  McpToolCallParams,
  McpToolCallResult,
  McpContent,
  CodexEventParams,
  ElicitationCreateParams,
  ElicitationDecision,
  ElicitationResponse,
  McpEvents,
} from './types/mcp.js';

export type {
  // 설정
  CliType,
  ProtocolType,
  CliSpawnConfig,
  CliBackendConfig,
  ConnectionOptions,
  CliDetectionResult,
  UnifiedClientOptions,
} from './types/config.js';

// === 유틸리티 ===
export { cleanEnvironment, isWindows } from './utils/env.js';
export { killProcess, killProcessGroup } from './utils/process.js';
export { resolveNpxPath, buildNpxArgs } from './utils/npx.js';
