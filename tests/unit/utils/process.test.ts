/**
 * 프로세스 관리 유틸리티 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { killProcess } from '../../../src/utils/process.js';

describe('killProcess', () => {
  let child: ChildProcess;

  afterEach(() => {
    if (child && !child.killed) {
      child.kill('SIGKILL');
    }
  });

  it('실행 중인 프로세스를 종료해야 합니다', async () => {
    // 오래 실행되는 프로세스 생성
    child = spawn('sleep', ['10'], { stdio: 'pipe' });

    expect(child.killed).toBe(false);

    killProcess(child);

    // 프로세스 종료 대기
    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve());
      // 최대 5초 대기
      setTimeout(() => resolve(), 5000);
    });

    expect(child.killed).toBe(true);
  });

  it('이미 종료된 프로세스에서 에러가 발생하지 않아야 합니다', () => {
    child = spawn('echo', ['test'], { stdio: 'pipe' });

    // 프로세스가 종료될 때까지 대기
    return new Promise<void>((resolve) => {
      child.on('exit', () => {
        // 이미 종료된 프로세스에 killProcess 호출
        expect(() => killProcess(child)).not.toThrow();
        resolve();
      });
    });
  });

  it('PID가 없는 프로세스에서 에러가 발생하지 않아야 합니다', () => {
    const mockChild = {
      pid: undefined,
      killed: false,
      kill: vi.fn(),
      once: vi.fn(),
    } as unknown as ChildProcess;

    expect(() => killProcess(mockChild)).not.toThrow();
    expect(mockChild.kill).not.toHaveBeenCalled();
  });
});
