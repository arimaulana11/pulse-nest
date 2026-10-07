/**
 * JourneyProgressSheetsService
 *
 * Menyimpan dan membaca progress journey user dari Google Sheets.
 * Workspace-aware: semua method menerima optional spreadsheetId.
 * Kalau spreadsheetId tidak diisi → pakai default dari env (GOOGLE_SHEET_ID).
 *
 * Tab: journey_progress (bisa di-override via SheetContext.tabJourney)
 * Kolom:
 *   id | userId | stageKey | taskKey | currentValue | status | completedAt | updatedAt
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }      from '@nestjs/config';
import { SheetsService }      from '../sheets/sheets.service.js';
import { randomUUID }         from 'crypto';

export const JOURNEY_PROGRESS_HEADERS = [
  'id', 'userId', 'userName', 'stageKey', 'taskKey',
  'currentValue', 'status', 'completedAt', 'updatedAt',
];

const COL = Object.fromEntries(JOURNEY_PROGRESS_HEADERS.map((h, i) => [h, i]));

const DEFAULT_TAB = 'journey_progress';

export interface ProgressRow {
  id:           string;
  userId:       string;
  userName:     string;
  stageKey:     string;
  taskKey:      string;
  currentValue: number;
  status:       string;
  completedAt:  string;
  updatedAt:    string;
}

/** Minimal context needed by this service */
export interface JourneySheetCtx {
  spreadsheetId?: string;
  tabJourney?:    string;
  userName?:      string;   // stored alongside userId in each row for readability
}

@Injectable()
export class JourneyProgressSheetsService {
  private readonly log      = new Logger(JourneyProgressSheetsService.name);
  /** Track which (spreadsheetId::tab) combos have had headers ensured */
  private ensuredTabs       = new Set<string>();

  constructor(
    private readonly sheets: SheetsService,
    private readonly cfg:    ConfigService,
  ) {}

  // ── Resolve spreadsheetId and tab ────────────────────────────────────

  private resolveTab(ctx?: JourneySheetCtx): string {
    return ctx?.tabJourney ?? DEFAULT_TAB;
  }

  private resolveSid(ctx?: JourneySheetCtx): string | undefined {
    return ctx?.spreadsheetId;
  }

  // ── Ensure tab + header (per spreadsheetId+tab combo) ────────────────

  private async ensureReady(ctx?: JourneySheetCtx): Promise<void> {
    if (!this.sheets.isReady()) return;
    const sid = this.resolveSid(ctx);
    const tab = this.resolveTab(ctx);
    const key = `${sid ?? 'default'}::${tab}`;
    if (this.ensuredTabs.has(key)) return;
    const spreadsheetId = sid ?? this.sheets.defaultSpreadsheetId;
    await this.sheets.ensureHeaderWithId(spreadsheetId, tab, JOURNEY_PROGRESS_HEADERS);
    this.ensuredTabs.add(key);
  }

  // ── Read all rows for a user ──────────────────────────────────────────

  async getAll(userId: string, ctx?: JourneySheetCtx): Promise<ProgressRow[]> {
    await this.ensureReady(ctx);
    if (!this.sheets.isReady()) return [];
    const sid = this.resolveSid(ctx);
    const tab = this.resolveTab(ctx);
    const rows = sid
      ? await this.sheets.readRowsWithId<Record<string, string>>(sid, tab)
      : await this.sheets.readRows<Record<string, string>>(tab);
    return rows.filter((r) => r.userId === userId).map(this.toProgressRow);
  }

  // ── Read rows for one stage ───────────────────────────────────────────

  async getByStage(userId: string, stageKey: string, ctx?: JourneySheetCtx): Promise<ProgressRow[]> {
    const all = await this.getAll(userId, ctx);
    return all.filter((r) => r.stageKey === stageKey);
  }

  // ── Upsert single row ─────────────────────────────────────────────────

  async upsert(row: Omit<ProgressRow, 'id' | 'updatedAt'>, ctx?: JourneySheetCtx): Promise<void> {
    await this.ensureReady(ctx);
    if (!this.sheets.isReady()) return;

    const sid    = this.resolveSid(ctx);
    const tab    = this.resolveTab(ctx);
    const now    = new Date().toISOString();
    const allRaw = sid
      ? await this.sheets.readAllWithId(sid, tab)
      : await this.sheets.readAll(tab);
    if (allRaw.length === 0) return;

    let rowIndex = -1;
    for (let i = 1; i < allRaw.length; i++) {
      if (
        (allRaw[i][COL.userId]   ?? '') === row.userId   &&
        (allRaw[i][COL.stageKey] ?? '') === row.stageKey &&
        (allRaw[i][COL.taskKey]  ?? '') === row.taskKey
      ) { rowIndex = i; break; }
    }

    const values = [
      rowIndex >= 0 ? (allRaw[rowIndex][COL.id] ?? randomUUID()) : randomUUID(),
      row.userId, row.userName ?? '', row.stageKey, row.taskKey,
      String(row.currentValue), row.status,
      row.completedAt ?? '', now,
    ];

    if (rowIndex >= 0) {
      sid
        ? await this.sheets.updateRowWithId(sid, tab, rowIndex, values)
        : await this.sheets.updateRow(tab, rowIndex, values);
    } else {
      sid
        ? await this.sheets.appendRowWithId(sid, tab, values)
        : await this.sheets.appendRow(tab, values);
    }
  }

