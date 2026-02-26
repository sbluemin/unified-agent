# @sbluemin/unified-agent

> Codex CLI, Claude Code, Gemini CLI, OpenCode CLI를 통합하는 TypeScript SDK

## 개요

Unified Agent는 4개의 주요 CLI 에이전트(Gemini, Claude, Codex, OpenCode)를 **하나의 통합된 인터페이스**로 제어하는 TypeScript SDK입니다.

### 지원 프로토콜

| CLI | 프로토콜 | Spawn 방식 |
|-----|----------|------------|
| **Gemini** | ACP | `gemini --experimental-acp` |
| **Claude** | ACP | `npx @zed-industries/claude-agent-acp@0.18.0` |
| **Codex** | ACP + MCP | `npx @zed-industries/codex-acp@0.9.4` / `codex mcp-server` |
| **OpenCode** | ACP | `opencode acp` |

## 설치

```bash
npm install @sbluemin/unified-agent
```

## 빠른 시작

```typescript
import { UnifiedAgentClient } from '@sbluemin/unified-agent';

const client = new UnifiedAgentClient();

// 이벤트 리스너 설정
client.on('messageChunk', (text) => process.stdout.write(text));
client.on('toolCall', (title, status) => console.log(`🔧 ${title} (${status})`));

// 연결 (CLI 자동 감지)
await client.connect({
  cwd: '/my/workspace',
  autoApprove: true,
});

// 메시지 전송
await client.sendMessage('이 프로젝트를 분석해줘');

// 연결 종료
await client.disconnect();
```

## API

### `UnifiedAgentClient`

통합 클라이언트 클래스.

#### `connect(options: UnifiedClientOptions): Promise<ConnectResult>`

CLI에 연결합니다.

```typescript
const result = await client.connect({
  cwd: '/my/workspace',       // 작업 디렉토리 (필수)
  cli: 'gemini',               // CLI 선택 (미지정 시 자동 감지)
  autoApprove: true,           // 자동 권한 승인
  yoloMode: false,             // YOLO 모드 (Claude 전용)
  model: 'gemini-pro',         // 모델 지정
  codexProtocol: 'acp',        // Codex 프로토콜 ('acp' | 'mcp')
  clientInfo: { name: 'MyApp', version: '1.0.0' },
});
```

#### `sendMessage(content: string): Promise<void>`

메시지를 전송합니다.

#### `callTool(name: string, args?: object): Promise<McpToolCallResult>`

도구를 호출합니다 (MCP 모드 전용).

#### `detectClis(): Promise<CliDetectionResult[]>`

사용 가능한 CLI를 감지합니다.

#### `disconnect(): Promise<void>`

연결을 종료합니다.

### 이벤트

| 이벤트 | 파라미터 | 설명 |
|--------|----------|------|
| `messageChunk` | `(text, sessionId)` | AI 응답 텍스트 스트리밍 |
| `thoughtChunk` | `(text, sessionId)` | AI 사고 과정 |
| `toolCall` | `(title, status, sessionId)` | 도구 호출 |
| `plan` | `(plan, sessionId)` | 계획 업데이트 |
| `permissionRequest` | `(params, requestId)` | 권한 요청 |
| `stateChange` | `(state)` | 연결 상태 변경 |
| `error` | `(error)` | 에러 |

### 하위 모듈

| 모듈 | 설명 |
|------|------|
| `AcpConnection` | ACP 프로토콜 직접 사용 |
| `McpConnection` | Codex MCP 직접 사용 |
| `CliDetector` | CLI 자동 감지 |
| `cleanEnvironment` | 환경변수 정제 |
| `killProcess` | 프로세스 안전 종료 |

## 아키텍처

```
UnifiedAgentClient
  ├── AcpConnection (Gemini, Claude, Codex-bridge, OpenCode)
  │     └── BaseConnection (spawn + JSON-RPC 2.0 over stdio)
  └── McpConnection (Codex MCP direct)
        └── BaseConnection
```

## 라이선스

MIT
