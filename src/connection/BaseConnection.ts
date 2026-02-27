/**
 * BaseConnection - 프로세스 Spawn + Stream 관리 기반 클래스
 * child_process.spawn으로 CLI를 실행하고, 공식 ACP SDK용 Stream을 생성합니다.
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk';
import type { ConnectionState } from '../types/common.js';
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
  /** 요청 타임아웃 (ms, 기본: 300000) */
  requestTimeout?: number;
  /** 초기화 타임아웃 (ms, 기본: 60000) */
  initTimeout?: number;
}

/**
 * 프로세스 Spawn + Stream 관리 기반 클래스.
 * child_process.spawn으로 CLI 프로세스를 생성하고,
 * Node.js Stream → Web Streams 변환을 통해 공식 ACP SDK 호환 Stream을 제공합니다.
 */
export class BaseConnection extends EventEmitter {
  protected child: ChildProcess | null = null;
  protected state: ConnectionState = 'disconnected';
  protected acpStream: Stream | null = null;

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
   * CLI 프로세스를 spawn하고 ACP SDK 호환 Stream을 생성합니다.
   *
   * @returns 공식 ACP SDK의 Stream (ndJsonStream)
   */
  protected spawnProcess(): { child: ChildProcess; stream: Stream } {
    this.setState('connecting');

    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env as NodeJS.ProcessEnv,
      shell: isWindows(),
    });

    // stderr 로그 수집
    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.emit('log', line.trim());
        }
      }
    });

    // 프로세스 종료 처리
    child.on('exit', (code, signal) => {
      this.setState('closed');
      this.emit('exit', code, signal);
    });

    // 프로세스 에러 처리
    child.on('error', (err) => {
      this.setState('error');
      this.emit('error', err);
    });

    // Node.js Stream → Web Streams 변환
    const webWritable = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
    const webReadable = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;

    // 공식 ACP SDK의 ndJsonStream으로 변환
    const stream = ndJsonStream(webWritable, webReadable);

    this.child = child;
    this.acpStream = stream;
    this.setState('connected');

    return { child, stream };
  }

  /**
   * 연결을 닫고 프로세스를 종료합니다.
   */
  async disconnect(): Promise<void> {
    if (this.child) {
      killProcess(this.child);
      this.child = null;
    }
    this.acpStream = null;
    this.setState('disconnected');
  }

  /**
   * 연결 상태를 업데이트하고 이벤트를 발생시킵니다.
   */
  protected setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('stateChange', newState);
    }
  }
}
