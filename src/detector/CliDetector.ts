/**
 * CLI 자동 감지 시스템
 * 시스템에 설치된 CLI를 감지하고 사용 가능 여부를 확인합니다.
 */

import { execSync } from 'child_process';
import type { CliDetectionResult, CliType, ProtocolType } from '../types/config.js';
import { isWindows } from '../utils/env.js';

/** 감지 대상 CLI 목록 */
const CLI_DETECT_LIST: Array<{
  id: CliType;
  command: string;
  protocols: ProtocolType[];
}> = [
  { id: 'gemini', command: 'gemini', protocols: ['acp'] },
  { id: 'claude', command: 'claude', protocols: ['acp'] },
  { id: 'codex', command: 'codex', protocols: ['acp', 'mcp'] },
  { id: 'opencode', command: 'opencode', protocols: ['acp'] },
];

/**
 * CLI 자동 감지 클래스.
 * 시스템 PATH에서 CLI 바이너리를 찾아 사용 가능 여부를 판단합니다.
 */
export class CliDetector {
  private cache: Map<CliType, CliDetectionResult> = new Map();

  /**
   * 특정 CLI의 사용 가능 여부를 확인합니다.
   *
   * @param command - CLI 커맨드 이름
   * @returns 사용 가능 여부
   */
  private isCliAvailable(command: string): boolean {
    const whichCommand = isWindows() ? 'where' : 'which';

    try {
      execSync(`${whichCommand} ${command}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 3000,
      });
      return true;
    } catch {
      if (isWindows()) {
        // Windows: PowerShell Get-Command 폴백
        try {
          execSync(
            `powershell -NoProfile -Command "Get-Command -All ${command}"`,
            {
              encoding: 'utf-8',
              stdio: 'pipe',
              timeout: 5000,
            },
          );
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  /**
   * CLI의 버전을 감지합니다.
   *
   * @param command - CLI 커맨드 이름
   * @returns 버전 문자열 또는 undefined
   */
  private detectVersion(command: string): string | undefined {
    try {
      const output = execSync(`${command} --version`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      }).trim();

      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : output;
    } catch {
      return undefined;
    }
  }

  /**
   * CLI 커맨드의 전체 경로를 가져옵니다.
   *
   * @param command - CLI 커맨드 이름
   * @returns 전체 경로 또는 커맨드 이름
   */
  private getCliPath(command: string): string {
    const whichCommand = isWindows() ? 'where' : 'which';

    try {
      const result = execSync(`${whichCommand} ${command}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 3000,
      }).trim();

      return result.split('\n')[0].trim();
    } catch {
      return command;
    }
  }

  /**
   * 모든 CLI를 감지합니다.
   *
   * @param forceRefresh - 캐시 무시 여부
   * @returns 감지 결과 배열
   */
  async detectAll(forceRefresh = false): Promise<CliDetectionResult[]> {
    if (!forceRefresh && this.cache.size > 0) {
      return Array.from(this.cache.values());
    }

    const results: CliDetectionResult[] = [];

    for (const { id, command, protocols } of CLI_DETECT_LIST) {
      const available = this.isCliAvailable(command);
      const result: CliDetectionResult = {
        cli: id,
        path: available ? this.getCliPath(command) : command,
        available,
        protocols,
      };

      if (available) {
        result.version = this.detectVersion(command);
      }

      this.cache.set(id, result);
      results.push(result);
    }

    return results;
  }

  /**
   * 특정 CLI를 감지합니다.
   *
   * @param cli - CLI 종류
   * @param forceRefresh - 캐시 무시 여부
   * @returns 감지 결과
   */
  async detect(
    cli: CliType,
    forceRefresh = false,
  ): Promise<CliDetectionResult> {
    if (!forceRefresh && this.cache.has(cli)) {
      return this.cache.get(cli)!;
    }

    const config = CLI_DETECT_LIST.find((c) => c.id === cli);
    if (!config) {
      return {
        cli,
        path: cli,
        available: false,
        protocols: [],
      };
    }

    const available = this.isCliAvailable(config.command);
    const result: CliDetectionResult = {
      cli,
      path: available ? this.getCliPath(config.command) : config.command,
      available,
      protocols: config.protocols,
    };

    if (available) {
      result.version = this.detectVersion(config.command);
    }

    this.cache.set(cli, result);
    return result;
  }

  /**
   * 사용 가능한 CLI 목록을 반환합니다.
   *
   * @returns 사용 가능한 CLI 종류 배열
   */
  async getAvailable(): Promise<CliType[]> {
    const results = await this.detectAll();
    return results.filter((r) => r.available).map((r) => r.cli);
  }

  /**
   * 첫 번째 사용 가능한 CLI를 반환합니다.
   * 우선순위: gemini > claude > codex > opencode
   *
   * @returns 사용 가능한 CLI 또는 null
   */
  async getPreferred(): Promise<CliDetectionResult | null> {
    const results = await this.detectAll();
    return results.find((r) => r.available) ?? null;
  }

  /**
   * 캐시를 초기화합니다.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
