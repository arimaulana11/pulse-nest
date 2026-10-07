import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, UserRole } from './roles.decorator.js';
import type { User } from '../users/user.entity.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator — allow through
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: User }>().user;
    if (!user) throw new ForbiddenException('Authentication required');

    // super_admin bypasses all role checks
    if (user.role === 'super_admin') return true;

    if (!required.includes(user.role as UserRole)) {
      throw new ForbiddenException(
        `Akses ditolak. Diperlukan role: ${required.join(' atau ')}`,
      );
    }

    return true;
  }
}
