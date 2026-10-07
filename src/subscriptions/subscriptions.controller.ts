import {
  Controller, Get, Post, Delete,
  Body, Request,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiCreatedResponse,
  ApiNotFoundResponse, ApiUnauthorizedResponse,
  ApiForbiddenResponse, ApiBody, ApiProperty,
} from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { SubscriptionsService } from './subscriptions.service.js';

class UpgradeDto {
  @ApiProperty({ example: 'uuid-of-normal-plus-plan', description: 'UUID plan dari tabel plans' })
  @IsString() planId: string;

  @ApiProperty({ enum: ['monthly', 'yearly'], example: 'monthly' })
  @IsIn(['monthly','yearly']) billingCycle: 'monthly' | 'yearly';

  @ApiProperty({ example: 'SUB-MIDTRANS-12345', description: 'ID subscription dari payment provider' })
  @IsString() providerSubId: string;

  @ApiProperty({ example: 'midtrans', description: 'Nama payment provider' })
  @IsString() provider: string;
}

const SUB_EXAMPLE = {
  id: 'uuid-v4',
  userId: 'uuid-user',
  planId: 'uuid-plan',
  billingCycle: 'monthly',
  status: 'active',
  trialEndsAt: null,
  currentPeriodStart: '2026-09-01T00:00:00.000Z',
  currentPeriodEnd: '2026-10-01T00:00:00.000Z',
  cancelledAt: null,
  paymentProvider: null,
  providerSubId: null,
  createdAt: '2026-01-10T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

@ApiTags('Subscription')
@ApiBearerAuth('access-token')
@Controller('subscription')
export class SubscriptionsController {
  constructor(private readonly svc: SubscriptionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Subscription aktif user',
    description: 'Mengembalikan row subscription dari database. `planId` adalah UUID plan, bukan kode plan. Gunakan `/subscription/plan` untuk kode string.',
  })
  @ApiOkResponse({
    description: 'Data subscription',
    schema: { example: SUB_EXAMPLE },
  })
  @ApiNotFoundResponse({ description: 'Subscription tidak ditemukan' })
  @ApiUnauthorizedResponse({ description: 'Token tidak valid' })
  getMine(@Request() req: { user: { id: string } }) {
    return this.svc.findByUser(req.user.id);
  }

  @Get('plan')
  @ApiOperation({
    summary: 'Kode plan aktif user',
    description: 'Shortcut untuk mendapat kode plan string tanpa perlu resolve UUID. Gunakan ini untuk kondisional UI.',
  })
  @ApiOkResponse({
    description: 'Kode plan',
    schema: { example: { plan: 'free' }, description: 'Nilai: `free` | `normal_plus` | `vip`' },
  })
  async getPlan(@Request() req: { user: { id: string } }) {
    const plan = await this.svc.getPlanCode(req.user.id);
    return { plan };
  }

  @Get('features')
  @ApiOperation({
    summary: 'Daftar feature codes yang aktif untuk user',
    description: 'Mengembalikan semua feature code yang tersedia berdasarkan plan aktif user. Gunakan untuk feature gating di frontend.',
  })
  @ApiOkResponse({
    description: 'Array feature codes',
    schema: {
      example: {
        features: [
          'transactions_limit_30', 'budget_positions_limit_4',
          'insight_basic', 'journey_survival', 'journey_stability',
          'silent_mode_streak', 'streak_gamification',
        ],
      },
    },
  })
  async getFeatures(@Request() req: { user: { id: string } }) {
    const features = await this.svc.listFeatures(req.user.id);
    return { features };
  }

  @Post('upgrade')
  @ApiOperation({
    summary: 'Upgrade plan setelah pembayaran berhasil',
    description: 'Dipanggil oleh payment webhook atau frontend setelah konfirmasi pembayaran dari Midtrans/Stripe. Update status subscription ke `active` dengan plan dan billing cycle baru.',
  })
  @ApiBody({ type: UpgradeDto })
  @ApiCreatedResponse({
    description: 'Subscription berhasil diupgrade',
    schema: { example: { ...SUB_EXAMPLE, planId: 'uuid-normal-plus', billingCycle: 'monthly', status: 'active' } },
  })
  upgrade(
    @Request() req: { user: { id: string } },
    @Body() dto: UpgradeDto,
  ) {
    return this.svc.upgradePlan(
      req.user.id, dto.planId, dto.billingCycle,
      dto.providerSubId, dto.provider,
    );
  }

  @Delete()
  @ApiOperation({
    summary: 'Cancel subscription / downgrade ke free',
    description: 'Mengubah status subscription ke `cancelled`. User masih bisa menggunakan fitur premium hingga `currentPeriodEnd`.',
  })
  @ApiOkResponse({
    description: 'Subscription dibatalkan',
    schema: { example: { message: 'Subscription cancelled' } },
  })
  cancel(@Request() req: { user: { id: string } }) {
    return this.svc.cancel(req.user.id);
  }
}
