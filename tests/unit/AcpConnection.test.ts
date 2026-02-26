/**
 * AcpConnection 테스트
 * ACP 프로토콜 통신 로직 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter, Readable, Writable } from 'stream';
import { ChildProcess } from 'child_process';
import { AcpConnection, type AcpConnectionOptions } from '../../src/connection/AcpConnection.js';

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

/** 모의 ChildProcess 생성 */
function createMockChild(): {
  child: ChildProcess;
  stdin: Writable & { written: string[] };
  stdout: Readable;
  stderr: Readable;
} {
  const stdin = createMockStdin();
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });

  const child = new EventEmitter() as any;
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.pid = 12345;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    child.emit('exit', 0, null);
  });

  return { child, stdin, stdout, stderr };
}

/**
 * 테스트용 AcpConnection — spawn을 가로채서 mock 프로세스를 주입
 */
class TestableAcpConnection extends AcpConnection {
  private mockChildData: ReturnType<typeof createMockChild> | null = null;

  setMockChild(mock: ReturnType<typeof createMockChild>): void {
    this.mockChildData = mock;
  }

  protected spawnProcess(): ChildProcess {
    if (!this.mockChildData) {
      throw new Error('mockChild가 설정되지 않았습니다');
    }
    this.child = this.mockChildData.child as unknown as ChildProcess;

    // stdout 파싱 설정
    this.mockChildData.stdout.on('data', (data: Buffer) => {
      this.stdoutBuffer += data.toString();
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            const msg = JSON.parse(trimmed);
            this.handleMessage(msg);
          } catch {
            this.emit('log', `[stdout non-json] ${trimmed}`);
          }
        }
      }
    });

    this.mockChildData.child.on('exit', (code: number | null, signal: string | null) => {
      this.setState('closed');
      this.rejectAllPending(new Error(`프로세스 종료: code=${code}, signal=${signal}`));
      this.emit('exit', code, signal);
    });

    this.setState('connected');
    return this.child;
  }
}

