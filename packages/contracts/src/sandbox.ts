import { z } from 'zod';
import { SandboxStatus } from './enums.js';

export const SandboxInfo = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid().nullable().default(null),
  externalId: z.string().min(1),
  status: SandboxStatus.default('creating'),
  providerType: z.string().default('opensandbox'),
  endpoint: z.string().nullable().default(null),
  ttlSeconds: z.number().int().positive().nullable().default(null),
  labels: z.record(z.string()).nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  destroyedAt: z.coerce.date().nullable().default(null),
});
export type SandboxInfo = z.infer<typeof SandboxInfo>;
