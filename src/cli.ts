/**
 * unified-agent CLI
 * 원샷 프롬프트 실행을 위한 CLI 진입점
 * (shebang은 tsup banner로 자동 추가)
 */

import { parseArgs } from 'node:util';
import { UnifiedAgentClient } from './client/UnifiedAgentClient.js';
import type { CliType } from './types/config.js';
import { getModelsRegistry, getProviderModels } from './models/ModelRegistry.js';

// ─── ANSI 색상 (TTY일 때만 활성화) ─────────────────────────

const isTTY = process.stdout.isTTY ?? false;
const isErrTTY = process.stderr.isTTY ?? false;

const c = {
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  errDim: (s: string) => (isErrTTY ? `\x1b[2m${s}\x1b[0m` : s),
};

// ─── 인자 파싱 ────────────────────────────────────────────

const VALID_CLIS = ['gemini', 'claude', 'codex'] as const;
const VALID_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;

let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs({
    options: {
      cli: { type: 'string', short: 'c' },
      model: { type: 'string', short: 'm' },
      effort: { type: 'string', short: 'e' },
      cwd: { type: 'string', short: 'd' },
      yolo: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'list-models': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  });
} catch (err) {
  process.stderr.write(`${c.red('오류')}: ${(err as Error).message}\n`);
  process.stderr.write(`도움말: unified-agent --help\n`);
  process.exit(1);
}

const { values, positionals } = parsed;

// ─── 도움말 ──────────────────────────────────────────────

if (values.help) {
  const help = `
${c.bold('unified-agent')} — Gemini, Claude, Codex 통합 CLI

${c.bold('사용법')}
  unified-agent [옵션] <프롬프트>
  echo "프롬프트" | unified-agent [옵션]

${c.bold('옵션')}
  -c, --cli <name>      CLI 선택 (gemini | claude | codex)
  -m, --model <name>    모델 지정
  -e, --effort <level>  reasoning effort (none | low | medium | high | xhigh)
  -d, --cwd <path>      작업 디렉토리 (기본: 현재 디렉토리)
      --yolo             자동 권한 승인 모드
      --json             JSON 출력
      --list-models      사용 가능한 모델 목록 출력
  -h, --help             도움말

${c.bold('예시')}
  ${c.dim('# 자동 감지된 CLI로 실행')}
  unified-agent "이 프로젝트를 분석해줘"

  ${c.dim('# Claude로 실행, 모델 지정')}
  unified-agent -c claude -m opus "코드를 리뷰해줘"

  ${c.dim('# Codex로 실행, reasoning effort 설정')}
  unified-agent -c codex -e high "버그를 찾아줘"

  ${c.dim('# stdin 파이프')}
  cat error.log | unified-agent -c gemini "이 에러를 분석해줘"

  ${c.dim('# JSON 출력 (스크립트에서 파싱 용도)')}
  unified-agent --json -c claude "요약해줘" | jq .response
`;
  process.stdout.write(help.trimStart());
  process.exit(0);
}

// ─── 모델 목록 출력 ──────────────────────────────────────

if (values['list-models']) {
  const cliFilter = values.cli as string | undefined;
  const jsonOut = values.json as boolean;
  const registry = getModelsRegistry();

  // 출력 대상 프로바이더 결정
  const providerKeys = cliFilter
    ? [cliFilter]
    : Object.keys(registry.providers);

  if (cliFilter && !registry.providers[cliFilter]) {
    process.stderr.write(
      `${c.red('오류')}: 알 수 없는 CLI "${cliFilter}". 사용 가능: ${Object.keys(registry.providers).join(', ')}\n`,
    );
    process.exit(1);
  }

  if (jsonOut) {
    // JSON 모드: 필터된 레지스트리 출력
    const filtered = cliFilter
      ? { [cliFilter]: registry.providers[cliFilter] }
      : registry.providers;
    process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
  } else {
    // TTY: 테이블 형태 출력
    for (const key of providerKeys) {
      const provider = getProviderModels(key as CliType);
      process.stdout.write(`\n${c.bold(provider.name)} ${c.dim(`(${key})`)}\n`);
      process.stdout.write(`${c.dim('기본 모델:')} ${provider.defaultModel}\n`);

      if (provider.reasoningEffort.supported) {
        process.stdout.write(
          `${c.dim('reasoning effort:')} ${provider.reasoningEffort.levels.join(', ')} ${c.dim(`(기본: ${provider.reasoningEffort.default})`)}\n`,
        );
      }

      process.stdout.write('\n');
      for (const model of provider.models) {
        const isDefault = model.modelId === provider.defaultModel;
        const marker = isDefault ? c.green('*') : ' ';
        process.stdout.write(`  ${marker} ${c.cyan(model.modelId)}  ${c.dim(model.name)}\n`);
      }
    }
    process.stdout.write('\n');
  }

  process.exit(0);
}

