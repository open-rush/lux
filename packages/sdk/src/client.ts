/**
 * `OpenRushClient` — the public SDK entry point.
 *
 * Usage (Service Token):
 *
 *     import { OpenRushClient } from '@open-rush/sdk';
 *     const client = new OpenRushClient({
 *       baseUrl: 'https://rush.example.com',
 *       token: process.env.OPEN_RUSH_TOKEN,
 *     });
 *     const { data: agent } = await client.agents.create({
 *       definitionId,
 *       projectId,
 *       mode: 'chat',
 *       initialInput: 'hi',
 *     });
 *
 * Resource namespaces mirror the API surface 1:1 (spec §Endpoint 清单):
 *   - `authTokens` — issue / list / revoke Service Tokens
 *   - `agentDefinitions` — versioned blueprint CRUD
 *   - `agents` — Agent (task row) CRUD
 *   - `runs` — Run lifecycle + event stream
 *   - `vaults` — credential entries
 *   - `skills` / `mcps` — read-only registries
 *   - `projects` — project minimal CRUD
 *
 * Why namespaces instead of flat methods? The Zod contract already
 * partitions schemas per resource (`v1.Run`, `v1.Agent`, ...). Mirroring
 * that structure in the SDK surface keeps IDE auto-complete sensible
 * (type `client.agents.` and see every agent op) and makes a 1:1 audit
 * against the spec trivial.
 *
 * Types are re-exported from `@open-rush/contracts` — we do NOT redefine
 * request / response shapes in the SDK. Any drift between the SDK and
 * the server would therefore manifest as a compile error in the
 * user's code, which is the safest outcome.
 */

import type { v1 } from '@open-rush/contracts';
import { type FetchLike, type OpenRushClientOptions, performRequest } from './http.js';
import {
  type RunEvent,
  type StreamEventsOptions,
  streamEvents as streamEventsImpl,
} from './sse.js';

/**
 * Root client. All resource-scoped operations hang off its getters.
 */
export class OpenRushClient {
  readonly baseUrl: string;
  readonly token?: string;
  readonly defaultHeaders?: Record<string, string>;
  readonly fetchImpl?: FetchLike;

  readonly authTokens: AuthTokensResource;
  readonly agentDefinitions: AgentDefinitionsResource;
  readonly agents: AgentsResource;
  readonly runs: RunsResource;
  readonly vaults: VaultsResource;
  readonly skills: SkillsResource;
  readonly mcps: McpsResource;
  readonly projects: ProjectsResource;

  constructor(opts: OpenRushClientOptions) {
    if (!opts.baseUrl) throw new Error('OpenRushClient: baseUrl is required');
    this.baseUrl = opts.baseUrl;
    this.token = opts.token;
    this.defaultHeaders = opts.defaultHeaders;
    this.fetchImpl = opts.fetch;
    this.authTokens = new AuthTokensResource(this);
    this.agentDefinitions = new AgentDefinitionsResource(this);
    this.agents = new AgentsResource(this);
    this.runs = new RunsResource(this);
    this.vaults = new VaultsResource(this);
    this.skills = new SkillsResource(this);
    this.mcps = new McpsResource(this);
    this.projects = new ProjectsResource(this);
  }

  /** @internal — used by resource namespaces. */
  _request<T>(req: Parameters<typeof performRequest<T>>[1]): Promise<T> {
    return performRequest<T>(this._transport(), req);
  }

  /** @internal — used by resource namespaces and the SSE subscriber. */
  _transport(): OpenRushClientOptions {
    return {
      baseUrl: this.baseUrl,
      token: this.token,
      defaultHeaders: this.defaultHeaders,
      fetch: this.fetchImpl,
    };
  }

  /**
   * Public: subscribe to `GET /api/v1/agents/{agentId}/runs/{runId}/events`
   * with transparent reconnect. See `StreamEventsOptions`.
   */
  streamEvents(opts: StreamEventsOptions): AsyncGenerator<RunEvent, void, void> {
    return streamEventsImpl(this._transport(), opts);
  }
}

// ----------------------------------------------------------------------------
// Resource namespaces
// ----------------------------------------------------------------------------

abstract class Resource {
  protected readonly client: OpenRushClient;
  constructor(client: OpenRushClient) {
    this.client = client;
  }
}

/** `/api/v1/auth/tokens` — Service Token CRUD. */
export class AuthTokensResource extends Resource {
  create(body: v1.CreateTokenRequest): Promise<v1.CreateTokenResponse> {
    return this.client._request<v1.CreateTokenResponse>({
      method: 'POST',
      path: '/api/v1/auth/tokens',
      body,
    });
  }

