/**
 * JourneySyncService
 *
 * Dipanggil saat user membuka halaman stage.
 * Mengevaluasi kondisi dari data nyata (Sheets txs + budget + PostgreSQL goals),
 * lalu tulis hasil ke tab journey_progress di Sheets.
 *
 * Rules:
 * survival  │ punya_penghasilan, punya_rekening, catat_pemasukan  → ada income tx
 *           │ catat_pengeluaran                                    → ada expense tx
 *           │ pahami_cashflow                                      → income+expense bulan sama
 *           │ tidak_berhutang                                      → manual
 * stability │ buat_anggaran  → ada budget position di Sheets
 *           │ catat_7hari    → ≥7 hari unik bertransaksi (partial diupdate)
 *           │ dana_darurat   → skip (goal-driven)
 *           │ kurangi_tx     → manual
 * saving    │ buat_saving_goal → ada financial_goals di DB
 *           │ capai_25pct      → collected ≥ 25% target
 *           │ nabung_konsisten → ≥4 minggu berbeda di goal_deposits (partial diupdate)
 *           │ otomatis_saving  → manual
 * growth    │ semua            → manual
 */
import { Injectable, Logger } from '@nestjs/common';
import { DataSource }          from 'typeorm';
import { TransactionsService } from '../transactions/transactions.service.js';
import { BudgetService }       from '../budget/budget.service.js';
import { JourneyProgressSheetsService } from './journey-progress-sheets.service.js';
import type { JourneySheetCtx } from './journey-progress-sheets.service.js';
import type { SheetContext }    from '../sheets/sheet-context.js';

type TaskUpdate = { key: string; previousStatus: string; newStatus: string };

@Injectable()
export class JourneySyncService {
  private readonly logger = new Logger(JourneySyncService.name);

