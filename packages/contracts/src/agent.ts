import { z } from 'zod';
import { AgentStatus } from './enums.js';

export const Agent = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: AgentStatus.default('active'),
  customTitle: z.string().max(200).nullable().default(null),
  config: z.unknown().nullable().default(null),
  createdBy: z.string().uuid().nullable().default(null),
  activeStreamId: z.string().nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  lastActiveAt: z.coerce.date(),
});
export type Agent = z.infer<typeof Agent>;
