import { z } from 'zod';
import { UIMessageChunkType } from './enums.js';

export const UIMessageChunk = z.object({
  type: UIMessageChunkType,
  id: z.string().optional(),
  content: z.string().optional(),
  delta: z.string().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  input: z.unknown().optional(),
  output: z.string().optional(),
  errorText: z.string().optional(),
  reason: z.string().optional(),
});
export type UIMessageChunk = z.infer<typeof UIMessageChunk>;

export const RunEvent = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  eventType: z.string().min(1),
  payload: z.unknown().nullable().default(null),
  seq: z.number().int().nonnegative(),
  schemaVersion: z.string().default('1'),
  createdAt: z.coerce.date(),
});
export type RunEvent = z.infer<typeof RunEvent>;
