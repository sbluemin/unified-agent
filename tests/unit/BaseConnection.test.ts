/**
 * BaseConnection 테스트
 * 모의 자식 프로세스를 사용한 JSON-RPC 통신 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter, Readable, Writable } from 'stream';
import { ChildProcess } from 'child_process';
import type { JsonRpcRequest, JsonRpcNotification } from '../../src/types/common.js';
import { BaseConnection, type BaseConnectionOptions } from '../../src/connection/BaseConnection.js';

/**
 * 테스트용 BaseConnection 구현체
 */
class TestConnection extends BaseConnection {
  public serverRequests: JsonRpcRequest[] = [];
  public notifications: JsonRpcNotification[] = [];

  constructor(options: BaseConnectionOptions) {
    super(options);
  }

  protected handleServerRequest(request: JsonRpcRequest): void {
    this.serverRequests.push(request);
  }

  protected handleNotification(notification: JsonRpcNotification): void {
    this.notifications.push(notification);
    this.emit('notification', notification.method, notification.params);
  }

  // 테스트에서 mock 프로세스를 주입하기 위한 메서드
  public injectChild(child: ChildProcess): void {
    this.child = child;
    this.setState('connected');
  }

  // handleMessage를 외부에서 호출할 수 있도록 노출
  public testHandleMessage(msg: unknown): void {
    this.handleMessage(msg as any);
  }
}

