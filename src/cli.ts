/**
 * unified-agent CLI
 * 원샷 프롬프트 실행을 위한 CLI 진입점
 * (shebang은 tsup banner로 자동 추가)
 */

// Claude Code 내부에서 실행될 때 환경변수 충돌 방지
// (cli.ts 프로세스 자체가 Claude Code 세션 안에서 spawn되므로 즉시 제거)
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;

import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { UnifiedAgentClient } from './client/UnifiedAgentClient.js';
import type { CliType } from './types/config.js';
import { getModelsRegistry, getProviderModels } from './models/ModelRegistry.js';
import { isWindows } from './utils/env.js';

import picocolors from 'picocolors';

// ─── ANSI 색상 (TTY일 때만 활성화) ─────────────────────────

const isTTY = process.stdout.isTTY ?? false;
const isErrTTY = process.stderr.isTTY ?? false;

const c = picocolors.createColors(picocolors.isColorSupported && isTTY);
const ce = picocolors.createColors(picocolors.isColorSupported && isErrTTY);

// ─── 인자 파싱 ────────────────────────────────────────────

const VALID_CLIS = ['gemini', 'claude', 'codex'] as const;
const VALID_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;

let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs({
    options: {
      cli: { type: 'string', short: 'c' },
      session: { type: 'string', short: 's' },
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
  process.stderr.write(`${ce.red('오류')}: ${(err as Error).message}\n`);
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
  -s, --session <id>    이전 세션 재개 (사용 시 -c 필수)
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

  ${c.dim('# 이전 세션 재개')}
  unified-agent -c claude -s <sessionId> "이어서 설명해줘"

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
      `${ce.red('오류')}: 알 수 없는 CLI "${cliFilter}". 사용 가능: ${Object.keys(registry.providers).join(', ')}\n`,
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
    `${ce.red('오류')}: 알 수 없는 CLI "${cliOpt}". 사용 가능: ${VALID_CLIS.join(', ')}\n`,
  );
  process.exit(1);
}

const rawSessionOpt = values.session as string | undefined;
const sessionOpt = rawSessionOpt?.trim();
if (rawSessionOpt !== undefined && !sessionOpt) {
  process.stderr.write(`${ce.red('오류')}: --session 값은 비어 있을 수 없습니다.\n`);
  process.exit(1);
}

if (sessionOpt && !cliOpt) {
  process.stderr.write(`${ce.red('오류')}: --session 사용 시 --cli를 함께 지정해야 합니다.\n`);
  process.exit(1);
}

const effortOpt = values.effort as string | undefined;
if (effortOpt && !VALID_EFFORTS.includes(effortOpt as (typeof VALID_EFFORTS)[number])) {
  process.stderr.write(
    `${ce.red('오류')}: 알 수 없는 effort "${effortOpt}". 사용 가능: ${VALID_EFFORTS.join(', ')}\n`,
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
  process.stderr.write(`${ce.red('오류')}: 프롬프트를 입력해주세요.\n`);
  process.stderr.write(`도움말: unified-agent --help\n`);
  process.exit(1);
}

// ─── Codex 직접 실행 (ACP 우회) ─────────────────────────

/** Codex 직접 실행 옵션 */
interface CodexDirectOptions {
  prompt: string;
  model?: string;
  effort?: string;
  cwd: string;
  yolo: boolean;
  jsonMode: boolean;
  sessionId?: string;
}

/** Codex exec JSONL 이벤트 아이템 */
interface CodexItem {
  id: string;
  type: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
}

/** Codex exec JSONL 이벤트 */
interface CodexEvent {
  type: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * codex exec 인자를 빌드합니다.
 * 세션 재개 시: codex exec resume <sessionId> --json [opts] <prompt>
 * 신규 실행 시: codex exec --json [opts] <prompt>
 */
function buildCodexExecArgs(options: CodexDirectOptions): string[] {
  const args: string[] = ['exec'];

  if (options.sessionId) {
    args.push('resume', options.sessionId);
  }

  args.push('--json');

  // /fast 모드 기본 적용
  args.push('-c', 'service_tier="fast"');

  if (options.model) args.push('-m', options.model);
  if (options.effort) args.push('-c', `model_reasoning_effort="${options.effort}"`);
  if (!options.sessionId && options.cwd) args.push('-C', options.cwd);
  if (options.yolo) args.push('--dangerously-bypass-approvals-and-sandbox');

  args.push(options.prompt);
  return args;
}

/**
 * Codex CLI를 직접 실행합니다 (ACP 프로토콜 우회).
 * 내부적으로 `codex exec --json`을 spawn하여 JSONL을 파싱합니다.
 */
async function runCodexDirect(options: CodexDirectOptions): Promise<void> {
  const args = buildCodexExecArgs(options);

  if (!options.jsonMode) {
    const resumeLabel = options.sessionId ? `, resume: ${options.sessionId.slice(0, 8)}…` : '';
    process.stderr.write(`${ce.bold(ce.cyan('●'))} ${ce.bold('unified-agent')} ${ce.dim(`(codex direct${resumeLabel})`)}\n\n`);
  }

  const startTime = Date.now();
  let threadId: string | null = null;
  let fullResponse = '';

  // Windows에서는 codex가 .cmd 래퍼로 설치되므로 cmd.exe를 통해 실행.
  // shell: true를 사용하면 windowsVerbatimArguments가 강제 true가 되어
  // 공백 포함 인자(프롬프트 등)가 분리되는 문제 발생.
  // cmd.exe를 직접 spawn(shell: false)하면 Node.js 기본 인자 이스케이프가 적용됨.
  const codexCommand = isWindows() ? (process.env.ComSpec ?? 'cmd.exe') : 'codex';
  const codexArgs = isWindows() ? ['/c', 'codex', ...args] : args;

  const child = spawn(codexCommand, codexArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  // stderr를 그대로 전달 (codex의 경고/에러 메시지)
  if (child.stderr) {
    child.stderr.on('data', (chunk: Buffer) => {
      if (!options.jsonMode) {
        process.stderr.write(chunk);
      }
    });
  }

  // JSONL stdout 파싱
  const rl = createInterface({ input: child.stdout });

  rl.on('line', (line: string) => {
    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch {
      // 파싱 불가 라인은 stderr로 출력
      if (!options.jsonMode) {
        process.stderr.write(ce.dim(line) + '\n');
      }
      return;
    }

    switch (event.type) {
      case 'thread.started':
        threadId = event.thread_id ?? null;
        break;

      case 'item.started':
        if (event.item?.type === 'command_execution' && !options.jsonMode) {
          process.stderr.write(ce.dim(`  ▶ ${event.item.command ?? '(command)'}\n`));
        }
        break;

      case 'item.completed':
        if (event.item?.type === 'agent_message' && event.item.text) {
          fullResponse += event.item.text;
          if (!options.jsonMode) {
            process.stdout.write(event.item.text);
          }
        }
        break;

      case 'turn.completed':
        // 턴 완료 — 필요 시 usage 로깅 가능
        break;
    }
  });

  // 프로세스 종료 대기
  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      if (!options.jsonMode) {
        process.stderr.write(`\n${ce.red('오류')}: codex 실행 실패 — ${err.message}\n`);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          process.stderr.write(`${ce.dim('codex CLI가 설치되어 있는지 확인해주세요.')}\n`);
        }
      } else {
        process.stdout.write(JSON.stringify({ error: err.message, sessionId: null }) + '\n');
      }
      resolve(1);
    });
  });

  // 출력 마무리
  if (!options.jsonMode) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const sessionInfo = threadId ? ` ${ce.dim('|')} ${ce.dim(`세션: ${threadId}`)}` : '';
    process.stderr.write(`\n\n${ce.bold(ce.green('●'))} ${ce.dim(`완료 (${elapsed}s)`)}${sessionInfo}\n`);
  }

  if (options.jsonMode) {
    process.stdout.write(
      JSON.stringify({ response: fullResponse, cli: 'codex', sessionId: threadId }) + '\n',
    );
  }

  process.exit(exitCode);
}

