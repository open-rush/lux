import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface CryptoService {
  encrypt(plaintext: string): string;
  decrypt(encrypted: string): string;
}

export function createCryptoService(masterKeyBase64: string): CryptoService {
  const key = Buffer.from(masterKeyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error(`Invalid master key: expected 32 bytes, got ${key.length}`);
  }

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
    },

    decrypt(encrypted: string): string {
      const parts = encrypted.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted format: expected iv:authTag:ciphertext');
      }

      const iv = Buffer.from(parts[0], 'base64');
      const authTag = Buffer.from(parts[1], 'base64');
      const ciphertext = Buffer.from(parts[2], 'base64');

      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAuthTag(authTag);
      return decipher.update(ciphertext) + decipher.final('utf8');
    },
  };
}

export function generateMasterKey(): string {
  return randomBytes(32).toString('base64');
}
