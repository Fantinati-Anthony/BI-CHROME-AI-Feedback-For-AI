import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/ai-client.js');
});

function memStorage() {
  const mem = {};
  return {
    get: (k) => Promise.resolve(mem[k] !== undefined ? { [k]: mem[k] } : {}),
    set: (o) => { Object.assign(mem, o); return Promise.resolve(); },
    _mem: mem,
  };
}

beforeEach(() => {
  window.MyFb.core.aiClient.__setStorageImpl(memStorage());
});

describe('aiClient — config storage', () => {
  it('getApiKey() returns null when nothing stored', async () => {
    expect(await window.MyFb.core.aiClient.getApiKey()).toBeNull();
  });

  it('setApiKey / getApiKey round-trips', async () => {
    await window.MyFb.core.aiClient.setApiKey('sk-ant-xxx');
    expect(await window.MyFb.core.aiClient.getApiKey()).toBe('sk-ant-xxx');
  });

  it('setApiKey trims whitespace', async () => {
    await window.MyFb.core.aiClient.setApiKey('  sk-ant-trim  ');
    expect(await window.MyFb.core.aiClient.getApiKey()).toBe('sk-ant-trim');
  });

  it('setApiKey("") stores null', async () => {
    await window.MyFb.core.aiClient.setApiKey('sk-ant-yyy');
    await window.MyFb.core.aiClient.setApiKey('');
    expect(await window.MyFb.core.aiClient.getApiKey()).toBeNull();
  });

  it('getModel() returns DEFAULT_MODEL when unset', async () => {
    const m = await window.MyFb.core.aiClient.getModel();
    expect(m).toBe(window.MyFb.core.aiClient.DEFAULT_MODEL);
  });

  it('setModel / getModel round-trips', async () => {
    await window.MyFb.core.aiClient.setModel('claude-opus-4-7');
    expect(await window.MyFb.core.aiClient.getModel()).toBe('claude-opus-4-7');
  });
});

describe('aiClient — MODELS catalog', () => {
  it('lists 3 models in opus/sonnet/haiku order', () => {
    const models = window.MyFb.core.aiClient.MODELS;
    expect(models.length).toBe(3);
    expect(models[0].tier).toBe('opus');
    expect(models[1].tier).toBe('sonnet');
    expect(models[2].tier).toBe('haiku');
    expect(models.every((m) => typeof m.id === 'string' && typeof m.label === 'string')).toBe(true);
  });
});

describe('aiClient — prompt builders', () => {
  it('summary prompt includes the text + URL + ref count', () => {
    const p = window.MyFb.core.aiClient._buildSummaryPrompt({
      text: 'Button broken',
      url:  'https://example.com/foo',
      refs: [{ type: 'element' }, { type: 'screenshot' }],
    });
    expect(p).toContain('Button broken');
    expect(p).toContain('https://example.com/foo');
    expect(p).toContain('2');
    expect(p).toContain('element, screenshot');
  });

  it('summary prompt handles empty inputs gracefully', () => {
    const p = window.MyFb.core.aiClient._buildSummaryPrompt({});
    expect(p).toContain('(empty)');
  });

  it('triage prompt asks for strict JSON schema', () => {
    const p = window.MyFb.core.aiClient._buildTriagePrompt({ text: 'bug' });
    expect(p).toContain('"status"');
    expect(p).toContain('"priority"');
    expect(p).toContain('"tags"');
    expect(p).toContain('"confidence"');
    expect(p).toContain('bug');
  });
});

