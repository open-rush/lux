import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREVIEW_CONFIG, PreviewService } from '../preview.js';
import type { SandboxProvider } from '../provider.js';

// ---------------------------------------------------------------------------
// Mock SandboxProvider
// ---------------------------------------------------------------------------

function createMockProvider(): SandboxProvider {
  return {
    create: vi.fn(async () => ({
      id: 'sbx-1',
      status: 'running' as const,
      endpoint: 'http://localhost:8787',
      previewUrl: 'http://localhost:8000',
      createdAt: new Date(),
    })),
    destroy: vi.fn(async () => {}),
    getInfo: vi.fn(async () => null),
    healthCheck: vi.fn(async () => true),
    getEndpointUrl: vi.fn(async () => 'http://localhost:8000'),
    exec: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  };
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PreviewService', () => {
  let provider: SandboxProvider;
  let service: PreviewService;

  beforeEach(() => {
    provider = createMockProvider();
    service = new PreviewService(provider);
  });

  // -------------------------------------------------------------------------
  // DEFAULT_PREVIEW_CONFIG
  // -------------------------------------------------------------------------

  describe('DEFAULT_PREVIEW_CONFIG', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_PREVIEW_CONFIG.devServerPort).toBe(8000);
      expect(DEFAULT_PREVIEW_CONFIG.healthCheckPath).toBe('/');
      expect(DEFAULT_PREVIEW_CONFIG.healthCheckIntervalMs).toBe(2000);
      expect(DEFAULT_PREVIEW_CONFIG.healthCheckTimeoutMs).toBe(5000);
      expect(DEFAULT_PREVIEW_CONFIG.maxStartupWaitMs).toBe(30000);
    });
  });

  // -------------------------------------------------------------------------
  // startDevServer()
  // -------------------------------------------------------------------------

  describe('startDevServer()', () => {
    it('returns running=true with URL for a healthy sandbox', async () => {
      const status = await service.startDevServer('sbx-1');

      expect(status.running).toBe(true);
      expect(status.url).toBe('http://localhost:8000');
      expect(status.healthy).toBe(true);
      expect(status.startedAt).toBeInstanceOf(Date);
    });

    it('returns running=false when sandbox is unhealthy', async () => {
      (provider.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const status = await service.startDevServer('sbx-1');

      expect(status.running).toBe(false);
      expect(status.url).toBeNull();
      expect(status.healthy).toBe(false);
      expect(status.startedAt).toBeNull();
    });

    it('does not call exec or getEndpointUrl when unhealthy', async () => {
      (provider.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      await service.startDevServer('sbx-1');

      expect(provider.exec).not.toHaveBeenCalled();
      expect(provider.getEndpointUrl).not.toHaveBeenCalled();
    });

    it('uses default command "npm run dev"', async () => {
      await service.startDevServer('sbx-1');

      expect(provider.exec).toHaveBeenCalledWith('sbx-1', 'npm run dev');
    });

    it('uses custom command when provided', async () => {
      await service.startDevServer('sbx-1', 'pnpm dev');

      expect(provider.exec).toHaveBeenCalledWith('sbx-1', 'pnpm dev');
    });

    it('calls getEndpointUrl with configured devServerPort', async () => {
      const customService = new PreviewService(provider, {
        ...DEFAULT_PREVIEW_CONFIG,
        devServerPort: 3000,
      });

      await customService.startDevServer('sbx-1');

      expect(provider.getEndpointUrl).toHaveBeenCalledWith('sbx-1', 3000);
    });

    it('returns url=null when getEndpointUrl returns null', async () => {
      (provider.getEndpointUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const status = await service.startDevServer('sbx-1');

      expect(status.running).toBe(true);
      expect(status.url).toBeNull();
      expect(status.healthy).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // waitForReady()
  // -------------------------------------------------------------------------

  describe('waitForReady()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns true when health check succeeds immediately', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      globalThis.fetch = fetchMock as typeof fetch;

      const promise = service.waitForReady('sbx-1');

      // Flush the first iteration (no setTimeout yet since fetch succeeds)
      await vi.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/');
    });

    it('returns true after several failed attempts', async () => {
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return { ok: false };
        }
        return { ok: true };
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const promise = service.waitForReady('sbx-1');

      // First attempt — fails, then waits healthCheckIntervalMs
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(DEFAULT_PREVIEW_CONFIG.healthCheckIntervalMs);
      // Second attempt — fails, then waits again
      await vi.advanceTimersByTimeAsync(DEFAULT_PREVIEW_CONFIG.healthCheckIntervalMs);
      // Third attempt — succeeds

      const result = await promise;
      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('returns false when maxStartupWaitMs is exceeded', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false });
      globalThis.fetch = fetchMock as typeof fetch;

      const promise = service.waitForReady('sbx-1');

      // Advance well past the max wait time
      await vi.advanceTimersByTimeAsync(DEFAULT_PREVIEW_CONFIG.maxStartupWaitMs + 1000);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('handles fetch errors gracefully and retries', async () => {
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Connection refused');
        }
        return { ok: true };
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const promise = service.waitForReady('sbx-1');

      // First attempt — throws, wait
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(DEFAULT_PREVIEW_CONFIG.healthCheckIntervalMs);
      // Second attempt — throws, wait
      await vi.advanceTimersByTimeAsync(DEFAULT_PREVIEW_CONFIG.healthCheckIntervalMs);
      // Third attempt — succeeds

      const result = await promise;
      expect(result).toBe(true);
    });

    it('returns false when getEndpointUrl always returns null', async () => {
      (provider.getEndpointUrl as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as typeof fetch;

      const promise = service.waitForReady('sbx-1');

      await vi.advanceTimersByTimeAsync(DEFAULT_PREVIEW_CONFIG.maxStartupWaitMs + 1000);

      const result = await promise;
      expect(result).toBe(false);
      // fetch should never be called since url is null
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('uses configured healthCheckPath', async () => {
      const customService = new PreviewService(provider, {
        ...DEFAULT_PREVIEW_CONFIG,
        healthCheckPath: '/healthz',
      });

      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      globalThis.fetch = fetchMock as typeof fetch;

      const promise = customService.waitForReady('sbx-1');
      await vi.advanceTimersByTimeAsync(0);
      await promise;

      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/healthz');
    });
  });

  // -------------------------------------------------------------------------
  // getPreviewUrl()
  // -------------------------------------------------------------------------

  describe('getPreviewUrl()', () => {
    it('proxies to provider.getEndpointUrl with configured port', async () => {
      const url = await service.getPreviewUrl('sbx-1');

      expect(url).toBe('http://localhost:8000');
      expect(provider.getEndpointUrl).toHaveBeenCalledWith(
        'sbx-1',
        DEFAULT_PREVIEW_CONFIG.devServerPort
      );
    });

    it('returns null when provider returns null', async () => {
      (provider.getEndpointUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const url = await service.getPreviewUrl('sbx-1');

      expect(url).toBeNull();
    });

    it('uses custom devServerPort from config', async () => {
      const customService = new PreviewService(provider, {
        ...DEFAULT_PREVIEW_CONFIG,
        devServerPort: 3000,
      });

      await customService.getPreviewUrl('sbx-1');

      expect(provider.getEndpointUrl).toHaveBeenCalledWith('sbx-1', 3000);
    });
  });
});
