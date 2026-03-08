import { describe, it, expect, afterEach, vi } from 'vitest';
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
  getModelsRegistry,
  getProviderModels,
  getProviderModelIds,
  getReasoningEffortLevels,
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
    expect(Object.keys(CLI_BACKENDS).length).toBe(3);
  });

  it('유틸리티 함수를 내보내야 합니다', () => {
    expect(cleanEnvironment).toBeDefined();
    expect(isWindows).toBeDefined();
    expect(killProcess).toBeDefined();
    expect(resolveNpxPath).toBeDefined();
    expect(buildNpxArgs).toBeDefined();
  });

  it('모델 레지스트리 함수를 내보내야 합니다', () => {
    expect(getModelsRegistry).toBeDefined();
    expect(getProviderModels).toBeDefined();
    expect(getProviderModelIds).toBeDefined();
    expect(getReasoningEffortLevels).toBeDefined();
  });
});

describe('UnifiedAgentClient 인스턴스', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('인스턴스를 생성할 수 있어야 합니다', () => {
    const client = new UnifiedAgentClient();
    expect(client).toBeDefined();
    expect(client.getConnectionInfo().state).toBe('disconnected');
  });

  it('연결 없이 sendMessage 호출 시 에러가 발생해야 합니다', async () => {
    const client = new UnifiedAgentClient();
    await expect(client.sendMessage('test')).rejects.toThrow('연결되어 있지 않습니다');
  });

  it('연결 없이 cancelPrompt 호출 시 에러가 발생해야 합니다', async () => {
    const client = new UnifiedAgentClient();
    await expect(client.cancelPrompt()).rejects.toThrow('연결되어 있지 않습니다');
  });

  it('연결 없이 setConfigOption 호출 시 에러가 발생해야 합니다', async () => {
    const client = new UnifiedAgentClient();
    await expect(client.setConfigOption('model', 'haiku')).rejects.toThrow('연결되어 있지 않습니다');
  });

  it('연결 없이 loadSession 호출 시 에러가 발생해야 합니다', async () => {
    const client = new UnifiedAgentClient();
    await expect(client.loadSession('session-1')).rejects.toThrow('연결되어 있지 않습니다');
  });

  it('detectClis가 결과를 반환해야 합니다', async () => {
    const client = new UnifiedAgentClient();
    const clis = await client.detectClis();
    expect(Array.isArray(clis)).toBe(true);
    expect(clis.length).toBe(3);
  });

  it('disconnect가 에러 없이 동작해야 합니다', async () => {
    const client = new UnifiedAgentClient();
    await expect(client.disconnect()).resolves.not.toThrow();
  });

  it('연결 전에도 cli를 지정하면 getAvailableModels가 유효한 값을 반환해야 합니다', () => {
    const client = new UnifiedAgentClient();
    const models = client.getAvailableModels('claude');
    expect(models).not.toBeNull();
    expect(models!.defaultModel).toBe('opus');
    expect(models!.models.length).toBeGreaterThan(0);
  });

  it('연결 전 cli 미지정 시 getAvailableModels는 null을 반환해야 합니다', () => {
    const client = new UnifiedAgentClient();
    expect(client.getAvailableModels()).toBeNull();
  });

  it('sessionId 옵션이 AcpConnection.connect()에 전달되어야 합니다', async () => {
    const connectSpy = vi
      .spyOn(AcpConnection.prototype, 'connect')
      .mockResolvedValue({ sessionId: 'resume-123' });
    vi.spyOn(AcpConnection.prototype, 'disconnect').mockResolvedValue();

    const client = new UnifiedAgentClient();
    await client.connect({
      cwd: process.cwd(),
      cli: 'claude',
      sessionId: 'resume-123',
    });

    expect(connectSpy).toHaveBeenCalledWith(
      process.cwd(),
      'resume-123',
    );

    expect(client.getConnectionInfo().sessionId).toBe('resume-123');

    await client.disconnect();
  });

  it('sessionId만으로 재개를 시도하면 에러가 발생해야 합니다', async () => {
    const client = new UnifiedAgentClient();

    await expect(
      client.connect({
        cwd: process.cwd(),
        sessionId: 'resume-123',
      }),
    ).rejects.toThrow('세션 재개 시 cli 지정이 필요합니다.');
  });

  it('sessionId 없이 connect하면 AcpConnection.connect()에 undefined가 전달되어야 합니다', async () => {
    const connectSpy = vi
      .spyOn(AcpConnection.prototype, 'connect')
      .mockResolvedValue({ sessionId: 'new-session' });
    vi.spyOn(AcpConnection.prototype, 'disconnect').mockResolvedValue();

    const client = new UnifiedAgentClient();
    await client.connect({ cwd: process.cwd(), cli: 'gemini' });

    expect(connectSpy).toHaveBeenCalledWith(
      process.cwd(),
      undefined,
    );

    await client.disconnect();
  });

  it('connect 실패 시 부분적으로 생성된 연결을 정리해야 합니다', async () => {
    const connectSpy = vi
      .spyOn(AcpConnection.prototype, 'connect')
      .mockRejectedValue(new Error('connect failed'));
    const disconnectSpy = vi
      .spyOn(AcpConnection.prototype, 'disconnect')
      .mockResolvedValue();

    const client = new UnifiedAgentClient();

    await expect(
      client.connect({
        cwd: process.cwd(),
        cli: 'gemini',
      }),
    ).rejects.toThrow('connect failed');

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(client.getConnectionInfo()).toEqual({
      cli: null,
      protocol: null,
      sessionId: null,
      state: 'disconnected',
    });
  });
});
