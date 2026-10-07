import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Request, UseGuards, HttpCode,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiCreatedResponse, ApiParam,
} from '@nestjs/swagger';
import { RolesGuard }         from '../auth/roles.guard.js';
import { Roles }              from '../auth/roles.decorator.js';
import { SuperAdminService }  from './super-admin.service.js';
import {
  CreateAdminDto, UpdatePlanDto,
  PlanFeatureDto, CreateFeatureDto, ChangePasswordDto,
} from './dto/super-admin.dto.js';

@ApiTags('Super Admin')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Roles('super_admin')
@Controller('super-admin')
export class SuperAdminController {
  constructor(private readonly svc: SuperAdminService) {}

  // ── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard statistik sistem' })
  getStats() { return this.svc.getStats(); }

  // ── Admin management ───────────────────────────────────────────────────────

  @Get('admins')
  @ApiOperation({ summary: 'List semua admin' })
  listAdmins() { return this.svc.listAdmins(); }

  @Post('admins')
  @ApiOperation({ summary: 'Buat akun admin baru' })
  @ApiCreatedResponse({ schema: { example: { message: 'Admin berhasil dibuat', admin: {} } } })
  createAdmin(
    @Body() dto: CreateAdminDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.svc.createAdmin(dto, req.user.id);
  }

  @Post('admins/:id/promote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Promosikan user menjadi admin' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  promoteToAdmin(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.svc.promoteToAdmin(id, req.user.id);
  }

  @Post('admins/:id/demote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Turunkan admin kembali ke user biasa' })
  @ApiParam({ name: 'id' })
  demoteFromAdmin(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.svc.demoteFromAdmin(id, req.user.id);
  }

  // ── Plans ─────────────────────────────────────────────────────────────────

  @Get('plans')
  @ApiOperation({ summary: 'List semua plan beserta jumlah subscriber' })
  listPlans() { return this.svc.listPlans(); }

  @Patch('plans/:id')
  @ApiOperation({ summary: 'Update detail plan (harga, nama, status aktif)' })
  @ApiParam({ name: 'id', description: 'Plan UUID' })
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.svc.updatePlan(id, {
      name:         dto.name,
      description:  dto.description,
      priceMonthly: dto.priceMonthly,
      priceYearly:  dto.priceYearly,
      isActive:     dto.isActive,
      sortOrder:    dto.sortOrder,
    }, req.user.id);
  }

  // ── Plan features ──────────────────────────────────────────────────────────

  @Get('plans/:id/features')
  @ApiOperation({ summary: 'List semua feature dan status included untuk plan ini' })
  @ApiParam({ name: 'id', description: 'Plan UUID' })
  getPlanFeatures(@Param('id') id: string) {
    return this.svc.getPlanFeatures(id);
  }

  @Post('plans/:id/features')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tambah feature ke plan' })
  @ApiParam({ name: 'id', description: 'Plan UUID' })
  addFeatureToPlan(
    @Param('id') id: string,
    @Body() dto: PlanFeatureDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.svc.addFeatureToPlan(id, dto.featureCode, req.user.id);
  }

  @Delete('plans/:id/features/:featureCode')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hapus feature dari plan' })
  @ApiParam({ name: 'id', description: 'Plan UUID' })
  @ApiParam({ name: 'featureCode', description: 'Feature code' })
  removeFeatureFromPlan(
    @Param('id')          id:          string,
    @Param('featureCode') featureCode: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.svc.removeFeatureFromPlan(id, featureCode, req.user.id);
  }

  // ── Features master ────────────────────────────────────────────────────────

  @Get('features')
  @ApiOperation({ summary: 'List semua feature yang tersedia' })
  listFeatures() { return this.svc.listFeatures(); }

  @Post('features')
  @ApiOperation({ summary: 'Tambah feature baru ke sistem' })
  @ApiCreatedResponse({ schema: { example: { message: 'Feature dibuat', featureId: 'uuid', code: 'ai_insights' } } })
  createFeature(
    @Body() dto: CreateFeatureDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.svc.createFeature(dto, req.user.id);
  }

  // ── Super admin account ────────────────────────────────────────────────────

  @Post('change-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Ganti password super admin',
    description: 'Hanya bisa ganti password sendiri.',
  })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.svc.changePassword(req.user.id, dto.currentPassword, dto.newPassword);
  }
}
