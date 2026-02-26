/**
 * @sbluemin/unified-agent 기본 사용 예제
 *
 * 사전 요구사항:
 * - gemini, claude, codex, opencode 중 하나 이상 설치
 * - 해당 CLI의 인증 완료
 *
 * 실행: npx tsx examples/basic-usage.ts
 */

import { UnifiedAgentClient } from '../src/index.js';

async function main() {
  const client = new UnifiedAgentClient();

  // ── 1. 사용 가능한 CLI 감지 ──
  console.log('🔍 사용 가능한 CLI 감지 중...\n');
  const clis = await client.detectClis();

  for (const cli of clis) {
    const status = cli.available ? '✅' : '❌';
    const version = cli.version ? ` (v${cli.version})` : '';
    console.log(`  ${status} ${cli.cli}${version} — ${cli.protocols.join(', ')}`);
  }

  const available = clis.filter((c) => c.available);
  if (available.length === 0) {
    console.log('\n❌ 사용 가능한 CLI가 없습니다.');
    return;
  }

  // ── 2. 이벤트 리스너 설정 ──
  client.on('stateChange', (state) => {
    console.log(`\n[상태] ${state}`);
  });

  client.on('messageChunk', (text) => {
    process.stdout.write(text);
  });

  client.on('thoughtChunk', (text) => {
    process.stdout.write(`💭 ${text}`);
  });

  client.on('toolCall', (title, status) => {
    console.log(`\n🔧 [도구] ${title} (${status})`);
  });

  client.on('plan', (plan) => {
    console.log(`\n📋 [계획] ${plan}`);
  });

  client.on('permissionRequest', (params, requestId) => {
    console.log(`\n🔐 [권한 요청] ${params.description}`);
    // 첫 번째 옵션으로 자동 승인
    if (params.options.length > 0) {
      client.respondToPermission(requestId, params.options[0].optionId);
    }
  });

  client.on('error', (err) => {
    console.error(`\n❌ [에러] ${err.message}`);
  });

  client.on('log', (msg) => {
    // stderr 로그는 디버그용
    // console.log(`📝 ${msg}`);
  });

  // ── 3. 연결 ──
  const selectedCli = available[0].cli;
  console.log(`\n🚀 ${selectedCli}에 연결 중...\n`);

  try {
    const result = await client.connect({
      cwd: process.cwd(),
      cli: selectedCli,
      autoApprove: true, // 자동 권한 승인
      clientInfo: {
        name: 'UnifiedAgent-Example',
        version: '1.0.0',
      },
    });

    console.log(`✅ 연결 완료!`);
    console.log(`   CLI: ${result.cli}`);
    console.log(`   프로토콜: ${result.protocol}`);
    if (result.session) {
      console.log(`   세션: ${result.session.sessionId}`);
      if (result.session.models) {
        console.log(`   모델: ${result.session.models.join(', ')}`);
      }
    }

    // ── 4. 메시지 전송 ──
    console.log('\n📤 메시지 전송 중...\n');
    await client.sendMessage('현재 디렉토리의 구조를 간단히 설명해줘');

    console.log('\n\n✅ 완료!');
  } catch (err) {
    console.error(`\n❌ 연결 실패: ${(err as Error).message}`);
  } finally {
    // ── 5. 연결 종료 ──
    await client.disconnect();
    console.log('🔌 연결 종료');
  }
}

main().catch(console.error);
