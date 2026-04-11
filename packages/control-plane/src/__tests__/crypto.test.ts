import { describe, expect, it } from 'vitest';
import { createCryptoService, generateMasterKey } from '../vault/crypto.js';

describe('CryptoService', () => {
  const masterKey = generateMasterKey();

  it('encrypts and decrypts roundtrip', () => {
    const crypto = createCryptoService(masterKey);
    const plaintext = 'sk-ant-api-key-123456';
    const encrypted = crypto.encrypt(plaintext);
    const decrypted = crypto.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for same plaintext (unique IV)', () => {
    const crypto = createCryptoService(masterKey);
    const plaintext = 'same-value';
    const e1 = crypto.encrypt(plaintext);
    const e2 = crypto.encrypt(plaintext);
    expect(e1).not.toBe(e2);

    expect(crypto.decrypt(e1)).toBe(plaintext);
    expect(crypto.decrypt(e2)).toBe(plaintext);
  });

  it('encrypted format is iv:authTag:ciphertext', () => {
    const crypto = createCryptoService(masterKey);
    const encrypted = crypto.encrypt('test');
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
  });

  it('rejects invalid master key length', () => {
    const shortKey = Buffer.from('short').toString('base64');
    expect(() => createCryptoService(shortKey)).toThrow('Invalid master key');
  });

  it('detects tampered ciphertext', () => {
    const crypto = createCryptoService(masterKey);
    const encrypted = crypto.encrypt('secret');
    const parts = encrypted.split(':');
    const tampered = `${parts[0]}:${parts[1]}:${Buffer.from('tampered').toString('base64')}`;
    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('rejects wrong key for decryption', () => {
    const crypto1 = createCryptoService(masterKey);
    const crypto2 = createCryptoService(generateMasterKey());
    const encrypted = crypto1.encrypt('secret');
    expect(() => crypto2.decrypt(encrypted)).toThrow();
  });

  it('rejects invalid encrypted format', () => {
    const crypto = createCryptoService(masterKey);
    expect(() => crypto.decrypt('not-valid-format')).toThrow('Invalid encrypted format');
  });

  it('handles empty string', () => {
    const crypto = createCryptoService(masterKey);
    const encrypted = crypto.encrypt('');
    expect(crypto.decrypt(encrypted)).toBe('');
  });

  it('handles unicode content', () => {
    const crypto = createCryptoService(masterKey);
    const plaintext = '密钥值 🔑 credential';
    const encrypted = crypto.encrypt(plaintext);
    expect(crypto.decrypt(encrypted)).toBe(plaintext);
  });

  it('generateMasterKey produces 32-byte base64 key', () => {
    const key = generateMasterKey();
    const buf = Buffer.from(key, 'base64');
    expect(buf.length).toBe(32);
  });
});
