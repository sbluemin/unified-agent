# @sbluemin/unified-agent

> A TypeScript SDK that unifies Codex CLI, Claude Code, and Gemini CLI under a single interface.

## Overview

Unified Agent provides a single, consistent TypeScript API to control three major CLI agents — Gemini, Claude, and Codex — all communicating over the ACP (Agent Communication Protocol).

### Supported CLIs

| CLI | Protocol | Spawn Command |
|-----|----------|---------------|
| **Gemini** | ACP | `gemini --experimental-acp` |
| **Claude** | ACP | `npx @zed-industries/claude-agent-acp@0.18.0` |
| **Codex** | ACP | `npx @zed-industries/codex-acp@0.9.4` |

## Installation

```bash
npm install @sbluemin/unified-agent
```

## Quick Start

```typescript
import { UnifiedAgentClient } from '@sbluemin/unified-agent';

const client = new UnifiedAgentClient();

// Set up event listeners
client.on('messageChunk', (text) => process.stdout.write(text));
client.on('toolCall', (title, status) => console.log(`Tool: ${title} (${status})`));

// Connect (auto-detects available CLI)
await client.connect({
  cwd: '/my/workspace',
  autoApprove: true,
});

// Send a message
await client.sendMessage('Analyze this project');

// Disconnect
await client.disconnect();
```

## API

### `UnifiedAgentClient`

The main client class.

#### `connect(options: UnifiedClientOptions): Promise<ConnectResult>`

Connects to a CLI agent.

```typescript
const result = await client.connect({
  cwd: '/my/workspace',       // Working directory (required)
  cli: 'gemini',               // CLI selection (auto-detected if omitted)
  autoApprove: true,           // Auto-approve permissions
  yoloMode: false,             // YOLO mode (Claude only)
  model: 'gemini-pro',         // Model override
  clientInfo: { name: 'MyApp', version: '1.0.0' },
});
```

#### `sendMessage(content: string | AcpContentBlock[]): Promise<PromptResponse>`

Sends a message to the agent.

#### `cancelPrompt(): Promise<void>`

Cancels the currently running prompt.

#### `setConfigOption(configId: string, value: string): Promise<void>`

Updates a session configuration option.

#### `loadSession(sessionId: string): Promise<void>`

Reloads an existing session.

#### `detectClis(): Promise<CliDetectionResult[]>`

Detects available CLIs on the system.

#### `disconnect(): Promise<void>`

Closes the connection and terminates the child process.

### Events

| Event | Parameters | Description |
|-------|------------|-------------|
| `userMessageChunk` | `(text, sessionId)` | User message replay streaming |
| `messageChunk` | `(text, sessionId)` | AI response text streaming |
| `thoughtChunk` | `(text, sessionId)` | AI thinking process |
| `toolCall` | `(title, status, sessionId)` | Tool invocation |
| `plan` | `(plan, sessionId)` | Plan update |
| `permissionRequest` | `(params, resolve)` | Permission request callback |
| `promptComplete` | `(sessionId)` | Prompt completion |
| `stateChange` | `(state)` | Connection state change |
| `error` | `(error)` | Error |

### Submodules

| Module | Description |
|--------|-------------|
| `AcpConnection` | Direct ACP protocol access |
| `CliDetector` | CLI auto-detection |
| `cleanEnvironment` | Environment variable sanitization |
| `killProcess` | Safe process termination |

## Architecture

```
UnifiedAgentClient
  +-- AcpConnection (Gemini, Claude, Codex)
        +-- BaseConnection (spawn + JSON-RPC 2.0 over stdio)
```

## License

MIT