// ─── 실행 ──────────────────────────────────────────────

const jsonMode = values.json as boolean;
const startTime = Date.now();

const selectedCli = cliOpt as CliType | undefined;

// Codex 직접 실행 모드 (ACP 우회)
if (selectedCli === 'codex') {
  await runCodexDirect({
    prompt,
    model: values.model as string | undefined,
    effort: effortOpt,
    cwd: (values.cwd as string) || process.cwd(),
    yolo: values.yolo as boolean,
    jsonMode,
    sessionId: sessionOpt,
  });
  // runCodexDirect 내부에서 process.exit 처리
}

// ─── ACP 프로토콜 실행 (gemini, claude, 자동 감지) ────────

const client = new UnifiedAgentClient();
let fullResponse = '';
let isLivePrompt = false;

// 이벤트 리스너 설정 (세션 재개 시 replay 이벤트는 무시)
client.on('messageChunk', (text) => {
  if (!isLivePrompt) return;
  fullResponse += text;
  if (!jsonMode) {
    process.stdout.write(text);
  }
});

if (!jsonMode) {
  client.on('thoughtChunk', (text) => {
    if (!isLivePrompt) return;
    process.stderr.write(ce.dim(text));
  });

  client.on('toolCall', (title, status) => {
    if (!isLivePrompt) return;
    if (status === 'running' || status === 'pending') {
      process.stderr.write(ce.dim(`  ▶ ${title}\n`));
    }
  });

  client.on('error', (err) => {
    process.stderr.write(`\n${ce.red('오류')}: ${err.message}\n`);
  });
}

