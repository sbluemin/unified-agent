/**
 * E2E CLI 바이너리 테스트
 * dist/cli.mjs를 실제 자식 프로세스로 실행하여 동작을 검증합니다.
 *
 * 주의:
 * - `npm run build`로 빌드된 dist/cli.mjs가 필요합니다.
 * - 실제 CLI가 설치되어 있고 인증이 완료된 환경에서만 프롬프트 테스트가 실행됩니다.
 * - 설치되지 않은 CLI의 테스트는 자동으로 건너뜁니다.
 */

import { describe, it, expect } from 'vitest';
import { execSync, execFileSync, spawn } from 'child_process';
import { resolve } from 'path';

const CLI_PATH = resolve(import.meta.dirname, '../../dist/cli.mjs');
const NODE = process.execPath;

/** CLI 설치 확인 */
function isCliInstalled(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** CLI 실행 헬퍼 */
function runCli(
  args: string[],
  options?: { input?: string; timeout?: number },
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(NODE, [CLI_PATH, ...args], {
      input: options?.input,
      timeout: options?.timeout ?? 10_000,
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? '') as string,
      stderr: (e.stderr ?? '') as string,
      exitCode: (e.status ?? 1) as number,
    };
  }
}

/** 비동기 CLI 실행 헬퍼 (장시간 프롬프트용) */
function runCliAsync(
  args: string[],
  options?: { input?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI_PATH, ...args], {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, options?.timeout ?? 180_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    if (options?.input) {
      child.stdin.write(options.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

// ═══════════════════════════════════════════════
// 1. 인자 파싱 / 도움말 / 검증 (CLI 설치 불필요)
// ═══════════════════════════════════════════════
describe('CLI 바이너리: 인자 파싱', () => {
  it('--help 도움말을 출력해야 합니다', () => {
    const { stdout, exitCode } = runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('unified-agent');
    expect(stdout).toContain('--cli');
    expect(stdout).toContain('--model');
    expect(stdout).toContain('--effort');
    expect(stdout).toContain('--json');
    expect(stdout).toContain('--yolo');
    console.log('  ✅ --help 출력 확인');
  });

  it('-h 축약 도움말도 동작해야 합니다', () => {
    const { stdout, exitCode } = runCli(['-h']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('unified-agent');
    console.log('  ✅ -h 축약 확인');
  });

  it('프롬프트 없이 실행하면 에러 코드 1을 반환해야 합니다', () => {
    const { stderr, exitCode } = runCli([]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('프롬프트');
    console.log('  ✅ 프롬프트 미입력 에러 확인');
  });

  it('잘못된 CLI 이름이면 에러를 반환해야 합니다', () => {
    const { stderr, exitCode } = runCli(['-c', 'invalid', '안녕']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('알 수 없는 CLI');
    expect(stderr).toContain('gemini');
    console.log('  ✅ 잘못된 CLI 검증 확인');
  });

  it('잘못된 effort 값이면 에러를 반환해야 합니다', () => {
    const { stderr, exitCode } = runCli(['-e', 'ultra', '안녕']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('알 수 없는 effort');
    expect(stderr).toContain('low');
    console.log('  ✅ 잘못된 effort 검증 확인');
  });

  it('알 수 없는 옵션이면 에러를 반환해야 합니다', () => {
    const { stderr, exitCode } = runCli(['--unknown-flag', '안녕']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('도움말');
    console.log('  ✅ 알 수 없는 옵션 에러 확인');
  });
});

// ═══════════════════════════════════════════════
// 2. 실제 CLI로 프롬프트 실행 (E2E)
// ═══════════════════════════════════════════════
function createCliE2eTest(cli: string, command: string) {
  const installed = isCliInstalled(command);

  describe.skipIf(!installed)(`CLI 바이너리 E2E: ${cli}`, () => {
    it(`${cli}: 기본 프롬프트 실행 (pretty 모드)`, async () => {
      console.log(`  📤 ${cli} 프롬프트 전송...`);

      const { stdout, stderr, exitCode } = await runCliAsync(
        ['-c', cli, '1+1의 결과를 숫자만 답해줘. 다른 설명은 하지 마.'],
        { timeout: 180_000 },
      );

      console.log(`  📥 stdout: "${stdout.trim().slice(0, 200)}"`);
      console.log(`  📝 stderr: "${stderr.trim().slice(0, 200)}"`);

      expect(exitCode).toBe(0);
      // pretty 모드에서 응답 텍스트는 stdout으로 출력
      expect(stdout).toContain('2');
      // stderr에 헤더가 포함
      expect(stderr).toContain('unified-agent');
      console.log(`  ✅ ${cli} pretty 모드 통과`);
    }, 180_000);

    it(`${cli}: JSON 모드 출력`, async () => {
      console.log(`  📤 ${cli} JSON 모드 프롬프트 전송...`);

      const { stdout, exitCode } = await runCliAsync(
        ['--json', '-c', cli, '1+1의 결과를 숫자만 답해줘. 다른 설명은 하지 마.'],
        { timeout: 180_000 },
      );

      expect(exitCode).toBe(0);

      // JSON 파싱 가능 확인
      const result = JSON.parse(stdout.trim());
      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('cli', cli);
      expect(result.response).toContain('2');

      console.log(`  📥 JSON: ${JSON.stringify(result).slice(0, 200)}`);
      console.log(`  ✅ ${cli} JSON 모드 통과`);
    }, 180_000);

    it(`${cli}: stdin 파이프 입력`, async () => {
      console.log(`  📤 ${cli} stdin 파이프 전송...`);

      const { stdout, exitCode } = await runCliAsync(
        ['--json', '-c', cli],
        {
          input: '1+1의 결과를 숫자만 답해줘. 다른 설명은 하지 마.',
          timeout: 180_000,
        },
      );

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout.trim());
      expect(result.response).toContain('2');

      console.log(`  ✅ ${cli} stdin 파이프 통과`);
    }, 180_000);
  });
}

createCliE2eTest('gemini', 'gemini');
createCliE2eTest('claude', 'claude');
createCliE2eTest('codex', 'codex');

// ═══════════════════════════════════════════════
// 3. Codex reasoning effort E2E
// ═══════════════════════════════════════════════
describe.skipIf(!isCliInstalled('codex'))('CLI 바이너리 E2E: Codex effort', () => {
  it('--effort low 옵션으로 프롬프트 실행', async () => {
    console.log('  📤 codex --effort low 전송...');

    const { stdout, exitCode } = await runCliAsync(
      ['--json', '-c', 'codex', '-e', 'low', '1+1의 결과를 숫자만 답해줘'],
      { timeout: 180_000 },
    );

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout.trim());
    expect(result.response).toContain('2');

    console.log(`  ✅ codex --effort low 통과`);
  }, 180_000);
});
