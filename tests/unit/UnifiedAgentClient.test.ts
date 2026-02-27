import { describe, it, expect } from 'vitest';
import {
  UnifiedAgentClient,
  AcpConnection,
  BaseConnection,
  CliDetector,
  CLI_BACKENDS,
  cleanEnvironment,
  isWindows,
  killProcess,
  resolveNpxPath,
  buildNpxArgs,
} from '../../src/index.js';

describe('Public API Exports', () => {
  it('UnifiedAgentClient를 내보내야 합니다', () => {
    expect(UnifiedAgentClient).toBeDefined();
    expect(typeof UnifiedAgentClient).toBe('function');
  });

  it('AcpConnection을 내보내야 합니다', () => {
    expect(AcpConnection).toBeDefined();
  });

  it('BaseConnection을 내보내야 합니다', () => {
    expect(BaseConnection).toBeDefined();
  });

  it('CliDetector를 내보내야 합니다', () => {
    expect(CliDetector).toBeDefined();
  });

  it('CLI_BACKENDS를 내보내야 합니다', () => {
    expect(CLI_BACKENDS).toBeDefined();
    expect(Object.keys(CLI_BACKENDS).length).toBe(4);
  });

  it('유틸리티 함수를 내보내야 합니다', () => {
    expect(cleanEnvironment).toBeDefined();
    expect(isWindows).toBeDefined();
    expect(killProcess).toBeDefined();
    expect(resolveNpxPath).toBeDefined();
    expect(buildNpxArgs).toBeDefined();
  });
});

describe('UnifiedAgentClient 인스턴스', () => {
  it('인스턴스를 생성할 수 있어야 합니다', () => {
    const client = new UnifiedAgentClient();
    expect(client).toBeDefined();
    expect(client.getConnectionInfo().state).toBe('disconnected');
  });

  it('연결 없이 sendMessage 호출 시 에러가 발생해야 합니다', async () => {
    const client = new UnifiedAgentClient();
    await expect(client.sendMessage('test')).rejects.toThrow('연결되어 있지 않습니다');
  });

  it('detectClis가 결과를 반환해야 합니다', async () => {
    const client = new UnifiedAgentClient();
    const clis = await client.detectClis();
    expect(Array.isArray(clis)).toBe(true);
    expect(clis.length).toBe(4);
  });

  it('disconnect가 에러 없이 동작해야 합니다', async () => {
    const client = new UnifiedAgentClient();
    await expect(client.disconnect()).resolves.not.toThrow();
  });

  it('연결 전 getAvailableModels는 null을 반환해야 합니다', () => {
    const client = new UnifiedAgentClient();
    expect(client.getAvailableModels()).toBeNull();
  });

  it('disconnect 후 getAvailableModels는 null을 반환해야 합니다', async () => {
    const client = new UnifiedAgentClient();
    await client.disconnect();
    expect(client.getAvailableModels()).toBeNull();
  });
});
