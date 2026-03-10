/**
 * DirectArgsBuilders 유닛 테스트
 */

import { describe, it, expect } from 'vitest';
import { buildCodexDirectArgs, DIRECT_ARGS_BUILDERS } from '../../src/config/DirectArgsBuilders.js';
import type { DirectArgsBuildOptions } from '../../src/types/direct.js';

describe('buildCodexDirectArgs', () => {
  const baseOptions: DirectArgsBuildOptions = {
    prompt: 'hello world',
    cwd: '/tmp/test',
    yolo: false,
  };

  it('기본 인자를 생성해야 합니다', () => {
    const args = buildCodexDirectArgs(baseOptions);
    expect(args).toContain('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('hello world');
    expect(args).toContain('-C');
    expect(args).toContain('/tmp/test');
  });

  it('모델 옵션을 포함해야 합니다', () => {
    const args = buildCodexDirectArgs({ ...baseOptions, model: 'o3' });
    const mIdx = args.indexOf('-m');
    expect(mIdx).toBeGreaterThan(-1);
    expect(args[mIdx + 1]).toBe('o3');
  });

  it('effort 옵션을 포함해야 합니다', () => {
    const args = buildCodexDirectArgs({ ...baseOptions, effort: 'high' });
    expect(args).toContain('model_reasoning_effort="high"');
  });

  it('yolo 옵션을 포함해야 합니다', () => {
    const args = buildCodexDirectArgs({ ...baseOptions, yolo: true });
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('yolo가 false이면 bypass 인자가 없어야 합니다', () => {
    const args = buildCodexDirectArgs(baseOptions);
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('세션 재개 인자를 생성해야 합니다', () => {
    const args = buildCodexDirectArgs({ ...baseOptions, sessionId: 'abc-123' });
    expect(args[1]).toBe('resume');
    expect(args[2]).toBe('abc-123');
  });

  it('세션 재개 시 -C(cwd) 인자가 없어야 합니다', () => {
    const args = buildCodexDirectArgs({ ...baseOptions, sessionId: 'abc-123' });
    expect(args).not.toContain('-C');
  });

  it('fast 모드 service_tier 설정을 포함해야 합니다', () => {
    const args = buildCodexDirectArgs(baseOptions);
    expect(args).toContain('service_tier="fast"');
  });
});

describe('DIRECT_ARGS_BUILDERS 레지스트리', () => {
  it('codex-exec 빌더가 등록되어 있어야 합니다', () => {
    expect(DIRECT_ARGS_BUILDERS['codex-exec']).toBeDefined();
    expect(typeof DIRECT_ARGS_BUILDERS['codex-exec']).toBe('function');
  });

  it('codex-exec 빌더가 buildCodexDirectArgs와 동일해야 합니다', () => {
    expect(DIRECT_ARGS_BUILDERS['codex-exec']).toBe(buildCodexDirectArgs);
  });
});
