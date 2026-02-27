import { describe, it, expect, beforeEach } from 'vitest';
import { CliDetector } from '../../src/detector/CliDetector.js';

describe('CliDetector', () => {
  let detector: CliDetector;

  beforeEach(() => {
    detector = new CliDetector();
  });

  it('4개 CLI 감지 결과를 반환해야 합니다', async () => {
    const results = await detector.detectAll();
    expect(results.length).toBe(4);
    expect(results.map((r) => r.cli)).toEqual(['gemini', 'claude', 'codex', 'opencode']);
  });

  it('각 결과에 필수 필드가 있어야 합니다', async () => {
    const results = await detector.detectAll();
    for (const r of results) {
      expect(r).toHaveProperty('cli');
      expect(r).toHaveProperty('available');
      expect(r).toHaveProperty('protocols');
    }
  });

  it('캐시를 사용해야 합니다', async () => {
    const r1 = await detector.detectAll();
    const r2 = await detector.detectAll();
    expect(r1).toEqual(r2);
  });

  it('codex는 acp 프로토콜을 지원해야 합니다', async () => {
    const result = await detector.detect('codex');
    expect(result.protocols).toContain('acp');
    expect(result.protocols).not.toContain('mcp');
  });

  it('clearCache 후 재감지해야 합니다', async () => {
    await detector.detectAll();
    detector.clearCache();
    const results = await detector.detectAll();
    expect(results.length).toBe(4);
  });

  it('getAvailable은 배열을 반환해야 합니다', async () => {
    const available = await detector.getAvailable();
    expect(Array.isArray(available)).toBe(true);
  });
});
