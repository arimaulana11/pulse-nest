/**
 * BudgetService — Google Sheets backend
 *
 * Sheet tab: "budget_positions"
 * Columns (A–J):
 *   id | userId | label | emoji | color | allocated | categoryId | month | year | deleted
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService }       from '@nestjs/config';
import { SheetsService }       from '../sheets/sheets.service.js';
import { SheetContext }         from '../sheets/sheet-context.js';
import { UpsertBudgetDto }     from './dto/upsert-budget.dto.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { randomUUID }          from 'crypto';

const HEADERS = [
  'id', 'userId', 'userName', 'label', 'emoji', 'color',
  'allocated', 'categoryId', 'month', 'year', 'deleted',
];
const COL = Object.fromEntries(HEADERS.map((h, i) => [h, i]));

function fmt(n: number) {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000)     return `Rp ${Math.round(n / 1_000)}k`;
  return `Rp ${n}`;
}

@Injectable()
export class BudgetService {
  private defaultTab: string;
  private ensuredTabs = new Set<string>();

  constructor(
    private readonly sheets: SheetsService,
    private readonly cfg:    ConfigService,
    private readonly txSvc:  TransactionsService,
  ) {
    this.defaultTab = this.cfg.get('SHEET_BUDGET', 'budget_positions');
  }

  private tab(ctx?: SheetContext) { return ctx?.tabBudget ?? this.defaultTab; }
  private sid(ctx?: SheetContext) { return ctx?.spreadsheetId; }

  private async ensureReady(ctx?: SheetContext) {
    const key = `${this.sid(ctx) ?? 'default'}::${this.tab(ctx)}`;
    if (this.ensuredTabs.has(key)) return;
    const spreadsheetId = this.sid(ctx) ?? this.sheets.defaultSpreadsheetId;
    if (!spreadsheetId) return; // Sheets not configured — skip silently
    await this.sheets.ensureHeaderWithId(
      spreadsheetId,
      this.tab(ctx), HEADERS,
    );
    this.ensuredTabs.add(key);
  }

  async findByPeriod(userId: string, month: number, year: number, ctx?: SheetContext) {
    await this.ensureReady(ctx);
    const rows = this.sid(ctx)
      ? await this.sheets.readRowsWithId<Record<string, string>>(this.sid(ctx)!, this.tab(ctx))
      : await this.sheets.readRows<Record<string, string>>(this.tab(ctx));

    const positions = rows.filter(
      (r) => r.userId === userId && r.deleted !== 'true' &&
             Number(r.month) === month && Number(r.year) === year,
    );

    const allTxResult = await this.txSvc.findAll(userId, ctx, undefined, undefined, undefined, undefined, 1, 999_999);
    const allTx       = allTxResult.data;
    const spentMap: Record<string, number> = {};
    allTx
      .filter((t) => {
        const d = new Date(t.dateIso);
        return t.type === 'expense' && d.getMonth() + 1 === month && d.getFullYear() === year;
      })
      .forEach((t) => {
        spentMap[t.categoryId] = (spentMap[t.categoryId] ?? 0) + Math.abs(t.amount);
      });

    return positions.map((r) => {
      const allocated = Number(r.allocated);
      const spent     = spentMap[r.categoryId] ?? 0;
      const remaining = allocated - spent;          // boleh negatif
      const rawPct    = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;
      const percent   = rawPct;                     // boleh > 100

      // ── Notice ────────────────────────────────────────────────────────
      let notice: string;
      let noticeLevel: 'ok' | 'warning' | 'danger' | 'over';

      if (rawPct >= 100) {
        noticeLevel = 'over';
        const overAmount = spent - allocated;
        notice = `⚠️ Anggaran ${r.label} melebihi batas! Kelebihan ${fmt(overAmount)} (${rawPct - 100}% di atas anggaran).`;
      } else if (rawPct >= 80) {
        noticeLevel = 'danger';
        notice = `🔴 Sisa ${100 - rawPct}% anggaran ${r.label} — tinggal ${fmt(remaining)} lagi.`;
      } else if (rawPct >= 50) {
        noticeLevel = 'warning';
        notice = `🟡 Sisa ${100 - rawPct}% anggaran ${r.label} — sudah terpakai ${fmt(spent)}.`;
      } else {
        noticeLevel = 'ok';
        notice      = `✅ Sisa ${100 - rawPct}% anggaran ${r.label} — masih ada ${fmt(remaining)}.`;
      }

      return {
        id: r.id, label: r.label, emoji: r.emoji, color: r.color,
        allocated, allocatedFormatted: fmt(allocated),
        spent,     spentFormatted:    fmt(spent),
        remaining, remainingFormatted: remaining < 0 ? `-${fmt(Math.abs(remaining))}` : fmt(remaining),
        percent,
        remainingPercent: 100 - rawPct,    // negatif kalau over
        categoryId: r.categoryId, month: Number(r.month), year: Number(r.year),
        notice,
        noticeLevel,
      };
    });
  }

  async upsert(userId: string, dto: UpsertBudgetDto, ctx?: SheetContext, userName = '') {
    await this.ensureReady(ctx);
    const rows = this.sid(ctx)
      ? await this.sheets.readRowsWithId<Record<string, string>>(this.sid(ctx)!, this.tab(ctx))
      : await this.sheets.readRows<Record<string, string>>(this.tab(ctx));

    const existing = rows.find(
      (r) => r.userId === userId && r.label === dto.label &&
             Number(r.month) === dto.month && Number(r.year) === dto.year && r.deleted !== 'true',
    );

    const values: (string | number)[] = [
      '', userId, userName, dto.label, dto.emoji, dto.color,
      dto.allocated, dto.categoryId ?? '', dto.month, dto.year, 'false',
    ];

    if (existing) {
      const idx = this.sid(ctx)
        ? await this.sheets.findRowIndexWithId(this.sid(ctx)!, this.tab(ctx), COL.id, existing.id)
        : await this.sheets.findRowIndex(this.tab(ctx), COL.id, existing.id);
      values[0] = existing.id;
      if (this.sid(ctx)) await this.sheets.updateRowWithId(this.sid(ctx)!, this.tab(ctx), idx, values);
      else               await this.sheets.updateRow(this.tab(ctx), idx, values);
      return { message: 'Pos anggaran diperbarui', id: existing.id };
    }

    const id = randomUUID();
    values[0] = id;
    if (this.sid(ctx)) await this.sheets.appendRowWithId(this.sid(ctx)!, this.tab(ctx), values);
    else               await this.sheets.appendRow(this.tab(ctx), values);
    return { message: 'Pos anggaran dibuat', id };
  }

  // ── Utility: used by JourneySyncService ─────────────────────────────

  async countBudgetPositions(userId: string, ctx?: SheetContext): Promise<number> {
    await this.ensureReady(ctx);
    const rows = this.sid(ctx)
      ? await this.sheets.readRowsWithId<Record<string, string>>(this.sid(ctx)!, this.tab(ctx))
      : await this.sheets.readRows<Record<string, string>>(this.tab(ctx));
    return rows.filter((r) => r.userId === userId && r.deleted !== 'true').length;
  }

  async remove(userId: string, id: string, ctx?: SheetContext) {
    await this.ensureReady(ctx);
    const idx = this.sid(ctx)
      ? await this.sheets.findRowIndexWithId(this.sid(ctx)!, this.tab(ctx), COL.id, id)
      : await this.sheets.findRowIndex(this.tab(ctx), COL.id, id);
    if (idx < 0) throw new NotFoundException('Pos anggaran tidak ditemukan');

    const rows = this.sid(ctx)
      ? await this.sheets.readRowsWithId<Record<string, string>>(this.sid(ctx)!, this.tab(ctx))
      : await this.sheets.readRows<Record<string, string>>(this.tab(ctx));
    const row = rows[idx - 1];
    if (!row || row.userId !== userId) throw new NotFoundException('Pos anggaran tidak ditemukan');

    const updated = HEADERS.map((h) => (h === 'deleted' ? 'true' : (row[h] ?? '')));
    if (this.sid(ctx)) await this.sheets.updateRowWithId(this.sid(ctx)!, this.tab(ctx), idx, updated);
    else               await this.sheets.updateRow(this.tab(ctx), idx, updated);
    return { message: 'Pos anggaran dihapus' };
  }
}