/** stdin 모의 스트림 생성 */
function createMockStdin(): Writable & { written: string[] } {
  const chunks: string[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  (writable as any).written = chunks;
  return writable as Writable & { written: string[] };
}

/** stdout 모의 스트림 생성 */
function createMockStdout(): Readable {
  return new Readable({
    read() {},
  });
}

/** 모의 ChildProcess 생성 */
function createMockChild(): ChildProcess & {
  mockStdin: Writable & { written: string[] };
  mockStdout: Readable;
  mockStderr: Readable;
} {
  const mockStdin = createMockStdin();
  const mockStdout = createMockStdout();
  const mockStderr = createMockStdout();

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

  describe('sendRequest', () => {
    it('JSON-RPC 요청을 stdin에 올바르게 작성해야 합니다', async () => {
      const responsePromise = connection.sendRequest('test/method', { key: 'value' });

      // stdin에 쓰여진 메시지 확인
      expect(mockChild.mockStdin.written.length).toBe(1);
      const sent = JSON.parse(mockChild.mockStdin.written[0].replace('\n', ''));
      expect(sent.jsonrpc).toBe('2.0');
      expect(sent.method).toBe('test/method');
      expect(sent.params).toEqual({ key: 'value' });
      expect(typeof sent.id).toBe('number');

      // 응답 시뮬레이션
      connection.testHandleMessage({
        jsonrpc: '2.0',
        id: sent.id,
        result: { success: true },
      });

      const result = await responsePromise;
      expect(result).toEqual({ success: true });
    });

    it('요청 ID가 순차적으로 증가해야 합니다', () => {
      connection.sendRequest('method1').catch(() => {});
      connection.sendRequest('method2').catch(() => {});

      const msg1 = JSON.parse(mockChild.mockStdin.written[0].replace('\n', ''));
      const msg2 = JSON.parse(mockChild.mockStdin.written[1].replace('\n', ''));

      expect(msg2.id).toBe(msg1.id + 1);
    });

    it('타임아웃 시 에러를 발생시켜야 합니다', async () => {
      const shortTimeoutConnection = new TestConnection({
        ...defaultOptions,
        requestTimeout: 100,
      });
      shortTimeoutConnection.injectChild(mockChild as unknown as ChildProcess);

      await expect(
        shortTimeoutConnection.sendRequest('slow/method'),
      ).rejects.toThrow('타임아웃');

      await shortTimeoutConnection.disconnect();
    });

    it('JSON-RPC 에러 응답을 올바르게 처리해야 합니다', async () => {
      const responsePromise = connection.sendRequest('error/method');

      const sent = JSON.parse(mockChild.mockStdin.written[0].replace('\n', ''));

      connection.testHandleMessage({
        jsonrpc: '2.0',
        id: sent.id,
        error: { code: -32600, message: '잘못된 요청' },
      });

      await expect(responsePromise).rejects.toThrow('잘못된 요청');
    });

    it('연결이 없을 때 에러를 발생시켜야 합니다', async () => {
      await connection.disconnect();

      await expect(
        connection.sendRequest('test/method'),
      ).rejects.toThrow('연결되어 있지 않습니다');
    });
  });

  describe('sendNotification', () => {
    it('id 없이 JSON-RPC 알림을 보내야 합니다', () => {
      connection.sendNotification('test/notify', { data: 'test' });

      const sent = JSON.parse(mockChild.mockStdin.written[0].replace('\n', ''));
      expect(sent.jsonrpc).toBe('2.0');
      expect(sent.method).toBe('test/notify');
      expect(sent.params).toEqual({ data: 'test' });
      expect(sent.id).toBeUndefined();
    });
  });

  describe('sendResponse', () => {
    it('JSON-RPC 응답을 올바르게 보내야 합니다', () => {
      connection.sendResponse(42, { success: true });

      const sent = JSON.parse(mockChild.mockStdin.written[0].replace('\n', ''));
      expect(sent.jsonrpc).toBe('2.0');
      expect(sent.id).toBe(42);
      expect(sent.result).toEqual({ success: true });
    });
  });

  describe('sendErrorResponse', () => {
    it('JSON-RPC 에러 응답을 올바르게 보내야 합니다', () => {
      connection.sendErrorResponse(42, -32601, '지원하지 않는 메서드');

      const sent = JSON.parse(mockChild.mockStdin.written[0].replace('\n', ''));
      expect(sent.jsonrpc).toBe('2.0');
      expect(sent.id).toBe(42);
      expect(sent.error).toEqual({ code: -32601, message: '지원하지 않는 메서드' });
    });
  });

  describe('handleMessage', () => {
    it('서버 요청 (id + method, 보류 없음)을 올바르게 라우팅해야 합니다', () => {
      connection.testHandleMessage({
        jsonrpc: '2.0',
        id: 100,
        method: 'server/request',
        params: { action: 'do_something' },
      });

      expect(connection.serverRequests.length).toBe(1);
      expect(connection.serverRequests[0].method).toBe('server/request');
    });

    it('알림 (method만, id 없음)을 올바르게 라우팅해야 합니다', () => {
      connection.testHandleMessage({
        jsonrpc: '2.0',
        method: 'server/notify',
        params: { data: 'notification' },
      });

      expect(connection.notifications.length).toBe(1);
      expect(connection.notifications[0].method).toBe('server/notify');
    });
  });

  describe('handleMessage 라우팅', () => {
    it('JSON-RPC 알림을 올바르게 라우팅해야 합니다', () => {
      connection.testHandleMessage({
        jsonrpc: '2.0',
        method: 'test/event',
        params: { x: 1 },
      });

      expect(connection.notifications.length).toBe(1);
      expect(connection.notifications[0].method).toBe('test/event');
    });

    it('여러 메시지를 순서대로 처리해야 합니다', () => {
      connection.testHandleMessage({
        jsonrpc: '2.0',
        method: 'event/1',
      });
      connection.testHandleMessage({
        jsonrpc: '2.0',
        method: 'event/2',
      });

      expect(connection.notifications.length).toBe(2);
      expect(connection.notifications[0].method).toBe('event/1');
      expect(connection.notifications[1].method).toBe('event/2');
    });

    it('응답과 알림을 동시에 처리할 수 있어야 합니다', async () => {
      // 요청 보내기
      const promise = connection.sendRequest('test/method');

      const sent = JSON.parse(mockChild.mockStdin.written[0].replace('\n', ''));

      // 알림 먼저 처리
      connection.testHandleMessage({
        jsonrpc: '2.0',
        method: 'some/notification',
      });

      // 이후 응답 처리
      connection.testHandleMessage({
        jsonrpc: '2.0',
        id: sent.id,
        result: { ok: true },
      });

      const result = await promise;
      expect(result).toEqual({ ok: true });
      expect(connection.notifications.length).toBe(1);
    });
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
    it('모든 보류 중인 요청을 거부해야 합니다', async () => {
      const promise1 = connection.sendRequest('method1').catch((e) => e.message);
      const promise2 = connection.sendRequest('method2').catch((e) => e.message);

      await connection.disconnect();

      const [err1, err2] = await Promise.all([promise1, promise2]);
      expect(err1).toContain('닫혔습니다');
      expect(err2).toContain('닫혔습니다');
    });
  });
});
