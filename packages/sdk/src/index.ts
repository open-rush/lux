/**
 * `@open-rush/sdk` — TypeScript client for the Open-rush `/api/v1/*`
 * Managed Agents API.
 *
 * The SDK is a thin HTTP wrapper plus an SSE subscriber. All request /
 * response types come from `@open-rush/contracts` (the Zod source of
 * truth) — nothing is duplicated here. That means upgrading the SDK
 * automatically tracks contract changes at compile time.
 *
 * Public surface:
 *   - `OpenRushClient` — constructor + 8 resource namespaces + streamEvents
 *   - `OpenRushApiError` — thrown on non-2xx responses (discriminated via `code`)
 *   - `v1` — all contract types re-exported for convenience
 *   - SSE: `RunEvent`, `StreamEventsOptions`, `parseSseFrame`,
 *     `DEFAULT_RECONNECT_DELAYS_MS`
 *
 * See README.md for a quickstart + examples.
 */

// Re-export the v1 namespace so callers can import types from the SDK
// directly: `import { v1 } from '@open-rush/sdk'`.
export { v1 } from '@open-rush/contracts';
export type {
  AgentDefinitionsResource,
  AgentsResource,
  AuthTokensResource,
  McpsResource,
  ProjectsResource,
  RunsResource,
  SkillsResource,
  VaultsResource,
} from './client.js';
export { OpenRushClient } from './client.js';
export {
  OpenRushApiError,
  type OpenRushApiErrorBody,
  type OpenRushApiErrorIssue,
  type OpenRushErrorCode,
  parseErrorBody,
} from './errors.js';
export type {
  FetchLike,
  OpenRushClientOptions,
  Query,
  QueryValue,
  RequestOptions,
} from './http.js';
export { buildUrl } from './http.js';
export {
  type ClientTransport,
  DEFAULT_RECONNECT_DELAYS_MS,
  parseSseFrame,
  type RunEvent,
  type StreamEventsOptions,
  streamEvents,
} from './sse.js';
