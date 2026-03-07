import { describe, it, expect } from 'vitest';
import { resolveNpxPath, buildNpxArgs } from '../../../src/utils/npx.js';
import { isWindows } from '../../../src/utils/env.js';

describe('resolveNpxPath', () => {
  it('정상 환경에서 npx 경로를 해석해야 합니다', () => {
    const resolved = resolveNpxPath(process.env as Record<string, string | undefined>);

    expect(typeof resolved).toBe('string');
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.toLowerCase()).toContain('npx');
  });

  it('PATH 해석 실패 시 플랫폼별 fallback 경로를 반환해야 합니다', () => {
    const resolved = resolveNpxPath({
      PATH: isWindows() ? 'Z:\\definitely\\missing\\path' : '/definitely/missing/path',
    });

    expect(resolved).toBe(isWindows() ? 'npx.cmd' : 'npx');
  });

  it('env를 생략해도 예외 없이 문자열을 반환해야 합니다', () => {
    const resolved = resolveNpxPath();

    expect(typeof resolved).toBe('string');
    expect(resolved.length).toBeGreaterThan(0);
  });
});

describe('buildNpxArgs', () => {
  it('preferOffline=true면 --prefer-offline을 포함해야 합니다', () => {
    const args = buildNpxArgs('@zed-industries/claude-agent-acp@0.18.0', true);

    expect(args).toEqual([
      '--yes',
      '--prefer-offline',
      '@zed-industries/claude-agent-acp@0.18.0',
    ]);
  });

  it('preferOffline=false면 --prefer-offline을 제외해야 합니다', () => {
    const args = buildNpxArgs('@zed-industries/codex-acp@0.9.4', false);

    expect(args).toEqual([
      '--yes',
      '@zed-industries/codex-acp@0.9.4',
    ]);
  });
});
