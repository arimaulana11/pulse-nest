import {
  Controller, Get, Patch, Post, Param, Body, Query, Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse, ApiParam,
} from '@nestjs/swagger';
import { RolesGuard }   from '../auth/roles.guard.js';
import { Roles }        from '../auth/roles.decorator.js';
import { AdminService } from './admin.service.js';
import {
  ListUsersQueryDto, SetUserActiveDto,
  SetUserPlanDto, ToggleFeatureDto, AuditLogQueryDto,
} from './dto/admin.dto.js';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles('admin', 'super_admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  private ip(req: Request) {
    return (req as unknown as { ip?: string }).ip;
  }

  // ── Users ────────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'List semua user dengan pagination + filter' })
  listUsers(@Query() q: ListUsersQueryDto) {
    return this.svc.listUsers({
      page:   q.page  ?? 1,
      limit:  q.limit ?? 20,
      q:      q.q,
      role:   q.role,
      active: q.active,
    });
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Detail user + subscription + features' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  getUserDetail(@Param('id') id: string) {
    return this.svc.getUserDetail(id);
  }

  @Patch('users/:id/active')
  @ApiOperation({ summary: 'Enable / disable user' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ schema: { example: { message: 'User dinonaktifkan', userId: 'uuid', isActive: false } } })
  setUserActive(
    @Param('id')      id:  string,
    @Body()           dto: SetUserActiveDto,
    @Request()        req: { user: { id: string } },
  ) {
    return this.svc.setUserActive(id, dto.active, req.user.id, this.ip(req as unknown as Request));
  }

  @Post('users/:id/plan')
  @ApiOperation({
    summary: 'Override plan user secara manual',
    description: 'Admin dapat mengubah plan user tanpa pembayaran. Tercatat di audit log.',
  })
  @ApiParam({ name: 'id' })
  setUserPlan(
    @Param('id')  id:  string,
    @Body()       dto: SetUserPlanDto,
    @Request()    req: { user: { id: string } },
  ) {
    return this.svc.setUserPlan(id, dto.planCode, req.user.id, {
      billingCycle: dto.billingCycle,
      periodDays:   dto.periodDays,
      note:         dto.note,
    }, this.ip(req as unknown as Request));
  }

  @Post('users/:id/feature')
  @ApiOperation({ summary: 'Grant / revoke feature untuk user (audit only)' })
  @ApiParam({ name: 'id' })
  toggleFeature(
    @Param('id')  id:  string,
    @Body()       dto: ToggleFeatureDto,
    @Request()    req: { user: { id: string } },
  ) {
    return this.svc.toggleFeature(id, dto.feature, dto.grant, req.user.id, this.ip(req as unknown as Request));
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  @Get('audit-log')
  @ApiOperation({ summary: 'Lihat audit log semua aksi admin' })
  getAuditLog(@Query() q: AuditLogQueryDto) {
    return this.svc.getAuditLog({
      page:    q.page    ?? 1,
      limit:   q.limit   ?? 20,
      adminId: q.adminId,
      action:  q.action,
    });
  }
}
