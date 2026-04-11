import { z } from 'zod';
import { ConnectionMode, ProjectMemberRole } from './enums.js';

export const Project = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().nullable().default(null),
  sandboxProvider: z.string().default('opensandbox'),
  defaultModel: z.string().nullable().default(null),
  defaultConnectionMode: ConnectionMode.nullable().default('anthropic'),
  createdBy: z.string().uuid().nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Project = z.infer<typeof Project>;

export const ProjectMember = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  role: ProjectMemberRole.default('member'),
  createdAt: z.coerce.date(),
});
export type ProjectMember = z.infer<typeof ProjectMember>;
