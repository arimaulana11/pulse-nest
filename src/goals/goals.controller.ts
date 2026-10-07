import {
  Controller, Get, Post, Delete,
  Body, Param, Request,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiCreatedResponse,
  ApiNotFoundResponse, ApiUnauthorizedResponse,
  ApiParam, ApiBody,
} from '@nestjs/swagger';
import { GoalsService } from './goals.service.js';
import { CreateGoalDto, AddDepositDto } from './dto/goal.dto.js';

const GOAL_EXAMPLE = {
  id: 'uuid-v4',
  title: 'Dana Darurat 3 Bulan',
  emoji: '🎯',
  targetAmount: 10500000,
  targetFormatted: 'Rp 10.5M',
  collected: 2500000,
  collectedFormatted: 'Rp 2.5M',
  remaining: 8000000,
  remainingFormatted: 'Rp 8M',
  percent: 24,
  monthlyDeposit: 500000,
  monthlyDepositFormatted: 'Rp 500k / bulan',
  deadline: '2027-03-01',
  status: 'active',
  createdAt: '2026-09-24T00:00:00.000Z',
};

@ApiTags('Goals')
@ApiBearerAuth('access-token')
@Controller('goals')
export class GoalsController {
  constructor(private readonly svc: GoalsService) {}

  @Get()
  @ApiOperation({
    summary: 'List semua financial goals user',
    description: 'Mengembalikan semua goal aktif milik user. Goals yang dihapus tidak ditampilkan.',
  })
  @ApiOkResponse({
    description: 'Array goals',
    schema: { example: [GOAL_EXAMPLE] },
  })
  @ApiUnauthorizedResponse({ description: 'Token tidak valid' })
  findAll(@Request() req: { user: { id: string } }) {
    return this.svc.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detail goal beserta milestones & deposit history',
    description: 'Mengembalikan detail goal lengkap dengan 5 milestone otomatis (14%, 29%, 50%, 71%, 100%) dan riwayat setoran.',
  })
  @ApiParam({ name: 'id', description: 'Goal ID (UUID)' })
  @ApiOkResponse({
    description: 'Goal detail',
    schema: {
      example: {
        ...GOAL_EXAMPLE,
        milestones: [
          { step: 1, amount: 1470000, formatted: 'Rp 1.47M', percent: 14, done: true },
          { step: 2, amount: 3045000, formatted: 'Rp 3.05M', percent: 29, done: false },
        ],
        depositHistory: [
          { id: 'uuid', type: 'manual', label: 'Setor manual', amount: 500000, formatted: '+Rp 500k', note: null, depositedAt: '2026-09-20', createdAt: '2026-09-20T00:00:00.000Z' },
        ],
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Goal tidak ditemukan' })
  findOne(
    @Request()    req: { user: { id: string } },
    @Param('id')  id: string,
  ) {
    return this.svc.findOne(req.user.id, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Buat financial goal baru',
    description: 'Membuat goal baru. `monthlyDeposit` opsional — untuk kalkulasi proyeksi waktu pencapaian.',
  })
  @ApiBody({ type: CreateGoalDto })
  @ApiCreatedResponse({
    description: 'Goal berhasil dibuat',
    schema: { example: { message: 'Goal dibuat', id: 'uuid-v4' } },
  })
  create(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateGoalDto,
  ) {
    return this.svc.create(req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Hapus goal (soft delete)' })
  @ApiParam({ name: 'id', description: 'Goal ID' })
  @ApiOkResponse({
    description: 'Goal berhasil dihapus',
    schema: { example: { message: 'Goal dihapus' } },
  })
  @ApiNotFoundResponse({ description: 'Goal tidak ditemukan' })
  remove(
    @Request()    req: { user: { id: string } },
    @Param('id')  id: string,
  ) {
    return this.svc.remove(req.user.id, id);
  }

  @Get(':id/deposits')
  @ApiOperation({ summary: 'Riwayat setoran untuk sebuah goal' })
  @ApiParam({ name: 'id', description: 'Goal ID' })
  @ApiOkResponse({
    description: 'Array deposit history',
    schema: {
      example: [{
        id: 'uuid', type: 'manual', label: 'Setor manual',
        amount: 500000, formatted: '+Rp 500k',
        note: 'Gaji September', depositedAt: '2026-09-24', createdAt: '2026-09-24T00:00:00.000Z',
      }],
    },
  })
  getDeposits(
    @Request()    req: { user: { id: string } },
    @Param('id')  id: string,
  ) {
    return this.svc.getDeposits(req.user.id, id);
  }

  @Post('deposit')
  @ApiOperation({
    summary: 'Tambah setoran ke sebuah goal',
    description: 'Menyimpan setoran dan mengupdate `collected` pada goal. Jika `collected >= targetAmount`, status goal otomatis berubah ke `completed`.',
  })
  @ApiBody({ type: AddDepositDto })
  @ApiCreatedResponse({
    description: 'Setoran berhasil dicatat',
    schema: {
      example: {
        message: 'Setoran berhasil ditambahkan',
        depositId: 'uuid-v4',
        newCollected: 3000000,
        isCompleted: false,
      },
    },
  })
  addDeposit(
    @Request() req: { user: { id: string } },
    @Body() dto: AddDepositDto,
  ) {
    return this.svc.addDeposit(req.user.id, dto);
  }
}
