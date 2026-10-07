-- =============================================================================
-- Migration: Admin & Super Admin system
-- Run after schema.sql and migrate-workspace.sql
-- =============================================================================

-- 1. Add role column to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin', 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. Admin activity log
CREATE TABLE IF NOT EXISTS admin_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action        VARCHAR(80) NOT NULL,   -- 'user.disable' | 'plan.upgrade' | 'feature.toggle' etc.
  target_type   VARCHAR(30),            -- 'user' | 'plan' | 'feature'
  target_id     UUID,
  meta          JSONB,                  -- extra context (old/new values)
  ip            INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_al_admin  ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_al_action ON admin_logs(action);

-- 3. Seed initial super admin (password: SuperAdmin123!)
-- Hash generated with bcrypt rounds=12 for "SuperAdmin123!"
-- Replace AFTER deployment with a real secure password via POST /super-admin/auth/change-password
INSERT INTO users (name, email, password_hash, role, is_active, is_verified)
VALUES (
  'Super Admin',
  'superadmin@pulse.app',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBP/D5XJ6KKVPS',   -- SuperAdmin123!
  'super_admin',
  true,
  true
)
ON CONFLICT (email) DO UPDATE SET role = 'super_admin', is_active = true;
