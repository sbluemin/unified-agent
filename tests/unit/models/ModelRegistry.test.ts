import { describe, it, expect } from 'vitest';
import {
  getModelsRegistry,
  getProviderModels,
  getProviderModelIds,
  getReasoningEffortLevels,
} from '../../../src/models/ModelRegistry.js';
import { ModelsRegistrySchema, ProviderSchema } from '../../../src/models/schemas.js';
import modelsData from '../../../models.json';

describe('ModelsRegistrySchema 검증', () => {
  it('models.json이 스키마에 맞아야 합니다', () => {
    const result = ModelsRegistrySchema.parse(modelsData);
    expect(result.version).toBe(1);
    expect(result.updatedAt).toBeDefined();
    expect(Object.keys(result.providers).length).toBeGreaterThanOrEqual(3);
  });

  it('잘못된 데이터는 스키마 검증에 실패해야 합니다', () => {
    expect(() =>
      ModelsRegistrySchema.parse({ version: 'wrong', providers: {} }),
    ).toThrow();
  });

  it('defaultModel이 models에 없으면 검증에 실패해야 합니다', () => {
    const result = ProviderSchema.safeParse({
      name: 'Test',
      defaultModel: 'missing',
      models: [{ modelId: 'sonnet', name: 'Sonnet' }],
      reasoningEffort: { supported: false },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.code === 'custom' && i.path?.includes('defaultModel'),
      );
      expect(issue).toBeDefined();
    }
  });

  it('reasoningEffort.default가 levels에 없으면 검증에 실패해야 합니다', () => {
    const result = ProviderSchema.safeParse({
      name: 'Test',
      defaultModel: 'sonnet',
      models: [{ modelId: 'sonnet', name: 'Sonnet' }],
      reasoningEffort: { supported: true, levels: ['low', 'high'], default: 'ultra' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.code === 'custom' && i.path?.some((p) => p === 'reasoningEffort'),
      );
      expect(issue).toBeDefined();
    }
  });
});

describe('getModelsRegistry', () => {
  it('전체 레지스트리를 반환해야 합니다', () => {
    const registry = getModelsRegistry();
    expect(registry.version).toBe(1);
    expect(registry.providers.claude).toBeDefined();
    expect(registry.providers.codex).toBeDefined();
    expect(registry.providers.gemini).toBeDefined();
  });

  it('반환된 객체의 최상위 필드를 수정해도 내부 데이터가 오염되지 않아야 합니다', () => {
    const a = getProviderModels('claude');
    a.defaultModel = 'mutated';
    const b = getProviderModels('claude');
    expect(b.defaultModel).toBe('opus');
  });

  it('반환된 객체의 중첩 구조를 수정해도 내부 데이터가 오염되지 않아야 합니다', () => {
    const a = getProviderModels('claude');
    a.models[0].modelId = 'mutated';
    if (a.reasoningEffort.supported) {
      a.reasoningEffort.levels.push('ultra');
    }
    const b = getProviderModels('claude');
    expect(b.models[0].modelId).toBe('haiku');
    if (b.reasoningEffort.supported) {
      expect(b.reasoningEffort.levels).toEqual(['none', 'low', 'medium', 'high']);
    }
  });
});

describe('getProviderModels', () => {
  it('claude 프로바이더 정보를 반환해야 합니다', () => {
    const provider = getProviderModels('claude');
    expect(provider.name).toBe('Anthropic Claude Code');
    expect(provider.defaultModel).toBe('opus');
    expect(provider.models.length).toBe(3);
    expect(provider.models.map((m) => m.modelId)).toContain('opus');
  });

  it('codex 프로바이더 정보를 반환해야 합니다', () => {
    const provider = getProviderModels('codex');
    expect(provider.name).toBe('OpenAI Codex CLI');
    expect(provider.defaultModel).toBe('gpt-5.4');
    expect(provider.models.length).toBe(3);
  });

  it('gemini 프로바이더 정보를 반환해야 합니다', () => {
    const provider = getProviderModels('gemini');
    expect(provider.name).toBe('Google Gemini CLI');
    expect(provider.defaultModel).toBe('gemini-3.1-pro-preview');
    expect(provider.models.length).toBe(2);
  });

  it('존재하지 않는 프로바이더는 에러를 던져야 합니다', () => {
    // @ts-expect-error -- 의도적으로 잘못된 값 전달
    expect(() => getProviderModels('unknown')).toThrow('알 수 없는 프로바이더');
  });
});

describe('getProviderModelIds', () => {
  it('claude 모델 ID 목록을 반환해야 합니다', () => {
    const ids = getProviderModelIds('claude');
    expect(ids).toEqual(['haiku', 'sonnet', 'opus']);
  });

  it('codex 모델 ID 목록을 반환해야 합니다', () => {
    const ids = getProviderModelIds('codex');
    expect(ids).toEqual(['gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.4']);
  });
});

describe('getReasoningEffortLevels', () => {
  it('claude의 reasoning effort 레벨을 반환해야 합니다', () => {
    const levels = getReasoningEffortLevels('claude');
    expect(levels).toEqual(['none', 'low', 'medium', 'high']);
  });

  it('codex의 reasoning effort 레벨을 반환해야 합니다', () => {
    const levels = getReasoningEffortLevels('codex');
    expect(levels).toEqual(['none', 'low', 'medium', 'high', 'xhigh']);
  });

  it('gemini는 reasoning effort 미지원이므로 null을 반환해야 합니다', () => {
    const levels = getReasoningEffortLevels('gemini');
    expect(levels).toBeNull();
  });
});