describe('AcpConnection', () => {
  const defaultOptions: AcpConnectionOptions = {
    command: 'gemini',
    args: ['--experimental-acp'],
    cwd: '/tmp/test',
    requestTimeout: 5000,
    initTimeout: 5000,
    clientInfo: { name: 'TestApp', version: '1.0.0' },
  };

  let connection: TestableAcpConnection;
  let mock: ReturnType<typeof createMockChild>;

  beforeEach(() => {
    connection = new TestableAcpConnection(defaultOptions);
    mock = createMockChild();
    connection.setMockChild(mock);
  });

  afterEach(async () => {
    await connection.disconnect();
  });

  describe('connect', () => {
    it('initialize → session/new 순서로 호출해야 합니다', async () => {
      const connectPromise = connection.connect('/test/workspace');

      // 약간의 대기 후 stdin 확인
      await new Promise((r) => setTimeout(r, 50));

      // initialize 요청 확인
      expect(mock.stdin.written.length).toBeGreaterThanOrEqual(1);
      const initReq = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      expect(initReq.method).toBe('initialize');
      expect(initReq.params.protocolVersion).toBe(1);
      expect(initReq.params.clientInfo.name).toBe('TestApp');

      // initialize 응답
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: initReq.id,
          result: { protocolVersion: 1, capabilities: {} },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 50));

      // session/new 요청 확인
      expect(mock.stdin.written.length).toBeGreaterThanOrEqual(2);
      const sessionReq = JSON.parse(mock.stdin.written[1].replace('\n', ''));
      expect(sessionReq.method).toBe('session/new');
      expect(sessionReq.params.cwd).toBe('/test/workspace');

      // session/new 응답
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: sessionReq.id,
          result: {
            sessionId: 'test-session-123',
            models: ['gpt-4', 'gemini-pro'],
          },
        }) + '\n',
      );

      const session = await connectPromise;

      expect(session.sessionId).toBe('test-session-123');
      expect(session.models).toContain('gemini-pro');
      expect(connection.connectionState).toBe('ready');
    });
  });

  describe('sendPrompt', () => {
    it('session/prompt 요청을 올바르게 보내야 합니다', async () => {
      // 연결 설정 (빠르게)
      (connection as any).child = mock.child;
      (connection as any).setState('ready');

      const promptPromise = connection.sendPrompt('session-1', '안녕하세요');

      await new Promise((r) => setTimeout(r, 50));

      const sent = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      expect(sent.method).toBe('session/prompt');
      expect(sent.params.sessionId).toBe('session-1');
      expect(sent.params.prompt).toEqual([{ type: 'text', text: '안녕하세요' }]);

      // handleMessage를 직접 호출하여 응답 처리
      (connection as any).handleMessage({
        jsonrpc: '2.0',
        id: sent.id,
        result: null,
      });

      await promptPromise;
    });
  });

  describe('session/update 이벤트', () => {
    beforeEach(() => {
      (connection as any).child = mock.child;
      (connection as any).setState('ready');

      // stdout 파싱 활성화
      mock.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              (connection as any).handleMessage(JSON.parse(line));
            } catch { /* 무시 */ }
          }
        }
      });
    });

    it('agent_message_chunk 이벤트를 발생시켜야 합니다', async () => {
      const chunks: string[] = [];
      connection.on('messageChunk', (text: string) => {
        chunks.push(text);
      });

      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 's1',
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { text: 'Hello' },
            },
          },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 50));
      expect(chunks).toEqual(['Hello']);
    });

    it('tool_call 이벤트를 발생시켜야 합니다', async () => {
      const calls: Array<{ title: string; status: string }> = [];
      connection.on('toolCall', (title: string, status: string) => {
        calls.push({ title, status });
      });

      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 's1',
            update: {
              sessionUpdate: 'tool_call',
              title: 'read_file',
              status: 'running',
            },
          },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 50));
      expect(calls).toEqual([{ title: 'read_file', status: 'running' }]);
    });

    it('agent_thought_chunk 이벤트를 발생시켜야 합니다', async () => {
      const thoughts: string[] = [];
      connection.on('thoughtChunk', (text: string) => {
        thoughts.push(text);
      });

      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 's1',
            update: {
              sessionUpdate: 'agent_thought_chunk',
              content: { text: '문제를 분석 중...' },
            },
          },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 50));
      expect(thoughts).toEqual(['문제를 분석 중...']);
    });
  });

  describe('session/request_permission', () => {
    beforeEach(() => {
      (connection as any).child = mock.child;
      (connection as any).setState('ready');
    });

    it('권한 요청 이벤트를 발생시켜야 합니다', () => {
      const requests: Array<{ params: any; id: number }> = [];
      connection.on('permissionRequest', (params: any, id: number) => {
        requests.push({ params, id });
      });

      (connection as any).handleMessage({
        jsonrpc: '2.0',
        id: 42,
        method: 'session/request_permission',
        params: {
          sessionId: 's1',
          description: '파일 실행 권한',
          options: [
            { optionId: 'allow', label: '허용' },
            { optionId: 'deny', label: '거부' },
          ],
        },
      });

      expect(requests.length).toBe(1);
      expect(requests[0].id).toBe(42);
    });

    it('autoApprove가 활성화되면 자동으로 첫 번째 옵션을 선택해야 합니다', async () => {
      const autoConnection = new TestableAcpConnection({
        ...defaultOptions,
        autoApprove: true,
      });
      autoConnection.setMockChild(mock);
      (autoConnection as any).child = mock.child;
      (autoConnection as any).setState('ready');

      (autoConnection as any).handleMessage({
        jsonrpc: '2.0',
        id: 42,
        method: 'session/request_permission',
        params: {
          sessionId: 's1',
          description: '파일 실행',
          options: [{ optionId: 'auto-allow', label: '허용' }],
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      // stdin에 응답이 작성되었는지 확인
      const sent = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      expect(sent.id).toBe(42);
      expect(sent.result.optionId).toBe('auto-allow');

      await autoConnection.disconnect();
    });
  });

  describe('respondToPermission', () => {
    it('권한 응답을 올바르게 전송해야 합니다', () => {
      (connection as any).child = mock.child;
      (connection as any).setState('ready');

      connection.respondToPermission(42, 'allow');

      const sent = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      expect(sent.jsonrpc).toBe('2.0');
      expect(sent.id).toBe(42);
      expect(sent.result).toEqual({ optionId: 'allow' });
    });
  });

  describe('setMode', () => {
    it('session/set_mode 요청을 보내야 합니다', async () => {
      (connection as any).child = mock.child;
      (connection as any).setState('ready');

      const promise = connection.setMode('session-1', 'bypassPermissions');

      await new Promise((r) => setTimeout(r, 50));

      const sent = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      expect(sent.method).toBe('session/set_mode');
      expect(sent.params.sessionId).toBe('session-1');
      expect(sent.params.modeId).toBe('bypassPermissions');

      // handleMessage를 직접 호출하여 응답 처리
      (connection as any).handleMessage({
        jsonrpc: '2.0',
        id: sent.id,
        result: null,
      });

      await promise;
    });
  });
});
