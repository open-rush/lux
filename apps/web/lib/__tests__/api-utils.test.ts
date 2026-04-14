import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuth = vi.fn();
vi.mock('@/auth', () => ({
  auth: () => mockAuth(),
}));

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
vi.mock('@open-rush/db', () => ({
  getDbClient: () => ({
    select: mockSelect,
  }),
  projects: { id: 'projects.id', createdBy: 'projects.createdBy', deletedAt: 'projects.deletedAt' },
}));

// Chain: db.select(...).from(...).where(...).limit(1) → [row]
function mockDbQuery(result: unknown[]) {
  mockLimit.mockResolvedValue(result);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}

const mockGetMembership = vi.fn();
vi.mock('@open-rush/control-plane', () => {
  class MockDrizzleMembershipDb {}
  class MockDbMembershipStore {
    getMembership = mockGetMembership;
  }
  return {
    DrizzleMembershipDb: MockDrizzleMembershipDb,
    DbMembershipStore: MockDbMembershipStore,
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => val),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  apiError,
  apiSuccess,
  getProjectRole,
  requireAuth,
  verifyProjectAccess,
} from '../api-utils';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// apiError / apiSuccess (pure functions)
// ---------------------------------------------------------------------------

describe('apiError', () => {
  it('returns JSON response with correct status', async () => {
    const res = apiError(404, 'NOT_FOUND', 'Resource not found');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Resource not found', code: 'NOT_FOUND' });
  });

  it('works with 400 status', async () => {
    const res = apiError(400, 'VALIDATION_ERROR', 'Invalid input');
    expect(res.status).toBe(400);
  });

  it('works with 500 status', async () => {
    const res = apiError(500, 'INTERNAL_ERROR', 'Server error');
    expect(res.status).toBe(500);
  });
});

describe('apiSuccess', () => {
  it('returns JSON response with default 200 status', async () => {
    const res = apiSuccess({ id: 'test-123' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { id: 'test-123' } });
  });

  it('accepts custom status code', async () => {
    const res = apiSuccess({ created: true }, 201);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { created: true } });
  });

  it('handles null data', async () => {
    const res = apiSuccess(null);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: null });
  });

  it('handles array data', async () => {
    const res = apiSuccess([1, 2, 3]);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: [1, 2, 3] });
  });
});

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

describe('requireAuth', () => {
  it('returns userId when session is valid', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    const userId = await requireAuth();
    expect(userId).toBe('user-1');
  });

  it('throws 401 Response when no session', async () => {
    mockAuth.mockResolvedValue(null);
    try {
      await requireAuth();
      expect.fail('Should have thrown');
    } catch (err) {
      const res = err as Response;
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe('UNAUTHORIZED');
    }
  });

  it('throws 401 Response when session has no user', async () => {
    mockAuth.mockResolvedValue({ user: null });
    try {
      await requireAuth();
      expect.fail('Should have thrown');
    } catch (err) {
      const res = err as Response;
      expect(res.status).toBe(401);
    }
  });

  it('throws 401 Response when user has no id', async () => {
    mockAuth.mockResolvedValue({ user: { name: 'Test' } });
    try {
      await requireAuth();
      expect.fail('Should have thrown');
    } catch (err) {
      const res = err as Response;
      expect(res.status).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// verifyProjectAccess
// ---------------------------------------------------------------------------

describe('verifyProjectAccess', () => {
  it('returns false when project not found', async () => {
    mockDbQuery([]);
    const result = await verifyProjectAccess('proj-1', 'user-1');
    expect(result).toBe(false);
  });

  it('returns false when project is soft-deleted', async () => {
    mockDbQuery([{ createdBy: 'user-1', deletedAt: new Date() }]);
    const result = await verifyProjectAccess('proj-1', 'user-1');
    expect(result).toBe(false);
  });

  it('returns true when user has membership', async () => {
    mockDbQuery([{ createdBy: 'other-user', deletedAt: null }]);
    mockGetMembership.mockResolvedValue({ role: 'member' });
    const result = await verifyProjectAccess('proj-1', 'user-1');
    expect(result).toBe(true);
  });

  it('returns true when user is project creator (fallback)', async () => {
    mockDbQuery([{ createdBy: 'user-1', deletedAt: null }]);
    mockGetMembership.mockResolvedValue(null);
    const result = await verifyProjectAccess('proj-1', 'user-1');
    expect(result).toBe(true);
  });

  it('returns false when not member and not creator', async () => {
    mockDbQuery([{ createdBy: 'other-user', deletedAt: null }]);
    mockGetMembership.mockResolvedValue(null);
    const result = await verifyProjectAccess('proj-1', 'user-1');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getProjectRole
// ---------------------------------------------------------------------------

describe('getProjectRole', () => {
  it('returns null when project not found', async () => {
    mockDbQuery([]);
    const role = await getProjectRole('proj-1', 'user-1');
    expect(role).toBeNull();
  });

  it('returns null when project is soft-deleted', async () => {
    mockDbQuery([{ createdBy: 'user-1', deletedAt: new Date() }]);
    const role = await getProjectRole('proj-1', 'user-1');
    expect(role).toBeNull();
  });

  it('returns membership role when member', async () => {
    mockDbQuery([{ createdBy: 'other-user', deletedAt: null }]);
    mockGetMembership.mockResolvedValue({ role: 'admin' });
    const role = await getProjectRole('proj-1', 'user-1');
    expect(role).toBe('admin');
  });

  it('returns owner role for creator fallback', async () => {
    mockDbQuery([{ createdBy: 'user-1', deletedAt: null }]);
    mockGetMembership.mockResolvedValue(null);
    const role = await getProjectRole('proj-1', 'user-1');
    expect(role).toBe('owner');
  });

  it('returns null when not member and not creator', async () => {
    mockDbQuery([{ createdBy: 'other-user', deletedAt: null }]);
    mockGetMembership.mockResolvedValue(null);
    const role = await getProjectRole('proj-1', 'user-1');
    expect(role).toBeNull();
  });

  it('returns member role', async () => {
    mockDbQuery([{ createdBy: 'other-user', deletedAt: null }]);
    mockGetMembership.mockResolvedValue({ role: 'member' });
    const role = await getProjectRole('proj-1', 'user-1');
    expect(role).toBe('member');
  });

  it('returns owner role from membership', async () => {
    mockDbQuery([{ createdBy: 'other-user', deletedAt: null }]);
    mockGetMembership.mockResolvedValue({ role: 'owner' });
    const role = await getProjectRole('proj-1', 'user-1');
    expect(role).toBe('owner');
  });
});
