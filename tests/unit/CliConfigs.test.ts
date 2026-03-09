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
  it('3개 CLI 설정이 정의되어야 합니다', () => {
    expect(Object.keys(CLI_BACKENDS)).toEqual(['gemini', 'claude', 'codex']);
  });

  it('gemini는 --experimental-acp 인자를 사용해야 합니다', () => {
    expect(CLI_BACKENDS.gemini.acpArgs).toContain('--experimental-acp');
  });

  it('claude는 npx 브릿지 패키지를 사용해야 합니다', () => {
    expect(CLI_BACKENDS.claude.npxPackage).toContain('claude-agent-acp');
  });

  it('codex는 npx 브릿지를 사용해야 합니다', () => {
    expect(CLI_BACKENDS.codex.npxPackage).toContain('codex-acp');
  });

});

describe('createSpawnConfig', () => {
  it('gemini 설정을 올바르게 생성해야 합니다', () => {
    const config = createSpawnConfig('gemini', defaultOpts);
    expect(config.command).toBe('gemini');
    expect(config.args).toContain('--experimental-acp');
    expect(config.useNpx).toBe(false);
  });

  it('gemini는 모델 지정 시 --model 인자를 spawn args에 포함해야 합니다', () => {
    const config = createSpawnConfig('gemini', {
      ...defaultOpts,
      model: 'gemini-3-flash-preview',
    });

    expect(config.args).toEqual([
      '--experimental-acp',
      '--model',
      'gemini-3-flash-preview',
    ]);
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
    expect(getAllBackendConfigs().length).toBe(3);
  });
});
