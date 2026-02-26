import { describe, it, expect } from 'vitest';
import {
  CLI_BACKENDS,
  createSpawnConfig,
  getBackendConfig,
  getAllBackendConfigs,
} from '../../src/config/CliConfigs.js';
import type { ConnectionOptions } from '../../src/types/config.js';

const defaultOpts: ConnectionOptions = { cwd: '/tmp/test' };

describe('CLI_BACKENDS', () => {
  it('4개 CLI 설정이 정의되어야 합니다', () => {
    expect(Object.keys(CLI_BACKENDS)).toEqual(['gemini', 'claude', 'codex', 'opencode']);
  });

  it('gemini는 --experimental-acp 인자를 사용해야 합니다', () => {
    expect(CLI_BACKENDS.gemini.acpArgs).toContain('--experimental-acp');
  });

  it('claude는 npx 브릿지 패키지를 사용해야 합니다', () => {
    expect(CLI_BACKENDS.claude.npxPackage).toContain('claude-agent-acp');
  });

  it('codex는 npx 브릿지와 mcp 모두 지원해야 합니다', () => {
    expect(CLI_BACKENDS.codex.npxPackage).toContain('codex-acp');
    expect(CLI_BACKENDS.codex.mcpCommand).toBeDefined();
  });

  it('opencode는 acp 서브커맨드를 사용해야 합니다', () => {
    expect(CLI_BACKENDS.opencode.acpArgs).toEqual(['acp']);
  });
});

describe('createSpawnConfig', () => {
  it('gemini 설정을 올바르게 생성해야 합니다', () => {
    const config = createSpawnConfig('gemini', defaultOpts);
    expect(config.command).toBe('gemini');
    expect(config.args).toContain('--experimental-acp');
    expect(config.useNpx).toBe(false);
  });

  it('opencode 설정을 올바르게 생성해야 합니다', () => {
    const config = createSpawnConfig('opencode', defaultOpts);
    expect(config.command).toBe('opencode');
    expect(config.args).toEqual(['acp']);
    expect(config.useNpx).toBe(false);
  });

  it('claude는 npx를 사용해야 합니다', () => {
    const config = createSpawnConfig('claude', defaultOpts);
    expect(config.useNpx).toBe(true);
    expect(config.args).toContain('--yes');
  });

  it('커스텀 cliPath를 사용할 수 있어야 합니다', () => {
    const config = createSpawnConfig('gemini', {
      ...defaultOpts,
      cliPath: '/custom/path/gemini',
    });
    expect(config.command).toBe('/custom/path/gemini');
  });
});

describe('getBackendConfig / getAllBackendConfigs', () => {
  it('특정 백엔드 설정을 반환해야 합니다', () => {
    expect(getBackendConfig('gemini').id).toBe('gemini');
  });

  it('모든 백엔드 설정을 반환해야 합니다', () => {
    expect(getAllBackendConfigs().length).toBe(4);
  });
});
