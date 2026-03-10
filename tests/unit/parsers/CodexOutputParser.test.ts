/**
 * CodexOutputParser 유닛 테스트
 */

import { describe, it, expect } from 'vitest';
import { parseCodexJsonlEvent, parseCodexLine } from '../../../src/connection/parsers/CodexOutputParser.js';
import { OUTPUT_PARSERS } from '../../../src/connection/parsers/index.js';
import type { CodexJsonlEvent } from '../../../src/types/direct.js';

describe('parseCodexJsonlEvent', () => {
  it('thread.started 이벤트를 파싱해야 합니다', () => {
    const event: CodexJsonlEvent = { type: 'thread.started', thread_id: 'thread-123' };
    const result = parseCodexJsonlEvent(event);
    expect(result).toEqual({ type: 'threadStarted', threadId: 'thread-123' });
  });

  it('item.started (command_execution) 이벤트를 파싱해야 합니다', () => {
    const event: CodexJsonlEvent = {
      type: 'item.started',
      item: { id: '1', type: 'command_execution', command: 'ls -la' },
    };
    const result = parseCodexJsonlEvent(event);
    expect(result).toEqual({ type: 'toolCall', title: 'ls -la' });
  });

  it('item.started (command 없음) 기본 제목을 사용해야 합니다', () => {
    const event: CodexJsonlEvent = {
      type: 'item.started',
      item: { id: '1', type: 'command_execution' },
    };
    const result = parseCodexJsonlEvent(event);
    expect(result).toEqual({ type: 'toolCall', title: '(command)' });
  });

  it('item.started (비-command 타입)은 null을 반환해야 합니다', () => {
    const event: CodexJsonlEvent = {
      type: 'item.started',
      item: { id: '1', type: 'agent_message' },
    };
    const result = parseCodexJsonlEvent(event);
    expect(result).toBeNull();
  });

  it('item.completed (agent_message) 이벤트를 파싱해야 합니다', () => {
    const event: CodexJsonlEvent = {
      type: 'item.completed',
      item: { id: '1', type: 'agent_message', text: 'Hello world' },
    };
    const result = parseCodexJsonlEvent(event);
    expect(result).toEqual({ type: 'messageChunk', text: 'Hello world' });
  });

  it('item.completed (텍스트 없음)은 null을 반환해야 합니다', () => {
    const event: CodexJsonlEvent = {
      type: 'item.completed',
      item: { id: '1', type: 'agent_message' },
    };
    const result = parseCodexJsonlEvent(event);
    expect(result).toBeNull();
  });

  it('item.completed (비-agent_message 타입)은 null을 반환해야 합니다', () => {
    const event: CodexJsonlEvent = {
      type: 'item.completed',
      item: { id: '1', type: 'command_execution', text: 'output' },
    };
    const result = parseCodexJsonlEvent(event);
    expect(result).toBeNull();
  });

  it('turn.completed 이벤트를 파싱해야 합니다', () => {
    const event: CodexJsonlEvent = { type: 'turn.completed' };
    const result = parseCodexJsonlEvent(event);
    expect(result).toEqual({ type: 'turnCompleted' });
  });

  it('알 수 없는 이벤트는 null을 반환해야 합니다', () => {
    const event: CodexJsonlEvent = { type: 'unknown.event' };
    const result = parseCodexJsonlEvent(event);
    expect(result).toBeNull();
  });
});

describe('parseCodexLine', () => {
  it('유효한 JSONL 라인을 파싱해야 합니다', () => {
    const line = JSON.stringify({ type: 'thread.started', thread_id: 'abc' });
    const result = parseCodexLine(line);
    expect(result).toEqual({ type: 'threadStarted', threadId: 'abc' });
  });

  it('유효하지 않은 JSON은 null을 반환해야 합니다', () => {
    const result = parseCodexLine('not json');
    expect(result).toBeNull();
  });

  it('빈 문자열은 null을 반환해야 합니다', () => {
    const result = parseCodexLine('');
    expect(result).toBeNull();
  });
});

describe('OUTPUT_PARSERS 레지스트리', () => {
  it('codex-jsonl 파서가 등록되어 있어야 합니다', () => {
    expect(OUTPUT_PARSERS['codex-jsonl']).toBeDefined();
    expect(typeof OUTPUT_PARSERS['codex-jsonl']).toBe('function');
  });

  it('codex-jsonl 파서가 parseCodexLine과 동일해야 합니다', () => {
    expect(OUTPUT_PARSERS['codex-jsonl']).toBe(parseCodexLine);
  });
});