  // ── Bulk upsert ───────────────────────────────────────────────────────

  async bulkUpsert(rows: Omit<ProgressRow, 'id' | 'updatedAt'>[], ctx?: JourneySheetCtx): Promise<void> {
    if (!rows.length) return;
    await this.ensureReady(ctx);
    if (!this.sheets.isReady()) return;

    const sid    = this.resolveSid(ctx);
    const tab    = this.resolveTab(ctx);
    const now    = new Date().toISOString();
    const allRaw = sid
      ? await this.sheets.readAllWithId(sid, tab)
      : await this.sheets.readAll(tab);

    const indexMap = new Map<string, number>();
    for (let i = 1; i < allRaw.length; i++) {
      const key = `${allRaw[i][COL.userId]}::${allRaw[i][COL.stageKey]}::${allRaw[i][COL.taskKey]}`;
      indexMap.set(key, i);
    }

    for (const row of rows) {
      const key      = `${row.userId}::${row.stageKey}::${row.taskKey}`;
      const rowIndex = indexMap.get(key);
      const values   = [
        rowIndex !== undefined ? (allRaw[rowIndex][COL.id] ?? randomUUID()) : randomUUID(),
        row.userId, row.userName ?? '', row.stageKey, row.taskKey,
        String(row.currentValue), row.status,
        row.completedAt ?? '', now,
      ];

      if (rowIndex !== undefined) {
        sid
          ? await this.sheets.updateRowWithId(sid, tab, rowIndex, values)
          : await this.sheets.updateRow(tab, rowIndex, values);
      } else {
        sid
          ? await this.sheets.appendRowWithId(sid, tab, values)
          : await this.sheets.appendRow(tab, values);
        indexMap.set(key, allRaw.length);
        allRaw.push(values.map(String));
      }
    }
  }

  // ── Reset task ────────────────────────────────────────────────────────

  async resetTask(userId: string, stageKey: string, taskKey: string, ctx?: JourneySheetCtx): Promise<void> {
    await this.upsert({ userId, userName: '', stageKey, taskKey, currentValue: 0, status: 'pending', completedAt: '' }, ctx);
  }

  // ── Reset stage ───────────────────────────────────────────────────────

  async resetStage(userId: string, stageKey: string, ctx?: JourneySheetCtx): Promise<void> {
    await this.ensureReady(ctx);
    if (!this.sheets.isReady()) return;

    const sid    = this.resolveSid(ctx);
    const tab    = this.resolveTab(ctx);
    const now    = new Date().toISOString();
    const allRaw = sid
      ? await this.sheets.readAllWithId(sid, tab)
      : await this.sheets.readAll(tab);

    for (let i = 1; i < allRaw.length; i++) {
      if ((allRaw[i][COL.userId] ?? '') === userId && (allRaw[i][COL.stageKey] ?? '') === stageKey) {
        const isStageRow = (allRaw[i][COL.taskKey] ?? '') === '_stage';
        const updated    = [...allRaw[i]];
        updated[COL.currentValue] = '0';
        updated[COL.status]       = isStageRow ? 'locked' : 'pending';
        updated[COL.completedAt]  = '';
        updated[COL.updatedAt]    = now;
        sid
          ? await this.sheets.updateRowWithId(sid, tab, i, updated)
          : await this.sheets.updateRow(tab, i, updated);
      }
    }
  }

  private toProgressRow(r: Record<string, string>): ProgressRow {
    return {
      id:           r.id           ?? '',
      userId:       r.userId       ?? '',
      userName:     r.userName     ?? '',
      stageKey:     r.stageKey     ?? '',
      taskKey:      r.taskKey      ?? '',
      currentValue: Number(r.currentValue ?? 0),
      status:       r.status       ?? 'pending',
      completedAt:  r.completedAt  ?? '',
      updatedAt:    r.updatedAt    ?? '',
    };
  }
}
