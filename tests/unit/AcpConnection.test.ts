/**
 * AcpConnection 테스트
 * 공식 ACP SDK ClientSideConnection 래핑 로직 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter, Readable, Writable } from 'stream';
import { ChildProcess } from 'child_process';
import { AcpConnection, type AcpConnectionOptions } from '../../src/connection/AcpConnection.js';
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  NewSessionResponse,
} from '@agentclientprotocol/sdk';

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

  // Agent 프록시에 직접 접근하기 위한 헬퍼
  getAgentProxy() {
    return (this as any).agentProxy;
  }

  protected spawnProcess() {
    if (!this.mockChildData) {
      throw new Error('mockChild가 설정되지 않았습니다');
    }
    this.child = this.mockChildData.child as unknown as ChildProcess;
    this.setState('connected');

    // Node.js Stream → Web Streams 변환
    const { Writable: NodeWritable, Readable: NodeReadable } = require('stream');
    const webWritable = NodeWritable.toWeb(this.mockChildData.stdin) as WritableStream<Uint8Array>;
    const webReadable = NodeReadable.toWeb(this.mockChildData.stdout) as ReadableStream<Uint8Array>;

    const { ndJsonStream } = require('@agentclientprotocol/sdk');
    const stream = ndJsonStream(webWritable, webReadable);

    this.acpStream = stream;
    return { child: this.child, stream };
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

      // stdout에서 JSON-RPC 메시지를 가로채기 위해 약간 대기
      await new Promise((r) => setTimeout(r, 100));

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
          result: {
            protocolVersion: 1,
            agentCapabilities: {},
            serverInfo: { name: 'TestAgent', version: '1.0.0' },
          },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 100));

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
          },
        }) + '\n',
      );

      const session = await connectPromise;

      expect(session.sessionId).toBe('test-session-123');
      expect(connection.connectionState).toBe('ready');
    });
  });

  describe('sendPrompt', () => {
    it('session/prompt 요청을 올바르게 보내야 합니다', async () => {
      // 연결 설정 (빠르게) — connect 과정 시뮬레이션
      const connectPromise = connection.connect('/test/workspace');
      await new Promise((r) => setTimeout(r, 100));

      // initialize 응답
      const initReq = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: initReq.id,
          result: { protocolVersion: 1, agentCapabilities: {} },
        }) + '\n',
      );
      await new Promise((r) => setTimeout(r, 100));

      // session/new 응답
      const sessionReq = JSON.parse(mock.stdin.written[1].replace('\n', ''));
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: sessionReq.id,
          result: { sessionId: 'session-1' },
        }) + '\n',
      );
      await connectPromise;

      // 프롬프트 전송
      const promptPromise = connection.sendPrompt('session-1', '안녕하세요');
      await new Promise((r) => setTimeout(r, 100));

      // 프롬프트 요청 확인
      const promptReq = JSON.parse(mock.stdin.written[2].replace('\n', ''));
      expect(promptReq.method).toBe('session/prompt');
      expect(promptReq.params.sessionId).toBe('session-1');
      expect(promptReq.params.prompt).toEqual([{ type: 'text', text: '안녕하세요' }]);

      // 프롬프트 응답
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: promptReq.id,
          result: { stopReason: 'endTurn' },
        }) + '\n',
      );

      const response = await promptPromise;
      expect(response.stopReason).toBe('endTurn');
    });
  });

  describe('session/update 이벤트', () => {
    // connect 헬퍼
    async function setupConnection() {
      const connectPromise = connection.connect('/test/workspace');
      await new Promise((r) => setTimeout(r, 100));

      const initReq = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: initReq.id,
          result: { protocolVersion: 1, agentCapabilities: {} },
        }) + '\n',
      );
      await new Promise((r) => setTimeout(r, 100));

      const sessionReq = JSON.parse(mock.stdin.written[1].replace('\n', ''));
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: sessionReq.id,
          result: { sessionId: 's1' },
        }) + '\n',
      );
      await connectPromise;
    }

    it('agent_message_chunk 이벤트를 발생시켜야 합니다', async () => {
      await setupConnection();

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
              content: { type: 'text', text: 'Hello' },
            },
          },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 100));
      expect(chunks).toEqual(['Hello']);
    });

    it('tool_call 이벤트를 발생시켜야 합니다', async () => {
      await setupConnection();

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
              toolCallId: 'tc-1',
              title: 'read_file',
              status: 'pending',
            },
          },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 100));
      expect(calls).toEqual([{ title: 'read_file', status: 'pending' }]);
    });

    it('agent_thought_chunk 이벤트를 발생시켜야 합니다', async () => {
      await setupConnection();

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
              content: { type: 'text', text: '문제를 분석 중...' },
            },
          },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 100));
      expect(thoughts).toEqual(['문제를 분석 중...']);
    });
  });

  describe('session/request_permission', () => {
    async function setupConnection() {
      const connectPromise = connection.connect('/test/workspace');
      await new Promise((r) => setTimeout(r, 100));

      const initReq = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: initReq.id,
          result: { protocolVersion: 1, agentCapabilities: {} },
        }) + '\n',
      );
      await new Promise((r) => setTimeout(r, 100));

      const sessionReq = JSON.parse(mock.stdin.written[1].replace('\n', ''));
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: sessionReq.id,
          result: { sessionId: 's1' },
        }) + '\n',
      );
      return connectPromise;
    }

    it('권한 요청 이벤트를 발생시키고 응답을 전송해야 합니다', async () => {
      await setupConnection();

      // 이벤트 리스너 등록 — 콜백으로 응답
      connection.on('permissionRequest', (params: RequestPermissionRequest, resolve: (response: RequestPermissionResponse) => void) => {
        resolve({
          outcome: {
            outcome: 'selected',
            optionId: params.options[0].optionId,
          },
        });
      });

      // 권한 요청 서버 → 클라이언트
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 42,
          method: 'session/request_permission',
          params: {
            sessionId: 's1',
            toolCall: { toolCallId: 'tc1', title: '파일 실행', status: 'pending' },
            options: [
              { optionId: 'allow', name: '허용', kind: 'allow_once' },
              { optionId: 'deny', name: '거부', kind: 'reject_once' },
            ],
          },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 200));

      // 응답이 stdin에 작성되었는지 확인
      const responses = mock.stdin.written.filter((w) => {
        try {
          const msg = JSON.parse(w.replace('\n', ''));
          return msg.id === 42 && msg.result;
        } catch { return false; }
      });
      expect(responses.length).toBe(1);
      const response = JSON.parse(responses[0].replace('\n', ''));
      expect(response.result.outcome.outcome).toBe('selected');
      expect(response.result.outcome.optionId).toBe('allow');
    });

    it('autoApprove가 활성화되면 자동으로 첫 번째 옵션을 선택해야 합니다', async () => {
      // autoApprove 활성화된 연결 생성
      const autoConnection = new TestableAcpConnection({
        ...defaultOptions,
        autoApprove: true,
      });
      autoConnection.setMockChild(mock);

      const connectPromise = autoConnection.connect('/test/workspace');
      await new Promise((r) => setTimeout(r, 100));

      const initReq = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: initReq.id,
          result: { protocolVersion: 1, agentCapabilities: {} },
        }) + '\n',
      );
      await new Promise((r) => setTimeout(r, 100));

      const sessionReq = JSON.parse(mock.stdin.written[1].replace('\n', ''));
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: sessionReq.id,
          result: { sessionId: 's1' },
        }) + '\n',
      );
      await connectPromise;

      // 권한 요청
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 99,
          method: 'session/request_permission',
          params: {
            sessionId: 's1',
            toolCall: { toolCallId: 'tc1', title: '파일 실행', status: 'pending' },
            options: [{ optionId: 'auto-allow', name: '허용', kind: 'allow_once' }],
          },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 200));

      // 자동 응답 확인
      const responses = mock.stdin.written.filter((w) => {
        try {
          const msg = JSON.parse(w.replace('\n', ''));
          return msg.id === 99 && msg.result;
        } catch { return false; }
      });
      expect(responses.length).toBe(1);
      const response = JSON.parse(responses[0].replace('\n', ''));
      expect(response.result.outcome.outcome).toBe('selected');
      expect(response.result.outcome.optionId).toBe('auto-allow');

      await autoConnection.disconnect();
    });
  });

  describe('setMode', () => {
    it('session/set_mode 요청을 보내야 합니다', async () => {
      const connectPromise = connection.connect('/test/workspace');
      await new Promise((r) => setTimeout(r, 100));

      const initReq = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: initReq.id,
          result: { protocolVersion: 1, agentCapabilities: {} },
        }) + '\n',
      );
      await new Promise((r) => setTimeout(r, 100));

      const sessionReq = JSON.parse(mock.stdin.written[1].replace('\n', ''));
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: sessionReq.id,
          result: { sessionId: 'session-1' },
        }) + '\n',
      );
      await connectPromise;

      const modePromise = connection.setMode('session-1', 'bypassPermissions');
      await new Promise((r) => setTimeout(r, 100));

      const modeReq = JSON.parse(mock.stdin.written[2].replace('\n', ''));
      expect(modeReq.method).toBe('session/set_mode');
      expect(modeReq.params.sessionId).toBe('session-1');
      expect(modeReq.params.modeId).toBe('bypassPermissions');

      // 응답
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: modeReq.id,
          result: {},
        }) + '\n',
      );

      await modePromise;
    });
  });
});
