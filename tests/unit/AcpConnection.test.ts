/**
 * AcpConnection 테스트
 * 공식 ACP SDK ClientSideConnection 래핑 로직 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import type { ChildProcess } from 'child_process';
import { ndJsonStream, type RequestPermissionRequest, type RequestPermissionResponse } from '@agentclientprotocol/sdk';
import { AcpConnection, type AcpConnectionOptions } from '../../src/connection/AcpConnection.js';

/** 지연 헬퍼 */
async function wait(ms = 80): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  (writable as Writable & { written: string[] }).written = chunks;
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

  const child = new EventEmitter() as ChildProcess;
  (child as ChildProcess & { stdin: Writable }).stdin = stdin;
  (child as ChildProcess & { stdout: Readable }).stdout = stdout;
  (child as ChildProcess & { stderr: Readable }).stderr = stderr;
  (child as ChildProcess & { pid: number }).pid = 12345;
  (child as ChildProcess & { killed: boolean }).killed = false;
  (child as ChildProcess & { kill: (signal?: NodeJS.Signals) => boolean }).kill = vi.fn(() => {
    (child as ChildProcess & { killed: boolean }).killed = true;
    child.emit('exit', 0, null);
    return true;
  });

  return { child, stdin, stdout, stderr };
}

/** 직렬화된 JSON-RPC 메시지 파싱 */
function parseMessage(raw: string): Record<string, unknown> {
  return JSON.parse(raw.replace('\n', '')) as Record<string, unknown>;
}

/**
 * 테스트용 AcpConnection — spawn을 가로채서 mock 프로세스를 주입
 */
class TestableAcpConnection extends AcpConnection {
  private mockChildData: ReturnType<typeof createMockChild> | null = null;

  setMockChild(mock: ReturnType<typeof createMockChild>): void {
    this.mockChildData = mock;
  }

  getAgentProxy() {
    return (this as unknown as { agentProxy: unknown }).agentProxy;
  }

  protected spawnProcess() {
    if (!this.mockChildData) {
      throw new Error('mockChild가 설정되지 않았습니다');
    }

    this.child = this.mockChildData.child;
    this.setState('connected');

    this.childExitPromise = new Promise<void>((resolve) => {
      this.child?.once('exit', () => {
        resolve();
      });
    });

    const webWritable = Writable.toWeb(this.mockChildData.stdin) as WritableStream<Uint8Array>;
    const webReadable = Readable.toWeb(this.mockChildData.stdout) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(webWritable, webReadable);

    this.acpStream = stream;
    return { child: this.child, stream };
  }
}

/** spawn 단계에서 즉시 실패시키는 테스트 연결 */
class BrokenAcpConnection extends AcpConnection {
  protected override spawnProcess(): never {
    throw new Error('spawn 실패');
  }
}

