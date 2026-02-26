/**
 * McpConnection 테스트
 * Codex MCP 프로토콜 통신 및 Elicitation 메커니즘 테스트
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter, Readable, Writable } from 'stream';
import { ChildProcess } from 'child_process';
import { McpConnection, type McpConnectionOptions } from '../../src/connection/McpConnection.js';

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
function createMockChild() {
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
 * 테스트용 McpConnection
 */
class TestableMcpConnection extends McpConnection {
  private mockChildData: ReturnType<typeof createMockChild> | null = null;

  setMockChild(mock: ReturnType<typeof createMockChild>): void {
    this.mockChildData = mock;
  }

  protected spawnProcess(): ChildProcess {
    if (!this.mockChildData) {
      throw new Error('mockChild가 설정되지 않았습니다');
    }
    this.child = this.mockChildData.child as unknown as ChildProcess;

    this.mockChildData.stdout.on('data', (data: Buffer) => {
      this.stdoutBuffer += data.toString();
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            this.handleMessage(JSON.parse(line));
          } catch {
            this.emit('log', `[non-json] ${line.trim()}`);
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

describe('McpConnection', () => {
  const defaultOptions: McpConnectionOptions = {
    command: 'codex',
    args: ['mcp-server'],
    cwd: '/tmp/test',
    requestTimeout: 5000,
    initTimeout: 5000,
  };

  let connection: TestableMcpConnection;
  let mock: ReturnType<typeof createMockChild>;

  beforeEach(() => {
    connection = new TestableMcpConnection(defaultOptions);
    mock = createMockChild();
    connection.setMockChild(mock);
  });

  afterEach(async () => {
    await connection.disconnect();
  });

  describe('connect', () => {
    it('initialize → initialized → tools/list 순서로 호출해야 합니다', async () => {
      const connectPromise = connection.connect();

      await new Promise((r) => setTimeout(r, 50));

      // initialize 요청
      const initReq = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      expect(initReq.method).toBe('initialize');
      expect(initReq.params.capabilities.elicitation).toBeDefined();

      // initialize 응답
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: initReq.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: 'codex-mcp', version: '0.40.0' },
          },
        }) + '\n',
      );

      await new Promise((r) => setTimeout(r, 50));

      // initialized 알림 + tools/list 요청 확인
      expect(mock.stdin.written.length).toBeGreaterThanOrEqual(3);

      // initialized 알림
      const initializedNotif = JSON.parse(mock.stdin.written[1].replace('\n', ''));
      expect(initializedNotif.method).toBe('notifications/initialized');

      // tools/list 요청
      const toolsReq = JSON.parse(mock.stdin.written[2].replace('\n', ''));
      expect(toolsReq.method).toBe('tools/list');

      // tools/list 응답
      mock.stdout.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: toolsReq.id,
          result: {
            tools: [
              { name: 'shell', description: '쉘 명령 실행', inputSchema: {} },
              { name: 'apply_patch', description: '파일 패치', inputSchema: {} },
            ],
          },
        }) + '\n',
      );

      const result = await connectPromise;

      expect(result.serverInfo.name).toBe('codex-mcp');
      expect(connection.connectionState).toBe('ready');
      expect(connection.getTools().length).toBe(2);
    });
  });

  describe('callTool', () => {
    it('tools/call 요청을 올바르게 보내야 합니다', async () => {
      (connection as any).child = mock.child;
      (connection as any).setState('ready');

      const toolPromise = connection.callTool('shell', {
        command: 'ls -la',
      });

      await new Promise((r) => setTimeout(r, 50));

      const sent = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      expect(sent.method).toBe('tools/call');
      expect(sent.params.name).toBe('shell');
      expect(sent.params.arguments).toEqual({ command: 'ls -la' });

      // 응답
      (connection as any).handleMessage({
        jsonrpc: '2.0',
        id: sent.id,
        result: {
          content: [{ type: 'text', text: 'total 0\n' }],
        },
      });

      const result = await toolPromise;
      expect(result.content[0].text).toBe('total 0\n');
    });
  });

  describe('Elicitation', () => {
    beforeEach(() => {
      (connection as any).child = mock.child;
      (connection as any).setState('ready');
    });

    it('elicitation/create 요청에 대한 이벤트를 발생시켜야 합니다', () => {
      const approvals: Array<{ callId: string; message: string }> = [];
      connection.on(
        'approvalRequest',
        (callId: string, message: string, _respond: Function) => {
          approvals.push({ callId, message });
        },
      );

      (connection as any).handleMessage({
        jsonrpc: '2.0',
        id: 99,
        method: 'elicitation/create',
        params: {
          codex_call_id: 'call-123',
          message: '파일 실행 승인 필요',
        },
      });

      expect(approvals.length).toBe(1);
      expect(approvals[0].callId).toBe('call-123');
      expect(approvals[0].message).toBe('파일 실행 승인 필요');
    });

    it('autoApprove 모드에서 자동으로 승인해야 합니다', async () => {
      const autoConnection = new TestableMcpConnection({
        ...defaultOptions,
        autoApprove: true,
      });
      autoConnection.setMockChild(mock);
      (autoConnection as any).child = mock.child;
      (autoConnection as any).setState('ready');

      (autoConnection as any).handleMessage({
        jsonrpc: '2.0',
        id: 99,
        method: 'elicitation/create',
        params: {
          codex_call_id: 'call-123',
          message: '승인 필요',
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      const sent = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      expect(sent.id).toBe(99);
      expect(sent.result.decision).toBe('approved');

      await autoConnection.disconnect();
    });

    it('race condition: codex/event가 먼저 오면 pendingAutoApprovals에 저장해야 합니다', async () => {
      const autoConnection = new TestableMcpConnection({
        ...defaultOptions,
        autoApprove: true,
      });
      autoConnection.setMockChild(mock);
      (autoConnection as any).child = mock.child;
      (autoConnection as any).setState('ready');

      // 1. codex/event 먼저 도착
      (autoConnection as any).handleMessage({
        jsonrpc: '2.0',
        method: 'codex/event',
        params: {
          msg: { type: 'exec_approval_request', call_id: 'race-123' },
        },
      });

      // 내부 pendingAutoApprovals 확인
      expect((autoConnection as any).pendingAutoApprovals.has('race-123')).toBe(true);

      // 2. elicitation/create 나중에 도착
      (autoConnection as any).handleMessage({
        jsonrpc: '2.0',
        id: 100,
        method: 'elicitation/create',
        params: { codex_call_id: 'race-123' },
      });

      await new Promise((r) => setTimeout(r, 50));

      // pendingAutoApprovals에서 제거되어야 함
      expect((autoConnection as any).pendingAutoApprovals.has('race-123')).toBe(false);

      // 응답이 전송되어야 함
      const sent = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      expect(sent.id).toBe(100);
      expect(sent.result.decision).toBe('approved');

      await autoConnection.disconnect();
    });
  });

  describe('respondToElicitation', () => {
    it('Elicitation 응답을 올바르게 전송해야 합니다', () => {
      (connection as any).child = mock.child;
      (connection as any).setState('ready');

      connection.respondToElicitation(42, 'approved_for_session');

      const sent = JSON.parse(mock.stdin.written[0].replace('\n', ''));
      expect(sent.jsonrpc).toBe('2.0');
      expect(sent.id).toBe(42);
      expect(sent.result.decision).toBe('approved_for_session');
    });
  });

  describe('detectMcpCommand', () => {
    it('정적 메서드로 호출 가능해야 합니다', () => {
      // 실제 codex가 설치되어 있지 않으므로 기본값 반환
      const result = McpConnection.detectMcpCommand('nonexistent-cli');
      expect(result).toEqual(['mcp-server']);
    });
  });

  describe('codex/event 알림', () => {
    it('codexEvent 이벤트를 발생시켜야 합니다', () => {
      (connection as any).child = mock.child;
      (connection as any).setState('ready');

      const events: any[] = [];
      connection.on('codexEvent', (params: any) => events.push(params));

      (connection as any).handleMessage({
        jsonrpc: '2.0',
        method: 'codex/event',
        params: {
          msg: { type: 'agent_message', content: '분석 완료' },
        },
      });

      expect(events.length).toBe(1);
      expect(events[0].msg.type).toBe('agent_message');
    });
  });
});
