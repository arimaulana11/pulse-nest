/**
 * SheetContext — resolved spreadsheet coordinates for one request.
 *
 * Personal mode  → all fields are undefined → services use their default
 *                  tab names and SheetsService uses the global env spreadsheetId.
 *
 * Workspace mode → spreadsheetId + tab names come from the Workspace row,
 *                  services call the *WithId variants.
 */
export interface SheetContext {
  spreadsheetId?: string;   // undefined = use global env
  tabTx?:         string;
  tabBudget?:     string;
  tabJourney?:    string;
  tabGoals?:      string;
}

/** Build a SheetContext from a Workspace entity (or null for personal). */
import type { Workspace } from '../workspaces/workspace.entity.js';

export function contextFromWorkspace(ws: Workspace | null): SheetContext {
  if (!ws?.sheetId) return {};
  return {
    spreadsheetId: ws.sheetId,
    tabTx:         ws.sheetTabTx,
    tabBudget:     ws.sheetTabBudget,
    tabJourney:    ws.sheetTabJourney,
    tabGoals:      ws.sheetTabGoals,
  };
}
