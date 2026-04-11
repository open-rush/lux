import { z } from 'zod';
import { ArtifactKind } from './enums.js';

export const Artifact = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  kind: ArtifactKind,
  path: z.string().min(1),
  storagePath: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().nonnegative(),
  checksum: z.string().min(1),
  createdAt: z.coerce.date(),
});
export type Artifact = z.infer<typeof Artifact>;
