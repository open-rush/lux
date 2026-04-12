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

export const CreateProjectRequest = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  sandboxProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  defaultConnectionMode: ConnectionMode.optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  sandboxProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  defaultConnectionMode: ConnectionMode.optional(),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

export const AddMemberRequest = z.object({
  userId: z.string().uuid(),
  role: ProjectMemberRole.default('member'),
});
export type AddMemberRequest = z.infer<typeof AddMemberRequest>;

export const UpdateMemberRoleRequest = z.object({
  role: ProjectMemberRole,
});
export type UpdateMemberRoleRequest = z.infer<typeof UpdateMemberRoleRequest>;
