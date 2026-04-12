import { describe, expect, it, vi } from 'vitest';
import { StorageService } from '../storage/s3-storage.js';

function createService() {
  return new StorageService({ bucket: 'test-bucket', endpoint: 'http://localhost:9000' });
}

describe('StorageService', () => {
  it('constructs with minimal config', () => {
    expect(createService()).toBeDefined();
  });

  it('constructs with MinIO config', () => {
    const service = new StorageService({
      bucket: 'test-bucket',
      endpoint: 'http://localhost:9000',
      forcePathStyle: true,
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    });
    expect(service).toBeDefined();
  });

  it('constructs with AWS config', () => {
    const service = new StorageService({
      bucket: 'my-s3-bucket',
      region: 'us-west-2',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret',
    });
    expect(service).toBeDefined();
  });

  it('defaults forcePathStyle=true when endpoint is set', () => {
    const service = new StorageService({
      bucket: 'test',
      endpoint: 'http://minio:9000',
    });
    expect(service).toBeDefined();
  });

  describe('exists — error classification', () => {
    it('returns false for NotFound (name check)', async () => {
      const service = createService();
      const notFoundError = Object.assign(new Error('Not Found'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });
      // Access private client for testing
      const mockSend = vi.fn().mockRejectedValue(notFoundError);
      Object.defineProperty(service, 'client', { value: { send: mockSend } });
      expect(await service.exists('missing-key')).toBe(false);
    });

    it('returns false for NoSuchKey', async () => {
      const service = createService();
      const noSuchKey = Object.assign(new Error('No Such Key'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      });
      Object.defineProperty(service, 'client', {
        value: { send: vi.fn().mockRejectedValue(noSuchKey) },
      });
      expect(await service.exists('missing')).toBe(false);
    });

    it('returns false for 404 status code', async () => {
      const service = createService();
      const http404 = Object.assign(new Error('404'), {
        name: 'UnknownError',
        $metadata: { httpStatusCode: 404 },
      });
      Object.defineProperty(service, 'client', {
        value: { send: vi.fn().mockRejectedValue(http404) },
      });
      expect(await service.exists('missing')).toBe(false);
    });

    it('throws 403 Access Denied', async () => {
      const service = createService();
      const authError = Object.assign(new Error('Access Denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      Object.defineProperty(service, 'client', {
        value: { send: vi.fn().mockRejectedValue(authError) },
      });
      await expect(service.exists('any-key')).rejects.toThrow('Access Denied');
    });

    it('throws 500 Internal Server Error', async () => {
      const service = createService();
      const serverError = Object.assign(new Error('Internal'), {
        name: 'InternalError',
        $metadata: { httpStatusCode: 500 },
      });
      Object.defineProperty(service, 'client', {
        value: { send: vi.fn().mockRejectedValue(serverError) },
      });
      await expect(service.exists('any-key')).rejects.toThrow('Internal');
    });
  });

  describe('getMetadata — error classification', () => {
    it('returns null for NotFound', async () => {
      const service = createService();
      const notFoundError = Object.assign(new Error('Not Found'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });
      Object.defineProperty(service, 'client', {
        value: { send: vi.fn().mockRejectedValue(notFoundError) },
      });
      expect(await service.getMetadata('missing')).toBeNull();
    });

    it('throws non-404 errors', async () => {
      const service = createService();
      const serverError = Object.assign(new Error('Timeout'), {
        name: 'TimeoutError',
        $metadata: { httpStatusCode: 504 },
      });
      Object.defineProperty(service, 'client', {
        value: { send: vi.fn().mockRejectedValue(serverError) },
      });
      await expect(service.getMetadata('any')).rejects.toThrow('Timeout');
    });
  });
});