  list(query: Partial<v1.PaginationQuery> = {}): Promise<v1.ListTokensResponse> {
    return this.client._request<v1.ListTokensResponse>({
      method: 'GET',
      path: '/api/v1/auth/tokens',
      query,
    });
  }

  delete(id: string): Promise<v1.DeleteTokenResponse> {
    return this.client._request<v1.DeleteTokenResponse>({
      method: 'DELETE',
      path: `/api/v1/auth/tokens/${encodeURIComponent(id)}`,
    });
  }
}

/** `/api/v1/agent-definitions` — versioned AgentDefinition CRUD. */
export class AgentDefinitionsResource extends Resource {
  create(body: v1.CreateAgentDefinitionRequest): Promise<v1.CreateAgentDefinitionResponse> {
    return this.client._request<v1.CreateAgentDefinitionResponse>({
      method: 'POST',
      path: '/api/v1/agent-definitions',
      body,
    });
  }

  list(
    query: Partial<v1.ListAgentDefinitionsQuery> = {}
  ): Promise<v1.ListAgentDefinitionsResponse> {
    return this.client._request<v1.ListAgentDefinitionsResponse>({
      method: 'GET',
      path: '/api/v1/agent-definitions',
      query: query as Record<string, string | number | boolean | undefined | null>,
    });
  }

  get(id: string, query: v1.GetAgentDefinitionQuery = {}): Promise<v1.GetAgentDefinitionResponse> {
    return this.client._request<v1.GetAgentDefinitionResponse>({
      method: 'GET',
      path: `/api/v1/agent-definitions/${encodeURIComponent(id)}`,
      query: { version: query.version },
    });
  }

  /**
   * PATCH requires `If-Match: <current_version>`. Passing
   * `ifMatchVersion` prevents the easy mistake of forgetting the
   * optimistic-concurrency header — server returns 409
   * VERSION_CONFLICT on mismatch.
   */
  patch(
    id: string,
    ifMatchVersion: number,
    body: v1.PatchAgentDefinitionRequest
  ): Promise<v1.PatchAgentDefinitionResponse> {
    return this.client._request<v1.PatchAgentDefinitionResponse>({
      method: 'PATCH',
      path: `/api/v1/agent-definitions/${encodeURIComponent(id)}`,
      body,
      headers: { 'If-Match': String(ifMatchVersion) },
    });
  }

  listVersions(
    id: string,
    query: Partial<v1.PaginationQuery> = {}
  ): Promise<v1.ListAgentDefinitionVersionsResponse> {
    return this.client._request<v1.ListAgentDefinitionVersionsResponse>({
      method: 'GET',
      path: `/api/v1/agent-definitions/${encodeURIComponent(id)}/versions`,
      query,
    });
  }

  archive(id: string): Promise<v1.ArchiveAgentDefinitionResponse> {
    return this.client._request<v1.ArchiveAgentDefinitionResponse>({
      method: 'POST',
      path: `/api/v1/agent-definitions/${encodeURIComponent(id)}/archive`,
    });
  }
}

/** `/api/v1/agents` — Agent (task row) CRUD. */
export class AgentsResource extends Resource {
  create(body: v1.CreateAgentRequest): Promise<v1.CreateAgentResponse> {
    return this.client._request<v1.CreateAgentResponse>({
      method: 'POST',
      path: '/api/v1/agents',
      body,
    });
  }

  list(query: Partial<v1.ListAgentsQuery> = {}): Promise<v1.ListAgentsResponse> {
    return this.client._request<v1.ListAgentsResponse>({
      method: 'GET',
      path: '/api/v1/agents',
      query: query as Record<string, string | number | boolean | undefined | null>,
    });
  }

  get(id: string): Promise<v1.GetAgentResponse> {
    return this.client._request<v1.GetAgentResponse>({
      method: 'GET',
      path: `/api/v1/agents/${encodeURIComponent(id)}`,
    });
  }

  delete(id: string): Promise<v1.DeleteAgentResponse> {
    return this.client._request<v1.DeleteAgentResponse>({
      method: 'DELETE',
      path: `/api/v1/agents/${encodeURIComponent(id)}`,
    });
  }
}

/**
 * `/api/v1/agents/{agentId}/runs` — Run lifecycle + event stream.
 *
 * Event stream lives on `OpenRushClient.streamEvents()` (top-level for
 * discoverability), but CRUD hangs off `client.runs`.
 */