describe('aiClient — complete() with mock fetch', () => {
  it('rejects with code=NO_KEY when no key configured', async () => {
    // setStorage to fresh empty
    window.MyFb.core.aiClient.__setStorageImpl(memStorage());
    await expect(window.MyFb.core.aiClient.complete('hi')).rejects.toThrow(/AI not configured/);
  });

  it('rejects with code=NO_KEY without a key, using default fetch path', async () => {
    try {
      await window.MyFb.core.aiClient.complete('hi');
      throw new Error('should not reach');
    } catch (e) {
      expect(e.code).toBe('NO_KEY');
    }
  });

  it('sends the prompt + headers and returns the response text', async () => {
    await window.MyFb.core.aiClient.setApiKey('sk-test');
    let captured;
    const fetchImpl = (url, opts) => {
      captured = { url, opts };
      return Promise.resolve({
        ok:   true,
        json: () => Promise.resolve({ content: [{ text: 'hi back' }] }),
      });
    };
    const txt = await window.MyFb.core.aiClient.complete('hello', { fetchImpl });
    expect(txt).toBe('hi back');
    expect(captured.url).toBe('https://api.anthropic.com/v1/messages');
    expect(captured.opts.headers['x-api-key']).toBe('sk-test');
    expect(captured.opts.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(captured.opts.body);
    expect(body.messages[0].content).toBe('hello');
    expect(body.model).toBeTruthy();
  });

  it('throws with code=RATE_LIMIT on 429', async () => {
    await window.MyFb.core.aiClient.setApiKey('sk-test');
    const fetchImpl = () => Promise.resolve({
      ok:     false,
      status: 429,
      text:   () => Promise.resolve('rate limited'),
    });
    try {
      await window.MyFb.core.aiClient.complete('hi', { fetchImpl });
      throw new Error('should not reach');
    } catch (e) {
      expect(e.code).toBe('RATE_LIMIT');
      expect(e.status).toBe(429);
    }
  });

  it('respects the model override option', async () => {
    await window.MyFb.core.aiClient.setApiKey('sk-test');
    let captured;
    const fetchImpl = (url, opts) => {
      captured = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ content: [{ text: 'x' }] }) });
    };
    await window.MyFb.core.aiClient.complete('hi', { fetchImpl, model: 'claude-opus-4-7' });
    expect(captured.model).toBe('claude-opus-4-7');
  });
});

describe('aiClient — suggestTriage parsing', () => {
  it('parses valid JSON output and normalizes values', async () => {
    await window.MyFb.core.aiClient.setApiKey('sk-test');
    const fetchImpl = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: '{"status":"accepted","priority":"high","tags":["bug","ui"],"confidence":0.85}' }] }),
    });
    const out = await window.MyFb.core.aiClient.suggestTriage({ text: 'bug' }, { fetchImpl });
    expect(out.status).toBe('accepted');
    expect(out.priority).toBe('high');
    expect(out.tags).toEqual(['bug', 'ui']);
    expect(out.confidence).toBeCloseTo(0.85);
  });

  it('strips ```json fences if the model adds them', async () => {
    await window.MyFb.core.aiClient.setApiKey('sk-test');
    const fetchImpl = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: '```json\n{"status":"new","priority":"low","tags":[],"confidence":0.4}\n```' }] }),
    });
    const out = await window.MyFb.core.aiClient.suggestTriage({ text: 'x' }, { fetchImpl });
    expect(out.status).toBe('new');
  });

  it('falls back to safe defaults on bogus values', async () => {
    await window.MyFb.core.aiClient.setApiKey('sk-test');
    const fetchImpl = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: '{"status":"banana","priority":"meh","tags":"not-array","confidence":99}' }] }),
    });
    const out = await window.MyFb.core.aiClient.suggestTriage({ text: 'x' }, { fetchImpl });
    expect(out.status).toBe('new');         // fallback
    expect(out.priority).toBe('medium');    // fallback
    expect(out.tags).toEqual([]);           // not array → []
    expect(out.confidence).toBe(1);         // clamped to [0,1]
  });

  it('throws on non-JSON output', async () => {
    await window.MyFb.core.aiClient.setApiKey('sk-test');
    const fetchImpl = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: 'not json at all' }] }),
    });
    await expect(window.MyFb.core.aiClient.suggestTriage({ text: 'x' }, { fetchImpl }))
      .rejects.toThrow(/invalid JSON/);
  });
});
