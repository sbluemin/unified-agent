/**
 * BaseConnection - 추상 기반 연결 클래스
 * ACP/MCP 공통의 child_process.spawn + JSON-RPC 2.0 통신 로직
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import type {
  ConnectionState,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  PendingRequest,
} from '../types/common.js';
import { isWindows } from '../utils/env.js';
import { killProcess } from '../utils/process.js';

/** BaseConnection 생성 옵션 */
export interface BaseConnectionOptions {
  /** 실행 커맨드 */
  command: string;
  /** 커맨드 인자 */
  args: string[];
  /** 작업 디렉토리 */
  cwd: string;
  /** 환경변수 */
  env?: Record<string, string | undefined>;
  /** 요청 타임아웃 (ms, 기본: 60000) */
  requestTimeout?: number;
  /** 초기화 타임아웃 (ms, 기본: 60000) */
  initTimeout?: number;
}

/**
 * 추상 기반 연결 클래스.
 * child_process.spawn으로 CLI 프로세스를 생성하고,
 * stdin/stdout을 통한 줄 단위 JSON-RPC 2.0 통신을 처리합니다.
 */
export abstract class BaseConnection extends EventEmitter {
  protected child: ChildProcess | null = null;
  protected nextId = 0;
  protected pending = new Map<number, PendingRequest>();
  protected state: ConnectionState = 'disconnected';
  protected stdoutBuffer = '';
  protected stderrBuffer = '';

  protected readonly command: string;
  protected readonly args: string[];
  protected readonly cwd: string;
  protected readonly env: Record<string, string | undefined>;
  protected readonly requestTimeout: number;
  protected readonly initTimeout: number;

  constructor(options: BaseConnectionOptions) {
    super();
    this.command = options.command;
    this.args = options.args;
    this.cwd = options.cwd;
    this.env = options.env ?? { ...process.env };
    this.requestTimeout = options.requestTimeout ?? 300_000; // 5분
    this.initTimeout = options.initTimeout ?? 60_000; // 60초
  }

  /** 현재 연결 상태 */
  get connectionState(): ConnectionState {
    return this.state;
  }

  /**
   * CLI 프로세스를 spawn합니다.
   * spawn 후 stdout/stderr 이벤트 핸들러를 설정합니다.
   */
  protected spawnProcess(): ChildProcess {
    this.setState('connecting');

    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env as NodeJS.ProcessEnv,
      shell: isWindows(),
    });

    // stdout에서 줄 단위 JSON-RPC 메시지 파싱
    child.stdout?.on('data', (data: Buffer) => {
      this.stdoutBuffer += data.toString();
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            const msg = JSON.parse(trimmed) as JsonRpcMessage;
            this.handleMessage(msg);
          } catch {
            // 시작 시 non-JSON 출력 무시 (CLI 배너, 로그 등)
            this.emit('log', `[stdout non-json] ${trimmed}`);
          }
        }
      }
    });

    // stderr 로그 수집
    child.stderr?.on('data', (data: Buffer) => {
      this.stderrBuffer += data.toString();
      const lines = this.stderrBuffer.split('\n');
      this.stderrBuffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          this.emit('log', line.trim());
        }
      }
    });

    // 프로세스 종료 처리
    child.on('exit', (code, signal) => {
      this.setState('closed');
      this.rejectAllPending(
        new Error(`프로세스 종료: code=${code}, signal=${signal}`),
      );
      this.emit('exit', code, signal);
    });

    // 프로세스 에러 처리
    child.on('error', (err) => {
      this.setState('error');
      this.rejectAllPending(err);
      this.emit('error', err);
    });

    this.child = child;
    this.setState('connected');
    return child;
  }

  /**
   * JSON-RPC 요청을 보내고 응답을 기다립니다.
   *
   * @param method - RPC 메서드 이름
   * @param params - RPC 파라미터
   * @param timeout - 타임아웃 (ms, 미지정 시 requestTimeout 사용)
   * @returns 응답 result
   */
  sendRequest<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeout?: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.child || !this.child.stdin) {
        reject(new Error('프로세스가 연결되어 있지 않습니다'));
        return;
      }

      const id = this.nextId++;
      const timeoutMs = timeout ?? this.requestTimeout;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`요청 타임아웃 (${timeoutMs}ms): ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        method,
        timer,
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        ...(params && { params }),
      };

      this.child.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * JSON-RPC 알림을 보냅니다 (응답을 기다리지 않음).
   *
   * @param method - RPC 메서드 이름
   * @param params - RPC 파라미터
   */
  sendNotification(
    method: string,
    params?: Record<string, unknown>,
  ): void {
    if (!this.child?.stdin) {
      throw new Error('프로세스가 연결되어 있지 않습니다');
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params && { params }),
    };

    this.child.stdin.write(JSON.stringify(notification) + '\n');
  }

  /**
   * JSON-RPC 응답을 직접 전송합니다 (서버→클라이언트 요청에 대한 응답용).
   *
   * @param id - 요청 ID
   * @param result - 응답 데이터
   */
  sendResponse(id: number, result: unknown): void {
    if (!this.child?.stdin) {
      throw new Error('프로세스가 연결되어 있지 않습니다');
    }

    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };

    this.child.stdin.write(JSON.stringify(response) + '\n');
  }

  /**
   * JSON-RPC 에러 응답을 전송합니다.
   *
   * @param id - 요청 ID
   * @param code - 에러 코드
   * @param message - 에러 메시지
   */
  sendErrorResponse(id: number, code: number, message: string): void {
    if (!this.child?.stdin) {
      throw new Error('프로세스가 연결되어 있지 않습니다');
    }

    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };

    this.child.stdin.write(JSON.stringify(response) + '\n');
  }

  /**
   * 연결을 닫고 프로세스를 종료합니다.
   */
  async disconnect(): Promise<void> {
    if (this.child) {
      killProcess(this.child);
      this.child = null;
    }
    this.rejectAllPending(new Error('연결이 닫혔습니다'));
    this.setState('disconnected');
  }

  /**
   * 수신된 JSON-RPC 메시지를 처리합니다.
   */
  protected handleMessage(msg: JsonRpcMessage): void {
    // Response 처리 (id 존재 + 보류 요청 있음)
    if ('id' in msg && typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);

      const response = msg as JsonRpcResponse;
      if (response.error) {
        pending.reject(
          new Error(`JSON-RPC 에러 [${response.error.code}]: ${response.error.message}`),
        );
      } else {
        pending.resolve(response.result);
      }
      return;
    }

    // Server → Client 요청 (id + method 존재, 보류 없음)
    if ('id' in msg && 'method' in msg && typeof msg.id === 'number') {
      this.handleServerRequest(
        msg as JsonRpcRequest,
      );
      return;
    }

    // Notification 처리 (id 없음, method 존재)
    if ('method' in msg && !('id' in msg)) {
      this.handleNotification(msg as JsonRpcNotification);
      return;
    }
  }

  /**
   * 서버에서 클라이언트로 보낸 요청을 처리합니다.
   * 하위 클래스에서 오버라이드하여 구현합니다.
   */
  protected abstract handleServerRequest(request: JsonRpcRequest): void;

  /**
   * 알림 메시지를 처리합니다.
   * 하위 클래스에서 오버라이드하여 구현합니다.
   */
  protected abstract handleNotification(notification: JsonRpcNotification): void;

  /**
   * 연결 상태를 업데이트하고 이벤트를 발생시킵니다.
   */
  protected setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('stateChange', newState);
    }
  }

  /**
   * 모든 보류 중인 요청을 거부합니다.
   */
  protected rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