async function setupConnectedConnection(
  connection: TestableAcpConnection,
  mock: ReturnType<typeof createMockChild>,
  sessionId = 'session-1',
): Promise<void> {
  const connectPromise = connection.connect('/test/workspace');
  await wait();

  const initReq = parseMessage(mock.stdin.written[0]);
  mock.stdout.push(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: initReq.id,
      result: { protocolVersion: 1, agentCapabilities: {} },
    })}\n`,
  );

  await wait();

  const sessionReq = parseMessage(mock.stdin.written[1]);
  mock.stdout.push(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: sessionReq.id,
      result: { sessionId },
    })}\n`,
  );

  await connectPromise;
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
    it('initialize → session/new 순서로 호출하고 clientCapabilities를 전달해야 합니다', async () => {
      const connectPromise = connection.connect('/test/workspace');
      await wait();

      const initReq = parseMessage(mock.stdin.written[0]);
      expect(initReq.method).toBe('initialize');
      expect((initReq.params as Record<string, unknown>).protocolVersion).toBe(1);
      expect(((initReq.params as Record<string, unknown>).clientInfo as Record<string, unknown>).name).toBe('TestApp');
      expect((initReq.params as Record<string, unknown>).clientCapabilities).toEqual({
        fs: { readTextFile: true, writeTextFile: true },
        permissions: true,
        terminal: false,
      });

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: initReq.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {},
            serverInfo: { name: 'TestAgent', version: '1.0.0' },
          },
        })}\n`,
      );

      await wait();

      const sessionReq = parseMessage(mock.stdin.written[1]);
      expect(sessionReq.method).toBe('session/new');
      expect((sessionReq.params as Record<string, unknown>).cwd).toBe('/test/workspace');

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: sessionReq.id,
          result: {
            sessionId: 'test-session-123',
          },
        })}\n`,
      );

      const session = await connectPromise;
      expect(session.sessionId).toBe('test-session-123');
      expect(connection.connectionState).toBe('ready');
    });

    it('initialize 실패 시 connect가 reject 되어야 합니다', async () => {
      const connectPromise = connection.connect('/test/workspace');
      await wait();

      const initReq = parseMessage(mock.stdin.written[0]);
      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: initReq.id,
          error: { code: -32603, message: 'initialize failed' },
        })}\n`,
      );

      await expect(connectPromise).rejects.toThrow('initialize failed');
    });

    it('newSession 실패 시 connect가 reject 되어야 합니다', async () => {
      const connectPromise = connection.connect('/test/workspace');
      await wait();

      const initReq = parseMessage(mock.stdin.written[0]);
      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: initReq.id,
          result: { protocolVersion: 1, agentCapabilities: {} },
        })}\n`,
      );

      await wait();

      const sessionReq = parseMessage(mock.stdin.written[1]);
      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: sessionReq.id,
          error: { code: -32603, message: 'session new failed' },
        })}\n`,
      );

      await expect(connectPromise).rejects.toThrow('session new failed');
    });

    it('spawn 실패 시 connect가 reject 되어야 합니다', async () => {
      const broken = new BrokenAcpConnection(defaultOptions);
      await expect(broken.connect('/test/workspace')).rejects.toThrow('spawn 실패');
    });

    it('initTimeout 내 initialize 응답이 없으면 타임아웃되어야 합니다', async () => {
      const timeoutConnection = new TestableAcpConnection({
        ...defaultOptions,
        initTimeout: 100,
      });
      timeoutConnection.setMockChild(createMockChild());

      await expect(timeoutConnection.connect('/test/workspace')).rejects.toThrow('initialize 요청이 100ms 내에 완료되지 않았습니다');

      await timeoutConnection.disconnect();
    });
  });

  describe('sendPrompt', () => {
    it('session/prompt 요청을 올바르게 보내고 응답을 반환해야 합니다', async () => {
      await setupConnectedConnection(connection, mock);

      const promptPromise = connection.sendPrompt('session-1', '안녕하세요');
      await wait();

      const promptReq = parseMessage(mock.stdin.written[2]);
      expect(promptReq.method).toBe('session/prompt');
      expect((promptReq.params as Record<string, unknown>).sessionId).toBe('session-1');
      expect((promptReq.params as Record<string, unknown>).prompt).toEqual([{ type: 'text', text: '안녕하세요' }]);

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: promptReq.id,
          result: { stopReason: 'endTurn' },
        })}\n`,
      );

      const response = await promptPromise;
      expect(response.stopReason).toBe('endTurn');
    });

    it('ContentBlock 배열 입력을 그대로 전달해야 합니다', async () => {
      await setupConnectedConnection(connection, mock);

      const promptBlocks = [{ type: 'text', text: '멀티모달 테스트' }] as const;
      const promptPromise = connection.sendPrompt('session-1', promptBlocks as unknown as Array<{ type: 'text'; text: string }>);
      await wait();

      const promptReq = parseMessage(mock.stdin.written[2]);
      expect((promptReq.params as Record<string, unknown>).prompt).toEqual(promptBlocks);

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: promptReq.id,
          result: { stopReason: 'endTurn' },
        })}\n`,
      );

      await promptPromise;
    });

    it('requestTimeout 내 prompt 응답이 없으면 타임아웃되어야 합니다', async () => {
      const timeoutConnection = new TestableAcpConnection({
        ...defaultOptions,
        requestTimeout: 100,
      });
      const timeoutMock = createMockChild();
      timeoutConnection.setMockChild(timeoutMock);

      await setupConnectedConnection(timeoutConnection, timeoutMock);

      await expect(timeoutConnection.sendPrompt('session-1', 'timeout test')).rejects.toThrow('session/prompt 요청이 100ms 내에 완료되지 않았습니다');

      await timeoutConnection.disconnect();
    });

    it('응답 완료 후 promptComplete 이벤트를 발생시켜야 합니다', async () => {
      await setupConnectedConnection(connection, mock);

      const completed: string[] = [];
      connection.on('promptComplete', (sessionId) => {
        completed.push(sessionId);
      });

      const promptPromise = connection.sendPrompt('session-1', '완료 이벤트 테스트');
      await wait();

      const promptReq = parseMessage(mock.stdin.written[2]);
      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: promptReq.id,
          result: { stopReason: 'endTurn' },
        })}\n`,
      );

      await promptPromise;
      expect(completed).toEqual(['session-1']);
    });
  });

  describe('세션 관련 RPC', () => {
    it('cancelSession은 session/cancel notification을 전송해야 합니다', async () => {
      await setupConnectedConnection(connection, mock);

      await connection.cancelSession('session-1');
      await wait();

      const cancelMsg = parseMessage(mock.stdin.written[2]);
      expect(cancelMsg.method).toBe('session/cancel');
      expect(cancelMsg.params).toEqual({ sessionId: 'session-1' });
      expect(cancelMsg.id).toBeUndefined();
    });

    it('loadSession은 session/load 요청을 전송해야 합니다', async () => {
      await setupConnectedConnection(connection, mock);

      const loadPromise = connection.loadSession({
        sessionId: 'prev-session',
        cwd: '/test/workspace',
        mcpServers: [],
      });
      await wait();

      const loadReq = parseMessage(mock.stdin.written[2]);
      expect(loadReq.method).toBe('session/load');
      expect(loadReq.params).toEqual({
        sessionId: 'prev-session',
        cwd: '/test/workspace',
        mcpServers: [],
      });

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: loadReq.id,
          result: {},
        })}\n`,
      );

      const loaded = await loadPromise;
      expect(loaded).toEqual({});
    });

    it('setConfigOption은 session/set_config_option 요청을 전송해야 합니다', async () => {
      await setupConnectedConnection(connection, mock);

      const configPromise = connection.setConfigOption('session-1', 'model', 'haiku');
      await wait();

      const configReq = parseMessage(mock.stdin.written[2]);
      expect(configReq.method).toBe('session/set_config_option');
      expect(configReq.params).toEqual({
        sessionId: 'session-1',
        configId: 'model',
        value: 'haiku',
      });

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: configReq.id,
          result: { configOptions: [] },
        })}\n`,
      );

      await configPromise;
    });

    it('setMode는 session/set_mode 요청을 전송해야 합니다', async () => {
      await setupConnectedConnection(connection, mock);

      const modePromise = connection.setMode('session-1', 'bypassPermissions');
      await wait();

      const modeReq = parseMessage(mock.stdin.written[2]);
      expect(modeReq.method).toBe('session/set_mode');
      expect(modeReq.params).toEqual({
        sessionId: 'session-1',
        modeId: 'bypassPermissions',
      });

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: modeReq.id,
          result: {},
        })}\n`,
      );

      await modePromise;
    });

    it('연결 전 cancelSession 호출 시 에러가 발생해야 합니다', async () => {
      const notConnected = new AcpConnection(defaultOptions);
      await expect(notConnected.cancelSession('x')).rejects.toThrow('ACP 연결이 설정되지 않았습니다');
    });

    it('loadSession 미지원 Agent면 명확한 에러를 반환해야 합니다', async () => {
      await setupConnectedConnection(connection, mock);

      const agentProxy = connection.getAgentProxy() as { loadSession?: unknown };
      agentProxy.loadSession = undefined;

      await expect(
        connection.loadSession({ sessionId: 's1', cwd: '/tmp', mcpServers: [] }),
      ).rejects.toThrow('session/load를 지원하지 않습니다');
    });
  });

  describe('session/update 이벤트', () => {
    it('agent/user/thought chunk 이벤트를 분리해서 발생시켜야 합니다', async () => {
      await setupConnectedConnection(connection, mock, 's1');

      const agentChunks: string[] = [];
      const userChunks: string[] = [];
      const thoughtChunks: string[] = [];

      connection.on('messageChunk', (text) => {
        agentChunks.push(text);
      });
      connection.on('userMessageChunk', (text) => {
        userChunks.push(text);
      });
      connection.on('thoughtChunk', (text) => {
        thoughtChunks.push(text);
      });

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 's1',
            update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '사용자 입력' } },
          },
        })}\n`,
      );

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 's1',
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '에이전트 응답' } },
          },
        })}\n`,
      );

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 's1',
            update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '추론 중' } },
          },
        })}\n`,
      );

      await wait();

      expect(userChunks).toEqual(['사용자 입력']);
      expect(agentChunks).toEqual(['에이전트 응답']);
      expect(thoughtChunks).toEqual(['추론 중']);
    });

    it('tool_call 이벤트를 발생시켜야 합니다', async () => {
      await setupConnectedConnection(connection, mock, 's1');

      const calls: Array<{ title: string; status: string }> = [];
      connection.on('toolCall', (title, status) => {
        calls.push({ title, status });
      });

      mock.stdout.push(
        `${JSON.stringify({
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
        })}\n`,
      );

      await wait();
      expect(calls).toEqual([{ title: 'read_file', status: 'pending' }]);
    });
  });

  describe('session/request_permission', () => {
    it('권한 요청 이벤트를 발생시키고 응답을 전송해야 합니다', async () => {
      await setupConnectedConnection(connection, mock, 's1');

      connection.on('permissionRequest', (params: RequestPermissionRequest, resolve: (response: RequestPermissionResponse) => void) => {
        resolve({
          outcome: {
            outcome: 'selected',
            optionId: params.options[0].optionId,
          },
        });
      });

      mock.stdout.push(
        `${JSON.stringify({
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
        })}\n`,
      );

      await wait(200);

      const response = mock.stdin.written
        .map((raw) => parseMessage(raw))
        .find((msg) => msg.id === 42 && msg.result !== undefined);

      expect(response).toBeDefined();
      expect((response?.result as Record<string, unknown>).outcome).toEqual({
        outcome: 'selected',
        optionId: 'allow',
      });
    });

    it('autoApprove가 활성화되면 첫 번째 옵션을 자동 선택해야 합니다', async () => {
      const autoConnection = new TestableAcpConnection({
        ...defaultOptions,
        autoApprove: true,
      });
      autoConnection.setMockChild(mock);

      await setupConnectedConnection(autoConnection, mock, 's1');

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 99,
          method: 'session/request_permission',
          params: {
            sessionId: 's1',
            toolCall: { toolCallId: 'tc1', title: '파일 실행', status: 'pending' },
            options: [{ optionId: 'auto-allow', name: '허용', kind: 'allow_once' }],
          },
        })}\n`,
      );

      await wait(200);

      const response = mock.stdin.written
        .map((raw) => parseMessage(raw))
        .find((msg) => msg.id === 99 && msg.result !== undefined);

      expect(response).toBeDefined();
      expect((response?.result as Record<string, unknown>).outcome).toEqual({
        outcome: 'selected',
        optionId: 'auto-allow',
      });

      await autoConnection.disconnect();
    });

    it('cancelSession은 대기 중인 권한 요청을 cancelled로 종료해야 합니다', async () => {
      await setupConnectedConnection(connection, mock, 's1');

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 123,
          method: 'session/request_permission',
          params: {
            sessionId: 's1',
            toolCall: { toolCallId: 'tc1', title: '파일 실행', status: 'pending' },
            options: [{ optionId: 'allow', name: '허용', kind: 'allow_once' }],
          },
        })}\n`,
      );

      await wait();
      await connection.cancelSession('s1');
      await wait(200);

      const permissionResponse = mock.stdin.written
        .map((raw) => parseMessage(raw))
        .find((msg) => msg.id === 123 && msg.result !== undefined);

      expect(permissionResponse).toBeDefined();
      expect((permissionResponse?.result as Record<string, unknown>).outcome).toEqual({
        outcome: 'cancelled',
      });

      const cancelMessage = mock.stdin.written
        .map((raw) => parseMessage(raw))
        .find((msg) => msg.method === 'session/cancel');

      expect(cancelMessage).toBeDefined();
      expect(cancelMessage?.params).toEqual({ sessionId: 's1' });
    });
  });

  describe('terminal 스텁', () => {
    it('terminal/create 요청 시 미지원 에러를 반환해야 합니다', async () => {
      await setupConnectedConnection(connection, mock, 's1');

      mock.stdout.push(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 777,
          method: 'terminal/create',
          params: {
            sessionId: 's1',
            command: 'echo',
            args: ['hello'],
          },
        })}\n`,
      );

      await wait();

      const response = mock.stdin.written
        .map((raw) => parseMessage(raw))
        .find((msg) => msg.id === 777 && msg.error !== undefined);

      expect(response).toBeDefined();
      const error = response?.error as Record<string, unknown>;
      expect(error.message).toBe('Internal error');
      expect((error.data as Record<string, unknown>).details).toBe('terminal/create는 현재 지원되지 않습니다');
    });
  });
});
