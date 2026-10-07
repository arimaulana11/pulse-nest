import { SetMetadata } from '@nestjs/common';

export type UserRole = 'user' | 'admin' | 'super_admin';
export const ROLES_KEY = 'roles';

/** Require one or more roles. super_admin always passes. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
