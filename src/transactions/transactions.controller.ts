import {
  Controller, Get, Post, Delete,
  Body, Param, Query, Request, Headers,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiCreatedResponse,
  ApiNotFoundResponse, ApiUnauthorizedResponse,
  ApiParam, ApiHeader, ApiBody, ApiQuery,
} from '@nestjs/swagger';
import { TransactionsService }  from './transactions.service.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { WorkspacesService }    from '../workspaces/workspaces.service.js';
import { contextFromWorkspace } from '../sheets/sheet-context.js';

const TX_EXAMPLE = {
  id: 'uuid-v4',
  type: 'expense',
  description: 'Makan siang di warteg',
  category: 'Makan & Minum',
  categoryId: '00000000-0000-0000-0000-000000000001',
  categoryEmoji: '🍳',
  amount: -50000,
  amountFormatted: '- Rp 50.000',
  note: null,
  date: 'Hari Ini',
  dateIso: '2026-09-24',
  createdAt: '2026-09-24T05:30:00.000Z',
};

@ApiTags('Transactions')
@ApiBearerAuth('access-token')
@ApiHeader({
  name: 'X-Workspace-Id',
  description: 'UUID workspace aktif. Kosongkan untuk mode personal (sheet global dari env).',
  required: false,
  example: 'personal',
})
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly svc: TransactionsService,
    private readonly wsSvc: WorkspacesService,
  ) {}

  private async ctx(userId: string, wsId?: string) {
    const ws = await this.wsSvc.getActiveContext(userId, wsId);
    return contextFromWorkspace(ws);
  }

  @Get()
  @ApiOperation({
    summary: 'List transaksi dengan pagination + filter',
    description: 'Filter by date range, type (income/expense), categoryId. Pagination dengan page & limit.',
  })
  @ApiQuery({ name: 'from',       required: false, example: '2026-09-01' })
  @ApiQuery({ name: 'to',         required: false, example: '2026-09-30' })
  @ApiQuery({ name: 'type',       required: false, enum: ['income','expense'], description: 'Filter tipe' })
  @ApiQuery({ name: 'categoryId', required: false, description: 'UUID kategori' })
  @ApiQuery({ name: 'page',       required: false, example: 1 })
  @ApiQuery({ name: 'limit',      required: false, example: 20 })
  @ApiOkResponse({
    description: '{ data, total, page, limit, totalPages, hasNext, hasPrev }',
    schema: {
      example: {
        data: [TX_EXAMPLE], total: 42, page: 1, limit: 20,
        totalPages: 3, hasNext: true, hasPrev: false,
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Token tidak valid' })
  async findAll(
    @Request()              req:         { user: { id: string } },
    @Query('from')          from?:       string,
    @Query('to')            to?:         string,
    @Query('type')          type?:       string,
    @Query('categoryId')    categoryId?: string,
    @Query('page')          page?:       string,
    @Query('limit')         limit?:      string,
    @Headers('x-workspace-id') wsId?:   string,
  ) {
    return this.svc.findAll(
      req.user.id,
      await this.ctx(req.user.id, wsId),
      from, to, type, categoryId,
      page  ? Number(page)  : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Ringkasan total income, expense, dan balance',
    description: 'Filter opsional by rentang tanggal.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-09-01' })
  @ApiQuery({ name: 'to',   required: false, example: '2026-09-30' })
  @ApiOkResponse({
    schema: {
      example: {
        totalIncome: 5000000, totalIncomeFormatted: 'Rp 5.000.000',
        totalExpense: 2500000, totalExpenseFormatted: 'Rp 2.500.000',
        balance: 2500000, balanceFormatted: 'Rp 2.500.000',
      },
    },
  })
  async summary(
    @Request()              req:  { user: { id: string } },
    @Query('from')          from?: string,
    @Query('to')            to?:   string,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.summary(req.user.id, await this.ctx(req.user.id, wsId), from, to);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail satu transaksi' })
  @ApiParam({ name: 'id', description: 'Transaction ID (UUID yang disimpan di kolom pertama row Google Sheets)' })
  @ApiOkResponse({ description: 'Data transaksi', schema: { example: TX_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Transaksi tidak ditemukan' })
  async findOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.findOne(req.user.id, id, await this.ctx(req.user.id, wsId));
  }

  @Post()
  @ApiOperation({
    summary: 'Tambah transaksi baru',
    description: 'Menyimpan transaksi baru ke Google Sheets. Field `date` default ke hari ini jika tidak diisi.',
  })
  @ApiBody({ type: CreateTransactionDto })
  @ApiCreatedResponse({
    description: 'Transaksi berhasil disimpan',
    schema: { example: TX_EXAMPLE },
  })
  async create(
    @Request() req: { user: { id: string; name?: string } },
    @Body() dto: CreateTransactionDto,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.create(req.user.id, dto, await this.ctx(req.user.id, wsId), req.user.name ?? '');
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Hapus transaksi (soft delete)',
    description: 'Menandai baris sebagai `deleted=true` di Google Sheets. Data tidak benar-benar dihapus dari sheet.',
  })
  @ApiParam({ name: 'id', description: 'Transaction ID' })
  @ApiOkResponse({
    description: 'Transaksi berhasil dihapus',
    schema: { example: { message: 'Transaksi dihapus' } },
  })
  @ApiNotFoundResponse({ description: 'Transaksi tidak ditemukan' })
  async remove(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.remove(req.user.id, id, await this.ctx(req.user.id, wsId));
  }
}
