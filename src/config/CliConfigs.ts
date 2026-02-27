/**
 * CLI별 설정 정의
 * 각 CLI의 spawn 파라미터와 백엔드 구성을 관리합니다.
 */

import type {
  CliBackendConfig,
  CliSpawnConfig,
  CliType,
  ConnectionOptions,
} from '../types/config.js';
import { resolveNpxPath, buildNpxArgs } from '../utils/npx.js';
import { cleanEnvironment } from '../utils/env.js';

/** ACP 기본 인자 */
const DEFAULT_ACP_ARGS = ['--experimental-acp'];

/** CLI 백엔드 설정 전체 맵 */
export const CLI_BACKENDS: Record<CliType, CliBackendConfig> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini CLI',
    cliCommand: 'gemini',
    protocol: 'acp',
    authRequired: true,
    acpArgs: DEFAULT_ACP_ARGS,
    modes: [
      { id: 'default', label: 'Default' },
      { id: 'autoEdit', label: 'Auto-Accept Edits' },
      { id: 'yolo', label: 'YOLO' },
    ],
  },
  claude: {
    id: 'claude',
    name: 'Anthropic Claude Code',
    cliCommand: 'claude',
    protocol: 'acp',
    authRequired: true,
    npxPackage: '@zed-industries/claude-agent-acp@0.18.0',
    modes: [
      { id: 'default', label: 'Default' },
      { id: 'plan', label: 'Plan' },
      { id: 'bypassPermissions', label: 'YOLO' },
    ],
  },
  codex: {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    cliCommand: 'codex',
    protocol: 'acp',
    authRequired: true,
    npxPackage: '@zed-industries/codex-acp@0.9.4',
    modes: [
      { id: 'default', label: 'Plan' },
      { id: 'autoEdit', label: 'Auto Edit' },
      { id: 'yolo', label: 'Full Auto' },
    ],
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode CLI',
    cliCommand: 'opencode',
    protocol: 'acp',
    authRequired: false,
    acpArgs: ['acp'],
    modes: [
      { id: 'build', label: 'Build' },
      { id: 'plan', label: 'Plan' },
    ],
  },
};

/**
 * CLI별 spawn 설정을 생성합니다.
 *
 * @param cli - CLI 종류
 * @param options - 연결 옵션
 * @returns spawn 설정
 */
export function createSpawnConfig(
  cli: CliType,
  options: ConnectionOptions,
): CliSpawnConfig {
  const backend = CLI_BACKENDS[cli];

  // npx 브릿지 패키지를 사용하는 경우 (Claude, Codex ACP)
  if (backend.npxPackage) {
    const cleanEnv = cleanEnvironment(process.env, options.env);
    const npxPath = resolveNpxPath(cleanEnv);
    const npxArgs = buildNpxArgs(backend.npxPackage);

    return {
      command: npxPath,
      args: npxArgs,
      useNpx: true,
    };
  }

  // CLI를 직접 spawn하는 경우 (Gemini, OpenCode)
  const command = options.cliPath ?? backend.cliCommand;
  const args = backend.acpArgs ? [...backend.acpArgs] : [];

  return {
    command,
    args,
    useNpx: false,
  };
}

/**
 * CLI의 백엔드 설정을 가져옵니다.
 *
 * @param cli - CLI 종류
 * @returns 백엔드 설정
 */
export function getBackendConfig(cli: CliType): CliBackendConfig {
  return CLI_BACKENDS[cli];
}

/**
 * 모든 백엔드 설정을 반환합니다.
 */
export function getAllBackendConfigs(): CliBackendConfig[] {
  return Object.values(CLI_BACKENDS);
}
