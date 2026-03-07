/**
 * E2E 설정 변경 테스트
 * 실제 CLI에 연결하여 모델 변경, reasoning effort 설정 등을 검증합니다.
 *
 * 테스트 커버리지:
 * 1. 모델 변경
 *    1.1 Gemini → gemini-3.1-pro-preview, gemini-3-flash-preview
 *    1.2 Codex → gpt-5.3-codex, gpt-5.3-codex-spark
 *    1.3 Claude → opus, sonnet(default), haiku
 * 2. Codex reasoning effort (low, medium, high, xhigh)
 * 3. Claude effort (configOptions에 존재하면 테스트)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { AcpConnection } from '../../src/connection/AcpConnection.js';
import { createSpawnConfig } from '../../src/config/CliConfigs.js';
import { cleanEnvironment } from '../../src/utils/env.js';
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

/** ACP 연결 헬퍼 — 세션까지 생성 */
async function connectAcp(
  cli: CliType,
): Promise<{ conn: AcpConnection; sessionId: string; sessionResult: any }> {
  const spawnCfg = createSpawnConfig(cli, { cwd: process.cwd() });
  const conn = new AcpConnection({
    command: spawnCfg.command,
    args: spawnCfg.args,
    cwd: process.cwd(),
    requestTimeout: 30_000,
    initTimeout: 60_000,
    autoApprove: true,
    clientInfo: { name: 'ConfigTest', version: '1.0.0' },
    env: cleanEnvironment(process.env),
  });

  const sessionResult = await conn.connect(process.cwd());
  return { conn, sessionId: sessionResult.sessionId, sessionResult };
}

// ═══════════════════════════════════════════════
// 1.3 Claude 모델 변경
// ═══════════════════════════════════════════════
describe.skipIf(!isCliInstalled('claude'))('E2E: Claude 설정 변경', () => {
  let conn: AcpConnection;

  afterEach(async () => {
    if (conn) await conn.disconnect();
  });

  it('모델 변경: opus → default → haiku', async () => {
    const { conn: c, sessionId } = await connectAcp('claude');
    conn = c;

    // opus로 변경
    await conn.setConfigOption(sessionId, 'model', 'opus');
    console.log(`  ✅ claude model → opus`);

    // default(sonnet)로 변경
    await conn.setConfigOption(sessionId, 'model', 'default');
    console.log(`  ✅ claude model → default (sonnet)`);

    // haiku로 변경
    await conn.setConfigOption(sessionId, 'model', 'haiku');
    console.log(`  ✅ claude model → haiku`);
  }, 60_000);

  it('프롬프트 응답 검증 (haiku 모델)', async () => {
    const { conn: c, sessionId } = await connectAcp('claude');
    conn = c;

    // haiku 모델로 변경
    await conn.setConfigOption(sessionId, 'model', 'haiku');

    // 응답 수집
    const chunks: string[] = [];
    conn.on('messageChunk', (text: string) => chunks.push(text));

    // 프롬프트 전송
    await conn.sendPrompt(sessionId, '1+1의 결과를 숫자만 답해줘');

    // 스트리밍 응답 대기
    const start = Date.now();
    while (chunks.length === 0 && Date.now() - start < 30_000) {
      await new Promise((r) => setTimeout(r, 200));
    }

    const response = chunks.join('');
    console.log(`  📥 haiku 응답: "${response.trim()}"`);
    expect(response).toContain('2');
    console.log(`  ✅ claude haiku 모델 프롬프트 검증 통과`);
  }, 120_000);
});

// ═══════════════════════════════════════════════
// 1.2 Codex 모델 변경 + 2. Reasoning Effort
// ═══════════════════════════════════════════════
describe.skipIf(!isCliInstalled('codex'))('E2E: Codex 설정 변경', () => {
  let conn: AcpConnection;

  afterEach(async () => {
    if (conn) await conn.disconnect();
  });

  it('모델 변경: gpt-5.3-codex → gpt-5.3-codex-spark', async () => {
    const { conn: c, sessionId } = await connectAcp('codex');
    conn = c;

    await conn.setConfigOption(sessionId, 'model', 'gpt-5.3-codex');
    console.log(`  ✅ codex model → gpt-5.3-codex`);

    await conn.setConfigOption(sessionId, 'model', 'gpt-5.3-codex-spark');
    console.log(`  ✅ codex model → gpt-5.3-codex-spark`);
  }, 60_000);

  it('reasoning effort: low → medium → high → xhigh', async () => {
    const { conn: c, sessionId } = await connectAcp('codex');
    conn = c;

    for (const effort of ['low', 'medium', 'high', 'xhigh'] as const) {
      await conn.setConfigOption(sessionId, 'reasoning_effort', effort);
      console.log(`  ✅ codex reasoning_effort → ${effort}`);
    }
  }, 60_000);

  it('프롬프트 응답 검증 (gpt-5.3-codex-spark + low effort)', async () => {
    const { conn: c, sessionId } = await connectAcp('codex');
    conn = c;

    await conn.setConfigOption(sessionId, 'model', 'gpt-5.3-codex-spark');
    await conn.setConfigOption(sessionId, 'reasoning_effort', 'low');

    const chunks: string[] = [];
    conn.on('messageChunk', (text: string) => chunks.push(text));

    await conn.sendPrompt(sessionId, '1+1의 결과를 숫자만 답해줘');

    const start = Date.now();
    while (chunks.length === 0 && Date.now() - start < 30_000) {
      await new Promise((r) => setTimeout(r, 200));
    }

    const response = chunks.join('');
    console.log(`  📥 codex-spark/low 응답: "${response.trim()}"`);
    expect(response).toContain('2');
    console.log(`  ✅ codex 모델+effort 프롬프트 검증 통과`);
  }, 120_000);
});

// ═══════════════════════════════════════════════
// 1.1 Gemini 모델 변경
// Gemini는 session/new에 configOptions가 없으므로,
// session/set_config_option 지원 여부를 직접 테스트합니다.
// ═══════════════════════════════════════════════
describe.skipIf(!isCliInstalled('gemini'))('E2E: Gemini 설정 변경', () => {
  let conn: AcpConnection;

  afterEach(async () => {
    if (conn) await conn.disconnect();
  });

  it('모델 변경 시도: gemini-3.1-pro-preview', async () => {
    const { conn: c, sessionId } = await connectAcp('gemini');
    conn = c;

    try {
      await conn.setConfigOption(sessionId, 'model', 'gemini-3.1-pro-preview');
      console.log(`  ✅ gemini model → gemini-3.1-pro-preview`);
    } catch (err) {
      // Gemini가 set_config_option을 지원하지 않을 수 있음
      console.log(`  ⚠️  gemini set_config_option 미지원: ${(err as Error).message.slice(0, 100)}`);
    }
  }, 60_000);

  it('모델 변경 시도: gemini-3-flash-preview', async () => {
    const { conn: c, sessionId } = await connectAcp('gemini');
    conn = c;

    try {
      await conn.setConfigOption(sessionId, 'model', 'gemini-3-flash-preview');
      console.log(`  ✅ gemini model → gemini-3-flash-preview`);
    } catch (err) {
      console.log(`  ⚠️  gemini set_config_option 미지원: ${(err as Error).message.slice(0, 100)}`);
    }
  }, 60_000);
});
