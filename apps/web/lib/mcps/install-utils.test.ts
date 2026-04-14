/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: test file uses literal ${var} strings intentionally */
/**
 * 安装链路集成测试：extraConfig merge → 模板替换 → 最终 serverConfig
 *
 * 对齐 Rush PR #753 (kanyun-inc/rush-app#753) 的 install-flow.test.ts
 */

import { describe, expect, it } from 'vitest';
import { extractConfigVariables, mergeExtraConfigIntoServerConfig } from './install-utils';

// ============================================================================
// stdio: extraConfig → 模板替换 → 最终 serverConfig
// ============================================================================

describe('安装链路 — stdio 类型', () => {
  it('extraConfig 值通过 ${var} 模板替换到 env 中', () => {
    const serverConfig = {
      command: 'npx',
      args: ['-y', '@demo/mcp'],
      env: {
        DB_URL: 'postgres://${db_user}:${db_pass}@localhost/mydb',
        API_TOKEN: '${token}',
      },
    };
    const result = mergeExtraConfigIntoServerConfig('stdio', serverConfig, {
      db_user: 'admin',
      db_pass: 's3cret',
      token: 'tk-abc',
    });
    expect(result.env).toEqual({
      DB_URL: 'postgres://admin:s3cret@localhost/mydb',
      API_TOKEN: 'tk-abc',
    });
    expect(result.command).toBe('npx');
    expect(result.args).toEqual(['-y', '@demo/mcp']);
  });

  it('未被模板消费的 extraConfig 值追加到 env', () => {
    const serverConfig = {
      command: 'npx',
      args: ['-y', '@demo/mcp'],
      env: { EXISTING: 'value' },
    };
    const result = mergeExtraConfigIntoServerConfig('stdio', serverConfig, {
      NEW_KEY: 'new-value',
      ANOTHER: 'another-value',
    });
    expect(result.env).toEqual({
      EXISTING: 'value',
      NEW_KEY: 'new-value',
      ANOTHER: 'another-value',
    });
  });

  it('混合场景：部分模板消费 + 部分追加到 env', () => {
    const serverConfig = {
      command: 'node',
      args: ['server.js'],
      env: { API_TOKEN: '${token}', MODE: 'production' },
    };
    const result = mergeExtraConfigIntoServerConfig('stdio', serverConfig, {
      token: 'sk-123',
      EXTRA_VAR: 'extra-value',
    });
    expect((result.env as Record<string, string>).API_TOKEN).toBe('sk-123');
    expect((result.env as Record<string, string>).EXTRA_VAR).toBe('extra-value');
    expect((result.env as Record<string, string>).MODE).toBe('production');
    // token 已被模板消费，不应重复追加
    expect((result.env as Record<string, string>).token).toBeUndefined();
  });

  it('空 extraConfigValues 返回原 serverConfig', () => {
    const serverConfig = { command: 'npx', args: ['-y', 'demo'], env: { KEY: '${var}' } };
    const result = mergeExtraConfigIntoServerConfig('stdio', serverConfig, {});
    expect(result).toBe(serverConfig);
  });
});

// ============================================================================
// sse/http: extraConfig → 模板替换 → 最终 serverConfig
// ============================================================================

