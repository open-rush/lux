import { z } from 'zod';
import { CheckpointStatus } from './enums.js';

export const RunCheckpoint = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid().nullable().default(null),
  status: CheckpointStatus.default('in_progress'),
  messagesSnapshotRef: z.string().nullable().default(null),
  workspaceDeltaRef: z.string().nullable().default(null),
  lastEventSeq: z.number().int().nullable().default(null),
  pendingToolCalls: z.unknown().nullable().default(null),
  degradedRecovery: z.boolean().default(false),
  createdAt: z.coerce.date(),
});
export type RunCheckpoint = z.infer<typeof RunCheckpoint>;
