/**
 * BaseConnection 테스트
 * 프로세스 spawn 및 Stream 생성 로직 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter, Readable, Writable } from 'stream';
import { ChildProcess } from 'child_process';
import { BaseConnection, type BaseConnectionOptions } from '../../src/connection/BaseConnection.js';

/**
 * 테스트용 BaseConnection 구현체
 */
class TestConnection extends BaseConnection {
  constructor(options: BaseConnectionOptions) {
    super(options);
  }

  // 테스트에서 mock 프로세스를 주입하기 위한 메서드
  public injectChild(child: ChildProcess): void {
    this.child = child;
    this.setState('connected');
  }

  // 테스트에서 state를 직접 확인
  public getState() {
    return this.state;
  }
}

/** 모의 ChildProcess 생성 */
function createMockChild(): ChildProcess & {
  mockStdin: Writable & { written: string[] };
  mockStdout: Readable;
  mockStderr: Readable;
} {
  const chunks: string[] = [];
  const mockStdin = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  (mockStdin as any).written = chunks;

  const mockStdout = new Readable({ read() {} });
  const mockStderr = new Readable({ read() {} });

  const child = new EventEmitter() as any;
  child.stdin = mockStdin;
  child.stdout = mockStdout;
  child.stderr = mockStderr;
  child.pid = 12345;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    child.emit('exit', 0, null);
  });

  child.mockStdin = mockStdin;
  child.mockStdout = mockStdout;
  child.mockStderr = mockStderr;

  return child;
}

describe('BaseConnection', () => {
  const defaultOptions: BaseConnectionOptions = {
    command: 'test-command',
    args: ['--test'],
    cwd: '/tmp/test',
    requestTimeout: 5000,
    initTimeout: 5000,
  };

  let connection: TestConnection;
  let mockChild: ReturnType<typeof createMockChild>;

  beforeEach(() => {
    connection = new TestConnection(defaultOptions);
    mockChild = createMockChild();
    connection.injectChild(mockChild as unknown as ChildProcess);
  });

  afterEach(async () => {
    await connection.disconnect();
  });

  describe('연결 상태', () => {
    it('초기 상태는 disconnected여야 합니다', () => {
      const freshConnection = new TestConnection(defaultOptions);
      expect(freshConnection.connectionState).toBe('disconnected');
    });

    it('injectChild 후 connected 상태여야 합니다', () => {
      expect(connection.connectionState).toBe('connected');
    });

    it('disconnect 후 disconnected 상태여야 합니다', async () => {
      await connection.disconnect();
      expect(connection.connectionState).toBe('disconnected');
    });

    it('상태 변경 시 이벤트를 발생시켜야 합니다', async () => {
      const states: string[] = [];
      connection.on('stateChange', (state: string) => states.push(state));

      await connection.disconnect();

      expect(states).toContain('disconnected');
    });
  });

  describe('disconnect', () => {
    it('프로세스를 정상 종료해야 합니다', async () => {
      expect(connection.connectionState).toBe('connected');

      await connection.disconnect();

      expect(connection.connectionState).toBe('disconnected');
    });
  });

  describe('옵션', () => {
    it('기본 타임아웃 값을 올바르게 설정해야 합니다', () => {
      const conn = new TestConnection({
        command: 'test',
        args: [],
        cwd: '/tmp',
      });
      expect((conn as any).requestTimeout).toBe(300_000);
      expect((conn as any).initTimeout).toBe(60_000);
    });

    it('커스텀 타임아웃 값을 올바르게 설정해야 합니다', () => {
      const conn = new TestConnection({
        command: 'test',
        args: [],
        cwd: '/tmp',
        requestTimeout: 10_000,
        initTimeout: 5_000,
      });
      expect((conn as any).requestTimeout).toBe(10_000);
      expect((conn as any).initTimeout).toBe(5_000);
    });
  });
});
