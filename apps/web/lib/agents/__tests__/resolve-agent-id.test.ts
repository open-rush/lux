import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @open-rush/control-plane
// ---------------------------------------------------------------------------
const mockGetById = vi.fn();
const mockGetProjectAgents = vi.fn();
const mockCreate = vi.fn();
const mockGetCurrentAgent = vi.fn();
const mockSetCurrentAgent = vi.fn();

vi.mock('@open-rush/control-plane', () => {
  class MockDrizzleAgentConfigStore {
    getById = mockGetById;
    getProjectAgents = mockGetProjectAgents;
    create = mockCreate;
  }
  class MockProjectAgentService {
    getCurrentAgent = mockGetCurrentAgent;
    setCurrentAgent = mockSetCurrentAgent;
  }
  return {
    DrizzleAgentConfigStore: MockDrizzleAgentConfigStore,
    ProjectAgentService: MockProjectAgentService,
  };
});

// Mock randomUUID so we can predict the generated id.
vi.mock('node:crypto', () => ({
  randomUUID: () => 'generated-uuid-1234',
}));

import { resolveAgentIdForProject } from '../resolve-agent-id';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const db = {} as never; // Fake DbClient — the real one is never used thanks to mocks.
const PROJECT_ID = 'proj-1';
const USER_ID = 'user-1';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// With requestedAgentId
// ---------------------------------------------------------------------------
describe('with requestedAgentId', () => {
  it('validates the agent, sets it as current, and returns the id', async () => {
    const agentId = 'agent-42';
    mockGetById.mockResolvedValue({
      id: agentId,
      projectId: PROJECT_ID,
      status: 'active',
    });

    const result = await resolveAgentIdForProject({
      db,
      projectId: PROJECT_ID,
      userId: USER_ID,
      requestedAgentId: agentId,
    });

    expect(result).toBe(agentId);
    expect(mockGetById).toHaveBeenCalledWith(agentId);
    expect(mockSetCurrentAgent).toHaveBeenCalledWith(PROJECT_ID, agentId);
  });

  it('throws when the agent is not found', async () => {
    mockGetById.mockResolvedValue(null);

    await expect(
      resolveAgentIdForProject({
        db,
        projectId: PROJECT_ID,
        userId: USER_ID,
        requestedAgentId: 'missing-agent',
      })
    ).rejects.toThrow('Agent does not belong to this project');
  });

  it('throws when the agent belongs to a different project', async () => {
    mockGetById.mockResolvedValue({
      id: 'agent-42',
      projectId: 'other-project',
      status: 'active',
    });

    await expect(
      resolveAgentIdForProject({
        db,
        projectId: PROJECT_ID,
        userId: USER_ID,
        requestedAgentId: 'agent-42',
      })
    ).rejects.toThrow('Agent does not belong to this project');
  });

  it('throws when the agent is inactive', async () => {
    mockGetById.mockResolvedValue({
      id: 'agent-42',
      projectId: PROJECT_ID,
      status: 'archived',
    });

    await expect(
      resolveAgentIdForProject({
        db,
        projectId: PROJECT_ID,
        userId: USER_ID,
        requestedAgentId: 'agent-42',
      })
    ).rejects.toThrow('Agent does not belong to this project');
  });
});

// ---------------------------------------------------------------------------
// Without requestedAgentId — current agent exists
// ---------------------------------------------------------------------------
describe('without requestedAgentId, current agent exists', () => {
  it('returns the current agent id without creating anything', async () => {
    mockGetCurrentAgent.mockResolvedValue({ agentId: 'current-agent-99' });

    const result = await resolveAgentIdForProject({
      db,
      projectId: PROJECT_ID,
      userId: USER_ID,
    });

    expect(result).toBe('current-agent-99');
    expect(mockGetById).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSetCurrentAgent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Without requestedAgentId — no current, but project agents exist
// ---------------------------------------------------------------------------
describe('without requestedAgentId, no current but project agents exist', () => {
  it('uses the first project agent as fallback and sets it as current', async () => {
    mockGetCurrentAgent.mockResolvedValue(null);
    mockGetProjectAgents.mockResolvedValue([
      { id: 'fallback-agent-1' },
      { id: 'fallback-agent-2' },
    ]);

    const result = await resolveAgentIdForProject({
      db,
      projectId: PROJECT_ID,
      userId: USER_ID,
    });

    expect(result).toBe('fallback-agent-1');
    expect(mockSetCurrentAgent).toHaveBeenCalledWith(PROJECT_ID, 'fallback-agent-1');
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Without requestedAgentId — no agents at all
// ---------------------------------------------------------------------------
describe('without requestedAgentId, no agents at all', () => {
  it('creates a default agent, sets it as current, and returns the new id', async () => {
    mockGetCurrentAgent.mockResolvedValue(null);
    mockGetProjectAgents.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'generated-uuid-1234' });

    const result = await resolveAgentIdForProject({
      db,
      projectId: PROJECT_ID,
      userId: USER_ID,
    });

    expect(result).toBe('generated-uuid-1234');

    // Verify the create call includes the expected default agent fields.
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated-uuid-1234',
        projectId: PROJECT_ID,
        scope: 'project',
        status: 'active',
        name: 'Web Builder',
        maxSteps: 30,
        deliveryMode: 'workspace',
        createdBy: USER_ID,
      })
    );

    expect(mockSetCurrentAgent).toHaveBeenCalledWith(PROJECT_ID, 'generated-uuid-1234');
  });
});
