import { z } from 'zod';
import { VaultScope } from './enums.js';

export const VaultEntry = z
  .object({
    id: z.string().uuid(),
    scope: VaultScope,
    projectId: z.string().uuid().nullable().default(null),
    ownerId: z.string().uuid().nullable().default(null),
    name: z.string().min(1).max(255),
    credentialType: z.string().default('env'),
    encryptedValue: z.string().min(1),
    keyVersion: z.number().int().positive().default(1),
    injectionTarget: z.string().nullable().default(null),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .refine(
    (v) =>
      (v.scope === 'platform' && v.projectId === null) ||
      (v.scope === 'project' && v.projectId !== null),
    {
      message: "scope='platform' requires projectId=null; scope='project' requires projectId!=null",
    }
  );
export type VaultEntry = z.infer<typeof VaultEntry>;
