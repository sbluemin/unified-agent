/**
 * E2E 통합 테스트 — 실제 CLI를 spawn하여 프롬프트 전송 & 응답 수신 검증
 *
 * 주의: 실제 CLI가 설치되어 있고 인증이 완료된 환경에서만 실행됩니다.
 * 설치되지 않은 CLI의 테스트는 자동으로 건너뜁니다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { UnifiedAgentClient } from '../../src/index.js';
import type { CliType } from '../../src/types/config.js';

/** CLI 설치 확인 */
function isCliInstalled(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** 타임아웃 헬퍼: Promise를 감싸서 최대 시간 제한 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[${label}] ${ms}ms 타임아웃 초과`)), ms),
    ),
  ]);
}

/**
 * 실제 CLI로 프롬프트를 전송하고 응답을 수신하는 E2E 테스트
 */
function createE2eTest(cli: CliType, command: string) {
  const installed = isCliInstalled(command);

  describe.skipIf(!installed)(`E2E: ${cli} — 실제 프롬프트 전송`, () => {
    let client: UnifiedAgentClient;

    afterEach(async () => {
      if (client) {
        await client.disconnect();
      }
    });

    it(`${cli} ACP 연결 → 프롬프트 전송 → 응답 수신`, async () => {
      client = new UnifiedAgentClient();

      // 수집할 데이터
      const chunks: string[] = [];
      const states: string[] = [];
      const logs: string[] = [];
      let errorOccurred: Error | null = null;

      // 이벤트 리스너 설정
      client.on('messageChunk', (text: string) => {
        chunks.push(text);
      });

      client.on('thoughtChunk', (text: string) => {
        // thinking도 수집 (있는 경우)
      });

      client.on('stateChange', (state: string) => {
        states.push(state);
      });

      client.on('error', (err: Error) => {
        errorOccurred = err;
        logs.push(`ERROR: ${err.message}`);
      });

      client.on('log', (msg: string) => {
        logs.push(msg);
      });

      // ── 1단계: 연결 ──
      console.log(`\n  🔌 ${cli} 연결 중...`);

      const connectResult = await withTimeout(
        client.connect({
          cwd: process.cwd(),
          cli,
          autoApprove: true,
          clientInfo: { name: 'E2E-Test', version: '1.0.0' },
        }),
        120_000, // 2분 타임아웃 (npx 패키지 다운로드 포함)
        `${cli} 연결`,
      );

      // 연결 결과 검증
      expect(connectResult).toBeDefined();
      expect(connectResult.cli).toBe(cli);
      expect(connectResult.protocol).toBe('acp');
      console.log(`  ✅ 연결 성공 (protocol: ${connectResult.protocol})`);

      if (connectResult.session) {
        expect(connectResult.session.sessionId).toBeTruthy();
        console.log(`  📋 sessionId: ${connectResult.session.sessionId}`);
        if (connectResult.session.models?.length) {
          console.log(`  🤖 models: ${connectResult.session.models.join(', ')}`);
        }
      }

      // 연결 상태 확인
      const info = client.getConnectionInfo();
      expect(info.state).toBe('ready');
      expect(info.cli).toBe(cli);

      // ── 2단계: 프롬프트 전송 ──
      const prompt = '1+1의 결과를 숫자만 답해줘. 다른 설명은 하지 마.';
      console.log(`  📤 프롬프트 전송: "${prompt}"`);

      // sendMessage는 즉시 반환되고,
      // 응답은 messageChunk 이벤트로 스트리밍됩니다.
      // 일정 시간 동안 messageChunk가 수신되는지 확인합니다.
      await withTimeout(
        client.sendMessage(prompt),
        60_000,
        `${cli} 프롬프트`,
      );

      // 스트리밍 응답을 기다림 (최대 60초, 100ms 간격으로 폴링)
      const startTime = Date.now();
      const maxWait = 60_000;

      while (chunks.length === 0 && Date.now() - startTime < maxWait) {
        await new Promise((r) => setTimeout(r, 200));
      }

      // ── 3단계: 응답 검증 ──
      const fullResponse = chunks.join('');
      console.log(`  📥 응답 (${chunks.length}개 청크): "${fullResponse.trim().slice(0, 200)}"`);

      // 응답이 수신되었는지 확인
      expect(chunks.length).toBeGreaterThan(0);
      expect(fullResponse.trim().length).toBeGreaterThan(0);

      // "2"가 응답에 포함되어 있는지 확인 (1+1 = 2)
      expect(fullResponse).toContain('2');

      // 에러가 발생하지 않았는지 확인
      expect(errorOccurred).toBeNull();

      console.log(`  ✅ E2E 테스트 통과! (${cli})`);
    }, {
      timeout: 180_000, // Vitest 테스트 타임아웃: 3분
    });
  });
}

// ── 각 CLI에 대한 E2E 테스트 생성 ──
createE2eTest('gemini', 'gemini');
createE2eTest('claude', 'claude');
createE2eTest('codex', 'codex');
createE2eTest('opencode', 'opencode');