export class RunsResource extends Resource {
  /**
   * Create a Run. `idempotencyKey` is an opaque URL-safe ASCII string
   * (≤ 160 chars) — clients SHOULD use UUIDv4. Spec §幂等性:
   *
   *   - same key + same body within 24 h → replay original 201
   *   - same key + different body within 24 h → 409 IDEMPOTENCY_CONFLICT
   *
   * Omit `idempotencyKey` entirely to opt out (server treats the call
   * as a brand-new run each time).
   */
  create(
    agentId: string,
    body: v1.CreateRunRequest,
    options: { idempotencyKey?: string } = {}
  ): Promise<v1.CreateRunResponse> {
    return this.client._request<v1.CreateRunResponse>({
      method: 'POST',
      path: `/api/v1/agents/${encodeURIComponent(agentId)}/runs`,
      body,
      headers:
        options.idempotencyKey !== undefined
          ? { 'Idempotency-Key': options.idempotencyKey }
          : undefined,
    });
  }

  list(agentId: string, query: Partial<v1.ListRunsQuery> = {}): Promise<v1.ListRunsResponse> {
    return this.client._request<v1.ListRunsResponse>({
      method: 'GET',
      path: `/api/v1/agents/${encodeURIComponent(agentId)}/runs`,
      query: query as Record<string, string | number | boolean | undefined | null>,
    });
  }

  get(agentId: string, runId: string): Promise<v1.GetRunResponse> {
    return this.client._request<v1.GetRunResponse>({
      method: 'GET',
      path: `/api/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
    });
  }

  cancel(agentId: string, runId: string): Promise<v1.CancelRunResponse> {
    return this.client._request<v1.CancelRunResponse>({
      method: 'POST',
      path: `/api/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`,
    });
  }
}

/** `/api/v1/vaults/entries` — credential vault. */
export class VaultsResource extends Resource {
  create(body: v1.CreateVaultEntryRequest): Promise<v1.CreateVaultEntryResponse> {
    return this.client._request<v1.CreateVaultEntryResponse>({
      method: 'POST',
      path: '/api/v1/vaults/entries',
      body,
    });
  }

  list(query: Partial<v1.ListVaultEntriesQuery> = {}): Promise<v1.ListVaultEntriesResponse> {
    return this.client._request<v1.ListVaultEntriesResponse>({
      method: 'GET',
      path: '/api/v1/vaults/entries',
      query: query as Record<string, string | number | boolean | undefined | null>,
    });
  }

  delete(id: string): Promise<v1.DeleteVaultEntryResponse> {
    return this.client._request<v1.DeleteVaultEntryResponse>({
      method: 'DELETE',
      path: `/api/v1/vaults/entries/${encodeURIComponent(id)}`,
    });
  }
}

/** `/api/v1/skills` — read-only Skill registry. */
export class SkillsResource extends Resource {
  list(query: Partial<v1.ListSkillsQuery> = {}): Promise<v1.ListSkillsResponse> {
    return this.client._request<v1.ListSkillsResponse>({
      method: 'GET',
      path: '/api/v1/skills',
      query: query as Record<string, string | number | boolean | undefined | null>,
    });
  }
}

/** `/api/v1/mcps` — read-only MCP registry. */
export class McpsResource extends Resource {
  list(query: Partial<v1.ListMcpsQuery> = {}): Promise<v1.ListMcpsResponse> {
    return this.client._request<v1.ListMcpsResponse>({
      method: 'GET',
      path: '/api/v1/mcps',
      query: query as Record<string, string | number | boolean | undefined | null>,
    });
  }
}

/** `/api/v1/projects` — Project minimal CRUD. */
export class ProjectsResource extends Resource {
  create(body: v1.CreateProjectRequest): Promise<v1.CreateProjectResponse> {
    return this.client._request<v1.CreateProjectResponse>({
      method: 'POST',
      path: '/api/v1/projects',
      body,
    });
  }

  list(query: Partial<v1.ListProjectsQuery> = {}): Promise<v1.ListProjectsResponse> {
    return this.client._request<v1.ListProjectsResponse>({
      method: 'GET',
      path: '/api/v1/projects',
      query: query as Record<string, string | number | boolean | undefined | null>,
    });
  }

  get(id: string): Promise<v1.GetProjectResponse> {
    return this.client._request<v1.GetProjectResponse>({
      method: 'GET',
      path: `/api/v1/projects/${encodeURIComponent(id)}`,
    });
  }
}
