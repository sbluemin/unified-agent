/**
 * 환경변수 정제 유틸리티 테스트
 */

import { describe, it, expect } from 'vitest';
import { cleanEnvironment, isWindows } from '../../../src/utils/env.js';

describe('cleanEnvironment', () => {
  it('NODE_OPTIONS, NODE_INSPECT, NODE_DEBUG를 제거해야 합니다', () => {
    const baseEnv = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      NODE_OPTIONS: '--inspect',
      NODE_INSPECT: 'true',
      NODE_DEBUG: 'http',
    };

    const result = cleanEnvironment(baseEnv);

    expect(result.PATH).toBe('/usr/bin');
    expect(result.HOME).toBe('/home/user');
    expect(result.NODE_OPTIONS).toBeUndefined();
    expect(result.NODE_INSPECT).toBeUndefined();
    expect(result.NODE_DEBUG).toBeUndefined();
  });

  it('CLAUDECODE를 제거해야 합니다 (중첩 세션 방지)', () => {
    const baseEnv = {
      CLAUDECODE: '1',
      PATH: '/usr/bin',
    };

    const result = cleanEnvironment(baseEnv);

    expect(result.CLAUDECODE).toBeUndefined();
    expect(result.PATH).toBe('/usr/bin');
  });

  it('npm_ 접두사 변수를 모두 제거해야 합니다', () => {
    const baseEnv = {
      npm_package_name: 'test',
      npm_lifecycle_event: 'build',
      npm_config_registry: 'https://registry.npmjs.org',
      OTHER_VAR: 'keep',
    };

    const result = cleanEnvironment(baseEnv);

    expect(result.npm_package_name).toBeUndefined();
    expect(result.npm_lifecycle_event).toBeUndefined();
    expect(result.npm_config_registry).toBeUndefined();
    expect(result.OTHER_VAR).toBe('keep');
  });

  it('커스텀 환경변수를 병합해야 합니다', () => {
    const baseEnv = { PATH: '/usr/bin' };
    const customEnv = { CUSTOM_VAR: 'value', API_KEY: 'secret' };

    const result = cleanEnvironment(baseEnv, customEnv);

    expect(result.PATH).toBe('/usr/bin');
    expect(result.CUSTOM_VAR).toBe('value');
    expect(result.API_KEY).toBe('secret');
  });

  it('커스텀 환경변수가 기존 변수를 덮어써야 합니다', () => {
    const baseEnv = { MY_VAR: 'old' };
    const customEnv = { MY_VAR: 'new' };

    const result = cleanEnvironment(baseEnv, customEnv);

    expect(result.MY_VAR).toBe('new');
  });

  it('원본 환경변수를 수정하지 않아야 합니다', () => {
    const baseEnv = {
      NODE_OPTIONS: '--inspect',
      PATH: '/usr/bin',
    };
    const originalKeys = Object.keys(baseEnv);

    cleanEnvironment(baseEnv);

    // 원본이 변경되지 않았는지 확인
    expect(Object.keys(baseEnv)).toEqual(originalKeys);
    expect(baseEnv.NODE_OPTIONS).toBe('--inspect');
  });

  it('빈 환경변수를 처리해야 합니다', () => {
    const result = cleanEnvironment({});
    expect(result).toEqual({});
  });

  it('커스텀 환경변수 없이 동작해야 합니다', () => {
    const baseEnv = { PATH: '/usr/bin' };
    const result = cleanEnvironment(baseEnv);
    expect(result.PATH).toBe('/usr/bin');
  });
});

describe('isWindows', () => {
  it('boolean을 반환해야 합니다', () => {
    expect(typeof isWindows()).toBe('boolean');
  });

  it('macOS에서는 false를 반환해야 합니다', () => {
    // 현재 테스트 환경이 macOS이므로
    if (process.platform === 'darwin') {
      expect(isWindows()).toBe(false);
    }
  });
});