describe('安装链路 — sse/http 类型', () => {
  it('extraConfig 值通过 ${var} 模板替换到 headers 中', () => {
    const serverConfig = {
      url: 'https://api.example.com/mcp',
      headers: {
        Authorization: 'Bearer ${token}',
        'X-Workspace': '${workspace_id}',
      },
    };
    const result = mergeExtraConfigIntoServerConfig('sse', serverConfig, {
      token: 'sk-test-abc',
      workspace_id: 'ws-001',
    });
    expect(result.headers).toEqual({
      Authorization: 'Bearer sk-test-abc',
      'X-Workspace': 'ws-001',
    });
    expect(result.url).toBe('https://api.example.com/mcp');
  });

  it('未被模板消费的 extraConfig 值追加到 headers', () => {
    const serverConfig = {
      url: 'https://api.example.com/mcp',
      headers: { 'Content-Type': 'application/json' },
    };
    const result = mergeExtraConfigIntoServerConfig('http', serverConfig, {
      Authorization: 'Bearer sk-123',
      'X-Custom': 'custom-value',
    });
    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-123',
      'X-Custom': 'custom-value',
    });
  });

  it('混合场景：部分模板消费 + 部分追加到 headers', () => {
    const serverConfig = {
      url: 'https://api.example.com/mcp',
      headers: { Authorization: 'Bearer ${api_key}', 'Content-Type': 'application/json' },
    };
    const result = mergeExtraConfigIntoServerConfig('sse', serverConfig, {
      api_key: 'sk-real-key',
      'X-Org-Id': 'org-456',
    });
    expect((result.headers as Record<string, string>).Authorization).toBe('Bearer sk-real-key');
    expect((result.headers as Record<string, string>)['X-Org-Id']).toBe('org-456');
    expect((result.headers as Record<string, string>).api_key).toBeUndefined();
    expect((result.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});

// ============================================================================
// extractConfigVariables + mergeExtraConfigIntoServerConfig 端到端
// ============================================================================

describe('安装链路 — 变量检测 + merge 端到端', () => {
  it('extractConfigVariables 检测出的变量名与 merge 时的模板替换一致', () => {
    const serverConfig = {
      url: 'https://api.example.com/mcp',
      headers: { Authorization: 'Bearer ${token}', 'X-Workspace': '${workspace_id}' },
    };
    const detectedVars = extractConfigVariables(serverConfig);
    expect(detectedVars).toEqual(expect.arrayContaining(['token', 'workspace_id']));
    expect(detectedVars).toHaveLength(2);

    const values: Record<string, string> = {};
    for (const v of detectedVars) values[v] = `value-for-${v}`;
    const result = mergeExtraConfigIntoServerConfig('http', serverConfig, values);
    expect(result.headers).toEqual({
      Authorization: 'Bearer value-for-token',
      'X-Workspace': 'value-for-workspace_id',
    });
  });

  it('stdio: extractConfigVariables 从 env 检测 + merge 端到端', () => {
    const serverConfig = {
      command: 'npx',
      args: ['-y', '@demo/mcp-server'],
      env: { API_KEY: '${api_key}', BASE_URL: 'https://api.example.com/${region}/v1' },
    };
    const detectedVars = extractConfigVariables(serverConfig);
    expect(detectedVars).toEqual(expect.arrayContaining(['api_key', 'region']));

    const result = mergeExtraConfigIntoServerConfig('stdio', serverConfig, {
      api_key: 'sk-real',
      region: 'us-east-1',
    });
    expect(result.env).toEqual({
      API_KEY: 'sk-real',
      BASE_URL: 'https://api.example.com/us-east-1/v1',
    });
  });

  it('多个变量在同一个 header value 中被同时替换', () => {
    const serverConfig = {
      url: 'https://api.example.com/mcp',
      headers: { Authorization: '${scheme} ${token}' },
    };
    const result = mergeExtraConfigIntoServerConfig('http', serverConfig, {
      scheme: 'Bearer',
      token: 'sk-abc',
    });
    expect(result.headers).toEqual({ Authorization: 'Bearer sk-abc' });
  });

  it('无模板变量时，extraConfigValues 全部追加', () => {
    const serverConfig = {
      url: 'https://api.example.com/mcp',
      headers: { 'Content-Type': 'application/json' },
    };
    const result = mergeExtraConfigIntoServerConfig('http', serverConfig, {
      Authorization: 'Bearer token',
      'X-Custom': 'value',
    });
    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token',
      'X-Custom': 'value',
    });
  });

  it('不修改原 serverConfig 对象', () => {
    const serverConfig = {
      url: 'https://api.example.com/mcp',
      headers: { Authorization: 'Bearer ${token}' },
    };
    const original = JSON.stringify(serverConfig);
    mergeExtraConfigIntoServerConfig('http', serverConfig, { token: 'replaced' });
    expect(JSON.stringify(serverConfig)).toBe(original);
  });
});