  constructor(
    private readonly ds:       DataSource,
    private readonly txs:      TransactionsService,
    private readonly budget:   BudgetService,
    private readonly progress: JourneyProgressSheetsService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════
  // Public sync methods per stage
  // ════════════════════════════════════════════════════════════════════════

  async syncSurvival(userId: string, ctx?: SheetContext) {
    const rows    = await this.txs.readAllRowsForUser(userId, ctx);
    const income  = rows.filter((r) => r.type === 'income');
    const expense = rows.filter((r) => r.type === 'expense');

    const monthsIncome  = new Set(income.map((r)  => r.date.slice(0, 7)));
    const monthsExpense = new Set(expense.map((r) => r.date.slice(0, 7)));
    const hasBothSameMonth = [...monthsIncome].some((m) => monthsExpense.has(m));

    const rules: { key: string; condition: boolean }[] = [
      { key: 'punya_penghasilan', condition: income.length  > 0 },
      { key: 'punya_rekening',    condition: income.length  > 0 },
      { key: 'catat_pemasukan',   condition: income.length  > 0 },
      { key: 'catat_pengeluaran', condition: expense.length > 0 },
      { key: 'pahami_cashflow',   condition: hasBothSameMonth },
    ];

    const updated = await this.applyRules(userId, 'survival', rules, ctx);
    this.logSync('survival', userId, updated);
    return {
      synced: true, stage: 'survival', tasksUpdated: updated,
      debug: { totalTx: rows.length, incomeCount: income.length, expenseCount: expense.length, hasBothSameMonth },
    };
  }

  async syncStability(userId: string, ctx?: SheetContext) {
    const budgetCount = await this.budget.countBudgetPositions(userId, ctx);
    const hasBudget   = budgetCount > 0;

    const rows       = await this.txs.readAllRowsForUser(userId, ctx);
    const uniqueDays = new Set(rows.map((r) => r.date)).size;
    const daysValue  = Math.min(uniqueDays, 7);

    const rules: { key: string; condition: boolean }[] = [
      { key: 'buat_anggaran', condition: hasBudget },
      { key: 'catat_7hari',   condition: uniqueDays >= 7 },
    ];

    const updated = await this.applyRules(userId, 'stability', rules, ctx);

    if (daysValue > 0) {
      await this.upsertTaskProgress(userId, 'stability', 'catat_7hari', daysValue, daysValue >= 7, ctx);
    }

    this.logSync('stability', userId, updated);
    return {
      synced: true, stage: 'stability', tasksUpdated: updated,
      debug: { hasBudget, budgetCount, uniqueDays, totalTx: rows.length },
    };
  }

  async syncSaving(userId: string, ctx?: SheetContext) {
    const goalRows = await this.ds.query<{ id: string; collected: number; target_amount: number }[]>(
      `SELECT id, collected, target_amount FROM financial_goals WHERE user_id = $1 AND status != 'deleted'`,
      [userId],
    );
    const hasGoal  = goalRows.length > 0;
    const has25pct = goalRows.some((g) => Number(g.collected) >= Number(g.target_amount) * 0.25);

    const depositRows = await this.ds.query<{ week: string }[]>(
      `SELECT DISTINCT TO_CHAR(DATE_TRUNC('week', deposited_at::date), 'IYYY-IW') AS week FROM goal_deposits WHERE user_id = $1`,
      [userId],
    );
    const distinctWeeks = depositRows.length;
    const weeksValue    = Math.min(distinctWeeks, 4);

    const rules: { key: string; condition: boolean }[] = [
      { key: 'buat_saving_goal', condition: hasGoal },
      { key: 'capai_25pct',      condition: has25pct },
      { key: 'nabung_konsisten', condition: distinctWeeks >= 4 },
    ];

    const updated = await this.applyRules(userId, 'saving', rules, ctx);

    if (weeksValue > 0) {
      await this.upsertTaskProgress(userId, 'saving', 'nabung_konsisten', weeksValue, weeksValue >= 4, ctx);
    }

    this.logSync('saving', userId, updated);
    return {
      synced: true, stage: 'saving', tasksUpdated: updated,
      debug: { hasGoal, has25pct, distinctWeeks, goalCount: goalRows.length },
    };
  }

  async syncGrowth(_userId: string, _ctx?: SheetContext) {
    return { synced: true, stage: 'growth', tasksUpdated: [], debug: { note: 'Growth tasks are manual only' } };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Core helpers
  // ════════════════════════════════════════════════════════════════════════

  // Reads current Sheets progress, applies rules, writes back only changed rows
  private async applyRules(
    userId: string,
    stage:  string,
    rules:  { key: string; condition: boolean }[],
    ctx?:   JourneySheetCtx,
  ): Promise<TaskUpdate[]> {
    if (!rules.length) return [];

    const currentRows = await this.progress.getByStage(userId, stage, ctx);
    const progressMap = new Map(currentRows.map((r) => [r.taskKey, r]));

    const updated:  TaskUpdate[]  = [];
    const toUpsert: Parameters<JourneyProgressSheetsService['bulkUpsert']>[0] = [];

    for (const { key, condition } of rules) {
      if (!condition) continue;
      const existing      = progressMap.get(key);
      const currentStatus = existing?.status ?? 'pending';
      if (currentStatus === 'completed') continue;

      toUpsert.push({
        userId, stageKey: stage, taskKey: key,
        userName:     ctx?.userName ?? '',
        currentValue: 1, status: 'completed',
        completedAt: new Date().toISOString(),
      });
      updated.push({ key, previousStatus: currentStatus, newStatus: 'completed' });
    }

    if (toUpsert.length > 0) await this.progress.bulkUpsert(toUpsert, ctx);
    return updated;
  }

  private async upsertTaskProgress(
    userId:  string,
    stage:   string,
    taskKey: string,
    value:   number,
    isDone:  boolean,
    ctx?:    JourneySheetCtx,
  ): Promise<void> {
    const currentRows = await this.progress.getByStage(userId, stage, ctx);
    const existing    = currentRows.find((r) => r.taskKey === taskKey);

    if (existing?.status === 'completed') return;
    if (existing && existing.currentValue >= value) return;

    await this.progress.upsert({
      userId, stageKey: stage, taskKey,
      userName:     ctx?.userName ?? '',
      currentValue: value,
      status:       isDone ? 'completed' : 'in_progress',
      completedAt:  isDone ? new Date().toISOString() : '',
    }, ctx);
  }

  private logSync(stage: string, userId: string, updated: TaskUpdate[]) {
    if (updated.length > 0) {
      this.logger.log(
        `[${stage}] sync user=${userId}: ${updated.length} task(s) → ` +
        updated.map((t) => t.key).join(', '),
      );
    }
  }
}