try {
  const cwd = (values.cwd as string) || process.cwd();

  if (!jsonMode) {
    const cliLabel = selectedCli ?? '자동 감지';
    process.stderr.write(`${ce.bold(ce.cyan('●'))} ${ce.bold('unified-agent')} ${ce.dim(`(${cliLabel})`)}\n\n`);
  }

  const result = await client.connect({
    cwd,
    cli: selectedCli,
    autoApprove: true,
    yoloMode: values.yolo as boolean,
    model: values.model as string | undefined,
    sessionId: sessionOpt,
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
      process.stderr.write(`${ce.dim(`  → ${cliName} 연결됨`)}\n\n`);
    }
  }

  // 세션 로드 중 재생된 이벤트 무시 후, 현재 프롬프트부터 출력 시작
  fullResponse = '';
  isLivePrompt = true;

  await client.sendMessage(prompt);

  if (!jsonMode) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const sid = client.getConnectionInfo().sessionId;
    const sessionInfo = sid ? ` ${ce.dim('|')} ${ce.dim(`세션: ${sid}`)}` : '';
    process.stderr.write(`\n\n${ce.bold(ce.green('●'))} ${ce.dim(`완료 (${elapsed}s)`)}${sessionInfo}\n`);
  }

  if (jsonMode) {
    const sid = client.getConnectionInfo().sessionId;
    process.stdout.write(
      JSON.stringify({ response: fullResponse, cli: result.cli, sessionId: sid }) + '\n',
    );
  }
} catch (err) {
  const sid = client.getConnectionInfo().sessionId;
  if (!jsonMode) {
    const sessionInfo = sid ? ` ${ce.dim(`(세션: ${sid})`)}` : '';
    process.stderr.write(`\n${ce.red('오류')}: ${(err as Error).message}${sessionInfo}\n`);
  } else {
    process.stdout.write(
      JSON.stringify({ error: (err as Error).message, sessionId: sid ?? null }) + '\n',
    );
  }
  process.exitCode = 1;
} finally {
  await client.disconnect();
  process.exit(process.exitCode ?? 0);
}
