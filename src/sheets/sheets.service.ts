/**
 * SheetsService
 * Shared Google Sheets client used by all non-auth modules.
 *
 * Supports two modes:
 *   1. Default (personal) — uses the global GOOGLE_SHEET_ID from env
 *   2. Per-workspace      — caller passes a spreadsheetId explicitly
 *      via the *WithId variants (readAllWithId, readRowsWithId, …)
 */

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService }                     from '@nestjs/config';
import { google, sheets_v4 }                 from 'googleapis';

@Injectable()
export class SheetsService implements OnModuleInit {
  private readonly log = new Logger(SheetsService.name);
  private sheets!: sheets_v4.Sheets;
  private spreadsheetId!: string;

  constructor(private readonly cfg: ConfigService) {}

  async onModuleInit() {
    this.spreadsheetId = this.cfg.get<string>('GOOGLE_SHEET_ID', '');

    if (!this.spreadsheetId) {
      this.log.warn('GOOGLE_SHEET_ID not set — Sheets client will not be initialized');
      return;
    }

    const privateKey   = this.cfg.get<string>('GOOGLE_PRIVATE_KEY', '');
    const clientEmail  = this.cfg.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL', '');

    if (!privateKey || !clientEmail) {
      this.log.warn('Google credentials not set — Sheets client will not be initialized');
      return;
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key:  privateKey.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    this.log.log('Google Sheets client ready');
  }

  // ── Internal: resolve which spreadsheetId to use ─────────────────────

  private resolveId(overrideId?: string): string {
    const id = overrideId ?? this.spreadsheetId;
    if (!id || !this.sheets) {
      throw new Error(
        'Google Sheets is not configured. Set GOOGLE_SHEET_ID and service account credentials.',
      );
    }
    return id;
  }

  isReady(): boolean {
    return !!this.sheets && !!this.spreadsheetId;
  }

  /** Public getter sehingga service lain bisa resolve default spreadsheetId */
  get defaultSpreadsheetId(): string {
    return this.spreadsheetId;
  }

  // ── Low-level helpers — accept optional spreadsheetId override ────────

  /** Read all rows from a tab (including header row). */
  async readAll(tab: string): Promise<string[][]> {
    return this.readAllWithId(this.resolveId(), tab);
  }

  async readAllWithId(spreadsheetId: string, tab: string): Promise<string[][]> {
    if (!this.sheets) throw new Error('Sheets client not initialised');
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}`,
    });
    return (res.data.values ?? []) as string[][];
  }

  /** Read rows as objects (row 1 = header). */
  async readRows<T = Record<string, string>>(tab: string): Promise<T[]> {
    return this.readRowsWithId<T>(this.resolveId(), tab);
  }

  async readRowsWithId<T = Record<string, string>>(
    spreadsheetId: string,
    tab: string,
  ): Promise<T[]> {
    const rows = await this.readAllWithId(spreadsheetId, tab);
    if (rows.length < 2) return [];
    const [headers, ...data] = rows;
    return data.map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      return obj as T;
    });
  }

  /** Append a single row. */
  async appendRow(tab: string, values: (string | number | boolean | null)[]): Promise<void> {
    return this.appendRowWithId(this.resolveId(), tab, values);
  }

  async appendRowWithId(
    spreadsheetId: string,
    tab:           string,
    values:        (string | number | boolean | null)[],
  ): Promise<void> {
    if (!this.sheets) throw new Error('Sheets client not initialised');
    await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range:            `${tab}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody:      { values: [values.map(String)] },
    });
  }

  /** Update a specific row (1-based, header = row 1). */
  async updateRow(
    tab:      string,
    rowIndex: number,
    values:   (string | number | boolean | null)[],
  ): Promise<void> {
    return this.updateRowWithId(this.resolveId(), tab, rowIndex, values);
  }

  async updateRowWithId(
    spreadsheetId: string,
    tab:           string,
    rowIndex:      number,
    values:        (string | number | boolean | null)[],
  ): Promise<void> {
    if (!this.sheets) throw new Error('Sheets client not initialised');
    const range = `${tab}!A${rowIndex + 1}`;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody:      { values: [values.map(String)] },
    });
  }

  /** Soft-delete a row. */
  async deleteRow(tab: string, rowIndex: number, hardDelete = false): Promise<void> {
    return this.deleteRowWithId(this.resolveId(), tab, rowIndex, hardDelete);
  }

  async deleteRowWithId(
    spreadsheetId: string,
    tab:           string,
    rowIndex:      number,
    hardDelete     = false,
  ): Promise<void> {
    if (!this.sheets) throw new Error('Sheets client not initialised');
    const range = `${tab}!A${rowIndex + 1}`;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody:      { values: [hardDelete ? [''] : ['__DELETED__']] },
    });
  }

  /** Find 1-based row index by column value. Returns -1 if not found. */
  async findRowIndex(tab: string, colIndex: number, value: string): Promise<number> {
    return this.findRowIndexWithId(this.resolveId(), tab, colIndex, value);
  }

  async findRowIndexWithId(
    spreadsheetId: string,
    tab:           string,
    colIndex:      number,
    value:         string,
  ): Promise<number> {
    const rows = await this.readAllWithId(spreadsheetId, tab);
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][colIndex] ?? '') === value) return i;
    }
    return -1;
  }

  /** Ensure header row exists; creates the tab if missing. */
  async ensureHeader(tab: string, headers: string[]): Promise<void> {
    return this.ensureHeaderWithId(this.resolveId(), tab, headers);
  }

  async ensureHeaderWithId(
    spreadsheetId: string,
    tab:           string,
    headers:       string[],
  ): Promise<void> {
    if (!this.sheets) throw new Error('Sheets client not initialised');

    let rows: string[][] = [];
    try {
      rows = await this.readAllWithId(spreadsheetId, tab);
    } catch (err: unknown) {
      const status  = (err as { status?: number; code?: number })?.status
                   ?? (err as { status?: number; code?: number })?.code;
      const message = (err as { message?: string })?.message ?? '';

      // Google Sheets returns 400 "Unable to parse range: <tab>" when the
      // sheet tab does not exist yet — treat the same as 404.
      const tabNotFound =
        status === 404 ||
        (status === 400 && message.toLowerCase().includes('unable to parse range'));

      if (tabNotFound) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
        });
        rows = [];
      } else {
        throw err;
      }
    }

    if (rows.length === 0) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range:            `${tab}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody:      { values: [headers] },
      });
    }
  }
}
