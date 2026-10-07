-- =============================================================================
-- Migration: extend workspaces table with type + Google Sheet fields
-- Run once after the main schema.sql has been applied.
-- =============================================================================

-- 1. workspace type  (personal | family | org)
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'personal'
    CHECK (type IN ('personal', 'family', 'org'));

-- 2. Google Sheet integration fields
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS sheet_id              VARCHAR(255),  -- Spreadsheet ID
  ADD COLUMN IF NOT EXISTS sheet_tab_tx          VARCHAR(100)  DEFAULT 'transactions',
  ADD COLUMN IF NOT EXISTS sheet_tab_budget      VARCHAR(100)  DEFAULT 'budget_positions',
  ADD COLUMN IF NOT EXISTS sheet_tab_journey     VARCHAR(100)  DEFAULT 'journey_progress',
  ADD COLUMN IF NOT EXISTS sheet_tab_goals       VARCHAR(100)  DEFAULT 'goals',
  ADD COLUMN IF NOT EXISTS service_account_email VARCHAR(255),  -- SA that has access to the sheet
  ADD COLUMN IF NOT EXISTS description           TEXT,
  ADD COLUMN IF NOT EXISTS emoji                 VARCHAR(10)   DEFAULT '💼';

-- 3. Ensure workspace_roles seed is present (idempotent)
INSERT INTO workspace_roles (code, label, description, level) VALUES
  ('owner',     'Owner',     'Pemilik workspace, semua akses penuh',           100),
  ('admin',     'Admin',     'Kelola anggota, kategori, dan pengaturan',        80),
  ('bendahara', 'Bendahara', 'Input & edit transaksi, lihat semua laporan',     60),
  ('viewer',    'Viewer',    'Hanya bisa melihat laporan, tidak bisa input',    20)
ON CONFLICT (code) DO NOTHING;