// ─── 옵션 검증 ──────────────────────────────────────────

const cliOpt = values.cli as string | undefined;
if (cliOpt && !VALID_CLIS.includes(cliOpt as CliType)) {
  process.stderr.write(
    `${c.red('오류')}: 알 수 없는 CLI "${cliOpt}". 사용 가능: ${VALID_CLIS.join(', ')}\n`,
  );
  process.exit(1);
}

const effortOpt = values.effort as string | undefined;
if (effortOpt && !VALID_EFFORTS.includes(effortOpt as (typeof VALID_EFFORTS)[number])) {
  process.stderr.write(
    `${c.red('오류')}: 알 수 없는 effort "${effortOpt}". 사용 가능: ${VALID_EFFORTS.join(', ')}\n`,
  );
  process.exit(1);
}

// ─── 프롬프트 읽기 ──────────────────────────────────────

let prompt = positionals.join(' ');

if (!prompt && !process.stdin.isTTY) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  prompt = Buffer.concat(chunks).toString().trim();
}

if (!prompt) {
  process.stderr.write(`${c.red('오류')}: 프롬프트를 입력해주세요.\n`);
  process.stderr.write(`도움말: unified-agent --help\n`);
  process.exit(1);
}

// ─── 실행 ──────────────────────────────────────────────

const jsonMode = values.json as boolean;
const startTime = Date.now();

const client = new UnifiedAgentClient();
let fullResponse = '';

// 이벤트 리스너 설정
client.on('messageChunk', (text) => {
  fullResponse += text;
  if (!jsonMode) {
    process.stdout.write(text);
  }
});

if (!jsonMode) {
  client.on('thoughtChunk', (text) => {
    process.stderr.write(c.errDim(text));
  });

  client.on('toolCall', (title, status) => {
    if (status === 'running' || status === 'pending') {
      process.stderr.write(c.errDim(`  ▶ ${title}\n`));
    }
  });

  client.on('error', (err) => {
    process.stderr.write(`\n${c.red('오류')}: ${err.message}\n`);
  });
}

try {
  const cwd = (values.cwd as string) || process.cwd();
  const selectedCli = cliOpt as CliType | undefined;

  if (!jsonMode) {
    const cliLabel = selectedCli ?? '자동 감지';
    process.stderr.write(`${c.bold(c.cyan('●'))} ${c.bold('unified-agent')} ${c.dim(`(${cliLabel})`)}\n\n`);
  }

  const result = await client.connect({
    cwd,
    cli: selectedCli,
    autoApprove: true,
    yoloMode: values.yolo as boolean,
    model: values.model as string | undefined,
  });

  // reasoning effort 설정
  if (effortOpt) {
    try {
      await client.setConfigOption('reasoning_effort', effortOpt);
    } catch {
      // reasoning_effort 미지원 CLI인 경우 무시
    }
  }

  if (!jsonMode) {
    const cliName = result.cli;
    // 헤더에 실제 연결된 CLI 표시 (자동 감지된 경우)
    if (!selectedCli) {
      process.stderr.write(`${c.dim(`  → ${cliName} 연결됨`)}\n\n`);
    }
  }

  await client.sendMessage(prompt);

  if (!jsonMode) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stderr.write(`\n\n${c.bold(c.green('●'))} ${c.dim(`완료 (${elapsed}s)`)}\n`);
  }

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify({ response: fullResponse, cli: result.cli }) + '\n',
    );
  }
} catch (err) {
  if (!jsonMode) {
    process.stderr.write(`\n${c.red('오류')}: ${(err as Error).message}\n`);
  } else {
    process.stdout.write(
      JSON.stringify({ error: (err as Error).message }) + '\n',
    );
  }
  process.exitCode = 1;
} finally {
  await client.disconnect();
  process.exit(process.exitCode ?? 0);
}
