import {
  Controller, Get, Post, Delete,
  Body, Param, Query, Request, Headers,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiCreatedResponse,
  ApiNotFoundResponse, ApiUnauthorizedResponse,
  ApiParam, ApiQuery, ApiHeader, ApiBody,
} from '@nestjs/swagger';
import { BudgetService }        from './budget.service.js';
import { UpsertBudgetDto }      from './dto/upsert-budget.dto.js';
import { WorkspacesService }    from '../workspaces/workspaces.service.js';
import { contextFromWorkspace } from '../sheets/sheet-context.js';

const BUDGET_EXAMPLE = {
  id: 'uuid-v4',
  label: 'Makan & Minum',
  emoji: '🍳',
  color: '#B25329',
  allocated: 1500000,
  allocatedFormatted: 'Rp 1.5M',
  spent: 750000,
  spentFormatted: 'Rp 750k',
  percent: 50,
  categoryId: '00000000-0000-0000-0000-000000000001',
  month: 9,
  year: 2026,
};

@ApiTags('Budget')
@ApiBearerAuth('access-token')
@ApiHeader({
  name: 'X-Workspace-Id',
  description: 'UUID workspace aktif. Kosongkan untuk mode personal.',
  required: false,
})
@Controller('budget')
export class BudgetController {
  constructor(
    private readonly svc: BudgetService,
    private readonly wsSvc: WorkspacesService,
  ) {}

  private async ctx(userId: string, wsId?: string) {
    const ws = await this.wsSvc.getActiveContext(userId, wsId);
    return contextFromWorkspace(ws);
  }

  @Get()
  @ApiOperation({
    summary: 'List pos anggaran bulan tertentu beserta realisasi',
    description: 'Mengembalikan pos anggaran untuk bulan/tahun yang dipilih, lengkap dengan kolom `spent` yang dihitung dari transaksi di period yang sama. Default ke bulan & tahun saat ini.',
  })
  @ApiQuery({ name: 'month', required: false, example: 9, description: 'Bulan (1-12), default bulan ini' })
  @ApiQuery({ name: 'year',  required: false, example: 2026, description: 'Tahun, default tahun ini' })
  @ApiOkResponse({
    description: 'Array pos anggaran',
    schema: { example: [BUDGET_EXAMPLE] },
  })
  @ApiUnauthorizedResponse({ description: 'Token tidak valid' })
  async findByPeriod(
    @Request()              req:   { user: { id: string } },
    @Query('month')         month: string,
    @Query('year')          year:  string,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    const now = new Date();
    return this.svc.findByPeriod(
      req.user.id,
      month ? Number(month) : now.getMonth() + 1,
      year  ? Number(year)  : now.getFullYear(),
      await this.ctx(req.user.id, wsId),
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Buat atau update pos anggaran',
    description: 'Jika sudah ada pos dengan label + month + year yang sama, akan di-update. Jika belum, akan dibuat baru.',
  })
  @ApiBody({ type: UpsertBudgetDto })
  @ApiCreatedResponse({
    description: 'Pos anggaran berhasil disimpan',
    schema: { example: { message: 'Pos anggaran dibuat', id: 'uuid-v4' } },
  })
  async upsert(
    @Request()              req: { user: { id: string; name?: string } },
    @Body()                 dto: UpsertBudgetDto,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.upsert(req.user.id, dto, await this.ctx(req.user.id, wsId), req.user.name ?? '');
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Hapus pos anggaran (soft delete)' })
  @ApiParam({ name: 'id', description: 'Budget position ID' })
  @ApiOkResponse({
    description: 'Pos anggaran berhasil dihapus',
    schema: { example: { message: 'Pos anggaran dihapus' } },
  })
  @ApiNotFoundResponse({ description: 'Pos anggaran tidak ditemukan' })
  async remove(
    @Request()              req: { user: { id: string } },
    @Param('id')            id:  string,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.remove(req.user.id, id, await this.ctx(req.user.id, wsId));
  }
}
