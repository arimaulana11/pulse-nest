/**
 * TransactionsService — Google Sheets backend
 *
 * Sheet tab: "transactions"  (or workspace-specific tab name)
 * Columns (A–L):
 *   id | userId | type | amount | description | categoryId | categoryLabel |
 *   categoryEmoji | note | date | createdAt | deleted
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService }       from '@nestjs/config';
import { SheetsService }       from '../sheets/sheets.service.js';
import { SheetContext }         from '../sheets/sheet-context.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { randomUUID }           from 'crypto';

const HEADERS = [
  'id', 'userId', 'userName', 'type', 'amount', 'description',
  'categoryId', 'categoryLabel', 'categoryEmoji',
  'note', 'date', 'createdAt', 'deleted',
];

const COL = Object.fromEntries(HEADERS.map((h, i) => [h, i]));

function fmt(n: number) {
  return 'Rp ' + Math.abs(n).toLocaleString('id-ID');
}

function fmtSigned(n: number) {
  const abs = Math.abs(n).toLocaleString('id-ID');
  return n < 0 ? `-Rp ${abs}` : `Rp ${abs}`;
}

function relDate(iso: string) {
  const today = new Date().toISOString().slice(0, 10);
  const yest  = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (iso === today) return 'Hari Ini';
  if (iso === yest)  return 'Kemarin';
  return iso;
}

@Injectable()
export class TransactionsService {
  private defaultTab: string;
  private ensuredTabs = new Set<string>();

  constructor(
    private readonly sheets: SheetsService,
    private readonly cfg:    ConfigService,
  ) {
    this.defaultTab = this.cfg.get('SHEET_TRANSACTIONS', 'transactions');
  }

  // ── Context helpers ───────────────────────────────────────────────────

  private tab(ctx?: SheetContext) { return ctx?.tabTx ?? this.defaultTab; }
  private sid(ctx?: SheetContext) { return ctx?.spreadsheetId; }

  private async ensureReady(ctx?: SheetContext) {
    const key = `${this.sid(ctx) ?? 'default'}::${this.tab(ctx)}`;
    if (this.ensuredTabs.has(key)) return;
    await this.sheets.ensureHeaderWithId(
      this.sid(ctx) ?? this.sheets.defaultSpreadsheetId,
      this.tab(ctx),
      HEADERS,
    );
    this.ensuredTabs.add(key);
  }

  // ── Public API ────────────────────────────────────────────────────────

  async findAll(
    userId: string,
    ctx?:        SheetContext,
    from?:       string,
    to?:         string,
    type?:       string,
    categoryId?: string,
    page         = 1,
    limit        = 20,
  ) {
    await this.ensureReady(ctx);
    const rows = this.sid(ctx)
      ? await this.sheets.readRowsWithId<Record<string, string>>(this.sid(ctx)!, this.tab(ctx))
      : await this.sheets.readRows<Record<string, string>>(this.tab(ctx));

    const filtered = rows
      .filter((r) => {
        if (r.userId !== userId || r.deleted === 'true') return false;
        if (from && r.date < from) return false;
        if (to   && r.date > to)   return false;
        if (type && r.type !== type) return false;
        if (categoryId && r.categoryId !== categoryId) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

    const total      = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage   = Math.min(Math.max(page, 1), totalPages);
    const offset     = (safePage - 1) * limit;
    const items      = filtered.slice(offset, offset + limit).map(this.serialize);

    return {
      data: items, total, page: safePage, limit,
      totalPages, hasNext: safePage < totalPages, hasPrev: safePage > 1,
    };
  }

  async findOne(userId: string, id: string, ctx?: SheetContext) {
    await this.ensureReady(ctx);
    const rows = this.sid(ctx)
      ? await this.sheets.readRowsWithId<Record<string, string>>(this.sid(ctx)!, this.tab(ctx))
      : await this.sheets.readRows<Record<string, string>>(this.tab(ctx));
    const row = rows.find((r) => r.id === id && r.userId === userId && r.deleted !== 'true');
    if (!row) throw new NotFoundException('Transaksi tidak ditemukan');
    return this.serialize(row);
  }

  async create(userId: string, dto: CreateTransactionDto, ctx?: SheetContext, userName = '') {
    await this.ensureReady(ctx);
    const id        = randomUUID();
    const date      = dto.date ?? new Date().toISOString().slice(0, 10);
    const createdAt = new Date().toISOString();

    const values = [
      id, userId, userName, dto.type, dto.amount, dto.description,
      dto.categoryId, dto.categoryLabel, dto.categoryEmoji,
      dto.note ?? '', date, createdAt, 'false',
    ];

    if (this.sid(ctx)) {
      await this.sheets.appendRowWithId(this.sid(ctx)!, this.tab(ctx), values);
    } else {
      await this.sheets.appendRow(this.tab(ctx), values);
    }

    return this.serialize({
      id, userId, type: dto.type, amount: String(dto.amount),
      description: dto.description, categoryId: dto.categoryId,
      categoryLabel: dto.categoryLabel, categoryEmoji: dto.categoryEmoji,
      note: dto.note ?? '', date, createdAt, deleted: 'false',
    });
  }

  async remove(userId: string, id: string, ctx?: SheetContext) {
    await this.ensureReady(ctx);
    const idx = this.sid(ctx)
      ? await this.sheets.findRowIndexWithId(this.sid(ctx)!, this.tab(ctx), COL.id, id)
      : await this.sheets.findRowIndex(this.tab(ctx), COL.id, id);
    if (idx < 0) throw new NotFoundException('Transaksi tidak ditemukan');

    const rows = this.sid(ctx)
      ? await this.sheets.readRowsWithId<Record<string, string>>(this.sid(ctx)!, this.tab(ctx))
      : await this.sheets.readRows<Record<string, string>>(this.tab(ctx));
    const row = rows[idx - 1];
    if (!row || row.userId !== userId) throw new NotFoundException('Transaksi tidak ditemukan');

    const updated = HEADERS.map((h) => (h === 'deleted' ? 'true' : (row[h] ?? '')));
    if (this.sid(ctx)) {
      await this.sheets.updateRowWithId(this.sid(ctx)!, this.tab(ctx), idx, updated);
    } else {
      await this.sheets.updateRow(this.tab(ctx), idx, updated);
    }
    return { message: 'Transaksi dihapus' };
  }

  async summary(userId: string, ctx?: SheetContext, from?: string, to?: string) {
    const result  = await this.findAll(userId, ctx, from, to, undefined, undefined, 1, 999_999);
    const txs     = result.data;
    const income  = txs.filter((t) => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
    const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
    return {
      totalIncome:          income,
      totalIncomeFormatted: fmt(income),
      totalExpense:          expense,
      totalExpenseFormatted: fmt(expense),
      balance:               income - expense,
      balanceFormatted:      fmtSigned(income - expense),
    };
  }

  // ── Utility: read all rows for a user (used by SurvivalSyncService) ──

  async readAllRowsForUser(
    userId: string,
    ctx?:   SheetContext,
  ): Promise<{ type: string; date: string }[]> {
    await this.ensureReady(ctx);
    const rows = this.sid(ctx)
      ? await this.sheets.readRowsWithId<Record<string, string>>(this.sid(ctx)!, this.tab(ctx))
      : await this.sheets.readRows<Record<string, string>>(this.tab(ctx));
    return rows
      .filter((r) => r.userId === userId && r.deleted !== 'true')
      .map((r) => ({ type: r.type, date: r.date }));
  }

  private serialize(r: Record<string, string>) {
    const amount = Number(r.amount);
    const signed = r.type === 'expense' ? -Math.abs(amount) : Math.abs(amount);
    const prefix = r.type === 'income' ? '+ ' : '- ';
    return {
      id:              r.id,
      type:            r.type as 'income' | 'expense',
      description:     r.description,
      category:        r.categoryLabel,
      categoryId:      r.categoryId,
      categoryEmoji:   r.categoryEmoji,
      amount:          signed,
      amountFormatted: `${prefix}${fmt(signed)}`,
      note:            r.note || null,
      date:            relDate(r.date),
      dateIso:         r.date,
      createdAt:       r.createdAt,
    };
  }
}
