import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchSandboxPool, DEFAULT_BATCH_CONFIG } from '../batch-sandbox.js';
import type { SandboxProvider } from '../provider.js';

// ---------------------------------------------------------------------------
// Mock SandboxProvider
// ---------------------------------------------------------------------------

function createMockProvider(): SandboxProvider {
  let idCounter = 0;
  return {
    create: vi.fn(async () => {
      idCounter++;
      return {
        id: `sbx-${idCounter}`,
        status: 'running' as const,
        endpoint: `http://localhost:${8000 + idCounter}`,
        previewUrl: null,
        createdAt: new Date(),
      };
    }),
    destroy: vi.fn(async () => {}),
    getInfo: vi.fn(async () => null),
    healthCheck: vi.fn(async () => true),
    getEndpointUrl: vi.fn(async () => null),
    exec: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BatchSandboxPool', () => {
  let provider: SandboxProvider;
  let pool: BatchSandboxPool;

  const smallConfig = {
    poolSize: 3,
    idleTimeoutMs: 60_000,
    maxLifetimeMs: 300_000,
    recycleCheckIntervalMs: 10_000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    provider = createMockProvider();
    pool = new BatchSandboxPool(provider, smallConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // DEFAULT_BATCH_CONFIG
  // -------------------------------------------------------------------------

  describe('DEFAULT_BATCH_CONFIG', () => {
    it('has expected default values', () => {
      expect(DEFAULT_BATCH_CONFIG.poolSize).toBe(5);
      expect(DEFAULT_BATCH_CONFIG.idleTimeoutMs).toBe(300_000);
      expect(DEFAULT_BATCH_CONFIG.maxLifetimeMs).toBe(3_600_000);
      expect(DEFAULT_BATCH_CONFIG.recycleCheckIntervalMs).toBe(60_000);
    });
  });

  // -------------------------------------------------------------------------
  // warmup()
  // -------------------------------------------------------------------------

  describe('warmup()', () => {
    it('creates poolSize sandboxes when pool is empty', async () => {
      const created = await pool.warmup({});
      expect(created).toBe(3);
      expect(provider.create).toHaveBeenCalledTimes(3);
      expect(pool.getStats()).toEqual({ total: 3, inUse: 0, available: 3 });
    });

    it('tops up pool when partially filled', async () => {
      // First warmup fills the pool
      await pool.warmup({});
      expect(pool.getStats().total).toBe(3);

      // Acquire one — marks it inUse but doesn't remove it
      await pool.acquire('agent-1');
      expect(pool.getStats()).toEqual({ total: 3, inUse: 1, available: 2 });

      // Second warmup should create 1 to bring available back to poolSize
      // warmup logic: poolSize - count(!inUse) = 3 - 2 = 1
      const created = await pool.warmup({});
      expect(created).toBe(1);
      expect(provider.create).toHaveBeenCalledTimes(4); // 3 + 1
      expect(pool.getStats()).toEqual({ total: 4, inUse: 1, available: 3 });
    });

    it('is a no-op when pool is already full of available sandboxes', async () => {
      await pool.warmup({});
      const created = await pool.warmup({});
      expect(created).toBe(0);
      expect(provider.create).toHaveBeenCalledTimes(3); // Only from the first warmup
    });

    it('passes options through to provider.create', async () => {
      await pool.warmup({ env: { NODE_ENV: 'test' }, ttlSeconds: 600 });

      const call = (provider.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.env).toEqual({ NODE_ENV: 'test' });
      expect(call.ttlSeconds).toBe(600);
      expect(call.agentId).toMatch(/^pool-/);
    });
  });

  // -------------------------------------------------------------------------
  // acquire()
  // -------------------------------------------------------------------------

  describe('acquire()', () => {
    it('returns a sandbox from the pool', async () => {
      await pool.warmup({});
      const info = await pool.acquire('agent-1');
      expect(info).not.toBeNull();
      expect(info?.id).toMatch(/^sbx-/);
    });

    it('marks the sandbox as inUse', async () => {
      await pool.warmup({});
      await pool.acquire('agent-1');
      expect(pool.getStats()).toEqual({ total: 3, inUse: 1, available: 2 });
    });

    it('returns null when all sandboxes are in use', async () => {
      await pool.warmup({});
      await pool.acquire('agent-1');
      await pool.acquire('agent-2');
      await pool.acquire('agent-3');

      const info = await pool.acquire('agent-4');
      expect(info).toBeNull();
      expect(pool.getStats()).toEqual({ total: 3, inUse: 3, available: 0 });
    });

    it('returns null when pool is empty', async () => {
      const info = await pool.acquire('agent-1');
      expect(info).toBeNull();
    });

    it('returns different sandboxes for successive acquires', async () => {
      await pool.warmup({});
      const info1 = await pool.acquire('agent-1');
      const info2 = await pool.acquire('agent-2');
      expect(info1).not.toBeNull();
      expect(info2).not.toBeNull();
      expect(info1?.id).not.toBe(info2?.id);
    });
  });

  // -------------------------------------------------------------------------
  // release()
  // -------------------------------------------------------------------------

  describe('release()', () => {
    it('marks sandbox as not inUse', async () => {
      await pool.warmup({});
      const info = await pool.acquire('agent-1');
      expect(pool.getStats().inUse).toBe(1);

      pool.release(info?.id ?? '');
      expect(pool.getStats()).toEqual({ total: 3, inUse: 0, available: 3 });
    });

    it('is a no-op for unknown sandboxId', () => {
      // Should not throw
      pool.release('sbx-unknown');
      expect(pool.getStats()).toEqual({ total: 0, inUse: 0, available: 0 });
    });

    it('allows sandbox to be re-acquired after release', async () => {
      await pool.warmup({});

      // Acquire all 3
      const info1 = await pool.acquire('agent-1');
      await pool.acquire('agent-2');
      await pool.acquire('agent-3');
      expect(pool.getStats().available).toBe(0);

      // Release one
      pool.release(info1?.id ?? '');
      expect(pool.getStats().available).toBe(1);

      // Re-acquire should succeed
      const reacquired = await pool.acquire('agent-4');
      expect(reacquired).not.toBeNull();
      expect(reacquired?.id).toBe(info1?.id);
    });
  });

  // -------------------------------------------------------------------------
  // recycleIdle()
  // -------------------------------------------------------------------------

  describe('recycleIdle()', () => {
    it('removes sandboxes that have been idle beyond idleTimeoutMs', async () => {
      await pool.warmup({});
      expect(pool.getStats().total).toBe(3);

      // Advance time past idle timeout
      vi.advanceTimersByTime(smallConfig.idleTimeoutMs + 1);

      const recycled = await pool.recycleIdle();
      expect(recycled).toBe(3);
      expect(provider.destroy).toHaveBeenCalledTimes(3);
      expect(pool.getStats()).toEqual({ total: 0, inUse: 0, available: 0 });
    });

    it('removes sandboxes that exceed maxLifetimeMs even if recently used', async () => {
      await pool.warmup({});

      // Acquire and release to refresh lastUsedAt
      const info = await pool.acquire('agent-1');
      pool.release(info?.id ?? '');

      // Advance time past max lifetime
      vi.advanceTimersByTime(smallConfig.maxLifetimeMs + 1);

      const recycled = await pool.recycleIdle();
      expect(recycled).toBe(3);
      expect(pool.getStats().total).toBe(0);
    });

    it('does not recycle sandboxes that are inUse and not expired', async () => {
      await pool.warmup({});
      await pool.acquire('agent-1');

      // Advance time past idle timeout but NOT past max lifetime
      vi.advanceTimersByTime(smallConfig.idleTimeoutMs + 1);

      const recycled = await pool.recycleIdle();
      // 2 idle sandboxes recycled, 1 inUse sandbox kept (not expired yet because
      // idleTimeoutMs < maxLifetimeMs and inUse sandboxes don't trigger idle check)
      expect(recycled).toBe(2);
      expect(pool.getStats()).toEqual({ total: 1, inUse: 1, available: 0 });
    });

    it('recycles inUse sandbox when maxLifetimeMs is exceeded', async () => {
      await pool.warmup({});
      await pool.acquire('agent-1');

      // Advance past max lifetime — even inUse sandboxes get recycled
      vi.advanceTimersByTime(smallConfig.maxLifetimeMs + 1);

      const recycled = await pool.recycleIdle();
      expect(recycled).toBe(3);
      expect(pool.getStats()).toEqual({ total: 0, inUse: 0, available: 0 });
    });

    it('calls provider.destroy for each recycled sandbox', async () => {
      await pool.warmup({});

      vi.advanceTimersByTime(smallConfig.idleTimeoutMs + 1);

      await pool.recycleIdle();
      expect(provider.destroy).toHaveBeenCalledTimes(3);
      // Each sandbox ID should have been passed to destroy
      const destroyedIds = (provider.destroy as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[0]
      );
      expect(destroyedIds).toHaveLength(3);
      for (const id of destroyedIds) {
        expect(id).toMatch(/^sbx-/);
      }
    });

    it('returns 0 when no sandboxes need recycling', async () => {
      await pool.warmup({});

      // No time has passed — nothing idle
      const recycled = await pool.recycleIdle();
      expect(recycled).toBe(0);
      expect(provider.destroy).not.toHaveBeenCalled();
    });

    it('returns 0 on empty pool', async () => {
      const recycled = await pool.recycleIdle();
      expect(recycled).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getStats()
  // -------------------------------------------------------------------------

  describe('getStats()', () => {
    it('returns zeros for empty pool', () => {
      expect(pool.getStats()).toEqual({ total: 0, inUse: 0, available: 0 });
    });

    it('reflects accurate counts after warmup', async () => {
      await pool.warmup({});
      expect(pool.getStats()).toEqual({ total: 3, inUse: 0, available: 3 });
    });

    it('reflects accurate counts after acquire', async () => {
      await pool.warmup({});
      await pool.acquire('agent-1');
      await pool.acquire('agent-2');
      expect(pool.getStats()).toEqual({ total: 3, inUse: 2, available: 1 });
    });

    it('reflects accurate counts after release', async () => {
      await pool.warmup({});
      const info = await pool.acquire('agent-1');
      pool.release(info?.id ?? '');
      expect(pool.getStats()).toEqual({ total: 3, inUse: 0, available: 3 });
    });

    it('reflects accurate counts after recycle', async () => {
      await pool.warmup({});

      vi.advanceTimersByTime(smallConfig.idleTimeoutMs + 1);
      await pool.recycleIdle();

      expect(pool.getStats()).toEqual({ total: 0, inUse: 0, available: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // Full lifecycle
  // -------------------------------------------------------------------------

  describe('full lifecycle', () => {
    it('warmup -> acquire -> release -> recycleIdle', async () => {
      // 1. Warmup
      const created = await pool.warmup({});
      expect(created).toBe(3);
      expect(pool.getStats()).toEqual({ total: 3, inUse: 0, available: 3 });

      // 2. Acquire two sandboxes
      const info1 = await pool.acquire('agent-1');
      const info2 = await pool.acquire('agent-2');
      expect(info1).not.toBeNull();
      expect(info2).not.toBeNull();
      expect(pool.getStats()).toEqual({ total: 3, inUse: 2, available: 1 });

      // 3. Release one
      pool.release(info1?.id ?? '');
      expect(pool.getStats()).toEqual({ total: 3, inUse: 1, available: 2 });

      // 4. Advance time so idle ones should be recycled
      vi.advanceTimersByTime(smallConfig.idleTimeoutMs + 1);

      const recycled = await pool.recycleIdle();
      // 2 available sandboxes are idle, 1 inUse sandbox is not idle
      // (but all 3 are still within maxLifetimeMs so only idle check matters)
      expect(recycled).toBe(2);
      expect(pool.getStats()).toEqual({ total: 1, inUse: 1, available: 0 });

      // 5. Release the last one and recycle
      pool.release(info2?.id ?? '');
      // Need to advance time again for the newly released one to become idle
      vi.advanceTimersByTime(smallConfig.idleTimeoutMs + 1);
      const recycled2 = await pool.recycleIdle();
      expect(recycled2).toBe(1);
      expect(pool.getStats()).toEqual({ total: 0, inUse: 0, available: 0 });
    });
  });
});
