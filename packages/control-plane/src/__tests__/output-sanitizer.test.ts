import { describe, expect, it } from 'vitest';
import { containsCredentials, sanitize } from '../vault/output-sanitizer.js';

describe('OutputSanitizer', () => {
  describe('sanitize', () => {
    it('redacts AWS access keys', () => {
      const text = 'My key is AKIAIOSFODNN7EXAMPLE and stuff';
      expect(sanitize(text)).toBe('My key is [REDACTED] and stuff');
    });

    it('redacts Anthropic API keys', () => {
      const text = 'Using sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
      expect(sanitize(text)).toBe('Using [REDACTED]');
    });

    it('redacts OpenAI API keys', () => {
      const text = 'key: sk-abcdefghijklmnopqrstuvwxyz1234567890';
      expect(sanitize(text)).toBe('key: [REDACTED]');
    });

    it('redacts OpenAI project-scoped keys (sk-proj-...)', () => {
      const text = 'key: sk-proj-abcdefghijklmnopqr-stuvwxyz1234567890';
      expect(sanitize(text)).toBe('key: [REDACTED]');
    });

    it('redacts GitHub PATs', () => {
      const text = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
      expect(sanitize(text)).toBe('token: [REDACTED]');
    });

    it('redacts GitHub OAuth tokens', () => {
      const text = 'gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
      expect(sanitize(text)).toBe('[REDACTED]');
    });

    it('redacts GitHub App tokens', () => {
      const text = 'ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
      expect(sanitize(text)).toBe('[REDACTED]');
    });

    it('redacts multiple credentials in same text', () => {
      const text = 'AWS: AKIAIOSFODNN7EXAMPLE, OpenAI: sk-abcdefghijklmnopqrstuvwxyz1234567890';
      const result = sanitize(text);
      expect(result).toBe('AWS: [REDACTED], OpenAI: [REDACTED]');
    });

    it('does not modify text without credentials', () => {
      const text = 'This is normal text without any secrets';
      expect(sanitize(text)).toBe(text);
    });

    it('does not false-positive on short sk- prefix', () => {
      const text = 'sk-short is not a key';
      expect(sanitize(text)).toBe('sk-short is not a key');
    });

    it('handles empty string', () => {
      expect(sanitize('')).toBe('');
    });
  });

  describe('containsCredentials', () => {
    it('returns true when credentials present', () => {
      expect(containsCredentials('key: AKIAIOSFODNN7EXAMPLE')).toBe(true);
    });

    it('returns false when no credentials', () => {
      expect(containsCredentials('just normal text')).toBe(false);
    });
  });
});
