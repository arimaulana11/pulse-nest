-- =============================================================================
-- PULSE SaaS — PostgreSQL Database Schema v2
-- Concept  : Multi-tenant personal finance SaaS
-- Database  : pulse_db
-- Encoding  : UTF-8
--
-- Architecture overview:
--   ┌─────────────────────────────────────────────────────────┐
--   │  PLATFORM LAYER  (plans, features, pricing)             │
--   │  TENANT LAYER    (users, subscriptions, quotas)         │
--   │  APP LAYER       (transactions, budget, journey, goals) │
--   │  SYSTEM LAYER    (audit, tokens, webhooks)              │
--   └─────────────────────────────────────────────────────────┘
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for LIKE-based full-text search

-------------------------------------------------------------------------------
-- HELPER: auto-update updated_at on any row change
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Macro so we don't repeat the trigger DDL for every table
CREATE OR REPLACE FUNCTION create_updated_at_trigger(tbl TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
     CREATE TRIGGER trg_%1$s_updated_at
     BEFORE UPDATE ON %1$s
     FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
    tbl
  );
END;
$$;


-- =============================================================================
-- 1. PLANS  (the product catalog — what Pulse sells)
-- =============================================================================
CREATE TABLE plans (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(30)   NOT NULL UNIQUE,  -- 'free' | 'normal_plus' | 'vip'
  name            VARCHAR(100)  NOT NULL,          -- 'Free' | 'Normal+' | 'VIP'
  description     TEXT,
  price_monthly   INT           NOT NULL DEFAULT 0, -- IDR, 0 = free
  price_yearly    INT           NOT NULL DEFAULT 0, -- IDR, with discount
  currency        CHAR(3)       NOT NULL DEFAULT 'IDR',
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order      INT           NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

SELECT create_updated_at_trigger('plans');

INSERT INTO plans (code, name, description, price_monthly, price_yearly, sort_order) VALUES
  ('free',
   'Free',
   'Catat transaksi dasar, lihat ringkasan, journey Stability.',
   0, 0, 1),
  ('normal_plus',
   'Normal+',
   'Budget pos tak terbatas, insight lanjutan, journey Saving, ekspor data.',
   29000, 290000, 2),
  ('vip',
   'VIP',
   'Semua fitur Normal+, Silent Mode permanen, journey Growth, prioritas support.',
   59000, 590000, 3);


-- =============================================================================
-- 2. FEATURES  (granular capability flags per plan)
-- =============================================================================
CREATE TABLE features (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(80)   NOT NULL UNIQUE,
  label       VARCHAR(150)  NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO features (code, label) VALUES
  ('transactions_unlimited',   'Transaksi tak terbatas'),
  ('transactions_limit_30',    'Maks 30 transaksi / bulan'),
  ('budget_positions_unlimited','Pos anggaran tak terbatas'),
  ('budget_positions_limit_4', 'Maks 4 pos anggaran'),
  ('insight_basic',            'Insight ringkasan'),
  ('insight_advanced',         'Insight lanjutan (perbandingan, tren)'),
  ('journey_stability',        'Journey: Stability'),
  ('journey_survival',         'Journey: Survival'),
  ('journey_saving',           'Journey: Saving'),
  ('journey_growth',           'Journey: Growth'),
  ('silent_mode_streak',       'Silent Mode via streak 7 hari'),
  ('silent_mode_permanent',    'Silent Mode permanen (VIP)'),
  ('export_csv',               'Ekspor data CSV'),
  ('custom_categories',        'Kategori kustom'),
  ('streak_gamification',      'Streak harian'),
  ('priority_support',         'Prioritas support');


-- =============================================================================
-- 3. PLAN FEATURES  (many-to-many: which plan includes which feature)
-- =============================================================================
CREATE TABLE plan_features (
  plan_id     UUID  NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature_id  UUID  NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, feature_id)
);

-- Free plan features
INSERT INTO plan_features (plan_id, feature_id)
SELECT p.id, f.id FROM plans p, features f
WHERE p.code = 'free'
  AND f.code IN (
    'transactions_limit_30',
    'budget_positions_limit_4',
    'insight_basic',
    'journey_survival',
    'journey_stability',
    'silent_mode_streak',
    'streak_gamification'
  );

-- Normal+ plan features
INSERT INTO plan_features (plan_id, feature_id)
SELECT p.id, f.id FROM plans p, features f
WHERE p.code = 'normal_plus'
  AND f.code IN (
    'transactions_unlimited',
    'budget_positions_unlimited',
    'insight_basic',
    'insight_advanced',
    'journey_survival',
    'journey_stability',
    'journey_saving',
    'silent_mode_streak',
    'streak_gamification',
    'export_csv',
    'custom_categories'
  );

-- VIP plan features
INSERT INTO plan_features (plan_id, feature_id)
SELECT p.id, f.id FROM plans p, features f
WHERE p.code = 'vip'
  AND f.code IN (
    'transactions_unlimited',
    'budget_positions_unlimited',
    'insight_basic',
    'insight_advanced',
    'journey_survival',
    'journey_stability',
    'journey_saving',
    'journey_growth',
    'silent_mode_streak',
    'silent_mode_permanent',
    'streak_gamification',
    'export_csv',
    'custom_categories',
    'priority_support'
  );


-- =============================================================================
-- 4. USERS  (tenants — each user is an isolated tenant)
-- =============================================================================
CREATE TABLE users (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100)  NOT NULL,
  email           VARCHAR(255)  NOT NULL UNIQUE,
  password_hash   VARCHAR(255)  NOT NULL,
  avatar_url      VARCHAR(500),
  phone           VARCHAR(20),
  locale          VARCHAR(10)   NOT NULL DEFAULT 'id',
  timezone        VARCHAR(50)   NOT NULL DEFAULT 'Asia/Jakarta',
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  is_verified     BOOLEAN       NOT NULL DEFAULT FALSE,  -- email verified
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
SELECT create_updated_at_trigger('users');


-- =============================================================================
-- 5. SUBSCRIPTIONS  (a user's active plan + billing state)
-- =============================================================================
CREATE TABLE subscriptions (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID          NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id           UUID          NOT NULL REFERENCES plans(id),
  billing_cycle     VARCHAR(10)   NOT NULL DEFAULT 'monthly'
                                  CHECK (billing_cycle IN ('monthly', 'yearly', 'lifetime')),
  status            VARCHAR(20)   NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  trial_ends_at     TIMESTAMPTZ,                        -- NULL = no trial
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end   TIMESTAMPTZ,                     -- NULL = free / lifetime
  cancelled_at      TIMESTAMPTZ,
  payment_provider  VARCHAR(30),                        -- 'midtrans' | 'stripe' | null (free)
  provider_sub_id   VARCHAR(255),                       -- external subscription ID
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subs_user   ON subscriptions(user_id);
CREATE INDEX idx_subs_status ON subscriptions(status);
SELECT create_updated_at_trigger('subscriptions');

-- Every new user gets a free plan subscription automatically
-- (handled in application layer after INSERT into users)


-- =============================================================================
-- 6. SUBSCRIPTION INVOICES  (billing history)
-- =============================================================================
CREATE TABLE invoices (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id   UUID          REFERENCES subscriptions(id) ON DELETE SET NULL,
  plan_id           UUID          REFERENCES plans(id),
  amount            INT           NOT NULL,             -- IDR
  currency          CHAR(3)       NOT NULL DEFAULT 'IDR',
  status            VARCHAR(20)   NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  billing_cycle     VARCHAR(10)   NOT NULL DEFAULT 'monthly',
  period_start      TIMESTAMPTZ,
  period_end        TIMESTAMPTZ,
  payment_provider  VARCHAR(30),
  provider_invoice_id VARCHAR(255),
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_user   ON invoices(user_id);
CREATE INDEX idx_invoices_status ON invoices(status);


-- =============================================================================
-- 7. USAGE QUOTAS  (enforce per-plan limits)
--    Reset monthly by a cron job / background task
-- =============================================================================
CREATE TABLE usage_quotas (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_code      VARCHAR(80) NOT NULL,
  used              INT         NOT NULL DEFAULT 0,
  limit_value       INT         NOT NULL DEFAULT -1,    -- -1 = unlimited
  reset_on          DATE        NOT NULL,               -- first day of next month
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, feature_code)
);

CREATE INDEX idx_quota_user ON usage_quotas(user_id);
SELECT create_updated_at_trigger('usage_quotas');


-- =============================================================================
-- 8. CATEGORIES  (system defaults + user-custom)
-- =============================================================================
CREATE TABLE categories (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID          REFERENCES users(id) ON DELETE CASCADE,  -- NULL = system
  name        VARCHAR(100)  NOT NULL,
  emoji       VARCHAR(10)   NOT NULL DEFAULT '📦',
  color       VARCHAR(7)    NOT NULL DEFAULT '#8C7B70',
  type        VARCHAR(10)   NOT NULL DEFAULT 'expense'
                            CHECK (type IN ('income', 'expense', 'both')),
  is_system   BOOLEAN       NOT NULL DEFAULT FALSE,
  sort_order  INT           NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cat_user ON categories(user_id);
CREATE INDEX idx_cat_type ON categories(type);

INSERT INTO categories (id, name, emoji, color, type, is_system, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Makan & Minum',  '🍳', '#B25329', 'expense', TRUE,  1),
  ('00000000-0000-0000-0000-000000000002', 'Transport',      '🚗', '#E8833A', 'expense', TRUE,  2),
  ('00000000-0000-0000-0000-000000000003', 'Belanja',        '🛍️','#E5A84B', 'expense', TRUE,  3),
  ('00000000-0000-0000-0000-000000000004', 'Kesehatan',      '💊', '#3A8B5B', 'expense', TRUE,  4),
  ('00000000-0000-0000-0000-000000000005', 'Hiburan',        '🎮', '#8C7B70', 'expense', TRUE,  5),
  ('00000000-0000-0000-0000-000000000006', 'Pendidikan',     '📚', '#B25329', 'expense', TRUE,  6),
  ('00000000-0000-0000-0000-000000000007', 'Kopi & Minuman', '☕', '#8C3B18', 'expense', TRUE,  7),
  ('00000000-0000-0000-0000-000000000008', 'Tagihan',        '💡', '#E8833A', 'expense', TRUE,  8),
  ('00000000-0000-0000-0000-000000000009', 'Gaji',           '💼', '#3A8B5B', 'income',  TRUE,  9),
  ('00000000-0000-0000-0000-000000000010', 'Freelance',      '💻', '#3A8B5B', 'income',  TRUE, 10),
  ('00000000-0000-0000-0000-000000000011', 'Tabungan',       '🏦', '#B25329', 'both',    TRUE, 11),
  ('00000000-0000-0000-0000-000000000012', 'Lainnya',        '📦', '#8C7B70', 'both',    TRUE, 12);


-- =============================================================================
-- 9. TRANSACTIONS  (core app data — stored in Google Sheets for free/normal+,
--    mirrored here for VIP analytics and quota tracking)
-- =============================================================================
CREATE TABLE transactions (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id   UUID          NOT NULL REFERENCES categories(id),
  type          VARCHAR(10)   NOT NULL CHECK (type IN ('income', 'expense')),
  amount        BIGINT        NOT NULL CHECK (amount > 0),
  description   VARCHAR(255)  NOT NULL,
  note          TEXT,
  date          DATE          NOT NULL DEFAULT CURRENT_DATE,
  source        VARCHAR(20)   NOT NULL DEFAULT 'app'
                              CHECK (source IN ('app', 'import', 'auto')),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tx_user       ON transactions(user_id);
CREATE INDEX idx_tx_user_date  ON transactions(user_id, date DESC);
CREATE INDEX idx_tx_category   ON transactions(category_id);
CREATE INDEX idx_tx_desc_trgm  ON transactions USING gin(description gin_trgm_ops);
SELECT create_updated_at_trigger('transactions');


-- =============================================================================
-- 10. BUDGET POSITIONS  (pos anggaran)
-- =============================================================================
CREATE TABLE budget_positions (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id   UUID          REFERENCES categories(id) ON DELETE SET NULL,
  label         VARCHAR(100)  NOT NULL,
  emoji         VARCHAR(10)   NOT NULL DEFAULT '📦',
  color         VARCHAR(7)    NOT NULL DEFAULT '#E5A84B',
  allocated     BIGINT        NOT NULL DEFAULT 0 CHECK (allocated >= 0),
  period        VARCHAR(10)   NOT NULL DEFAULT 'monthly'
                              CHECK (period IN ('monthly', 'weekly', 'yearly')),
  month         SMALLINT      NOT NULL CHECK (month BETWEEN 1 AND 12),
  year          SMALLINT      NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, label, month, year)
);

CREATE INDEX idx_budget_period ON budget_positions(user_id, year, month);
SELECT create_updated_at_trigger('budget_positions');


-- =============================================================================
-- 11. STREAKS  (gamification — daily app open)
-- =============================================================================
CREATE TABLE streaks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  current_count   INT         NOT NULL DEFAULT 0,
  longest_count   INT         NOT NULL DEFAULT 0,
  last_active_on  DATE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT create_updated_at_trigger('streaks');


-- =============================================================================
-- 12. SILENT MODE  (feature gated behind streak OR VIP plan)
-- =============================================================================
CREATE TABLE silent_modes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  is_active     BOOLEAN     NOT NULL DEFAULT FALSE,
  activated_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,              -- NULL = permanent (VIP)
  unlocked_via  VARCHAR(20) DEFAULT 'streak'
                            CHECK (unlocked_via IN ('streak', 'vip')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT create_updated_at_trigger('silent_modes');


-- =============================================================================
-- 13. JOURNEY STAGES  (system-defined progression)
-- =============================================================================
CREATE TABLE journey_stages (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  key             VARCHAR(50)   NOT NULL UNIQUE,
  title           VARCHAR(100)  NOT NULL,
  subtitle        VARCHAR(255),
  emoji           VARCHAR(10)   NOT NULL DEFAULT '🏠',
  sort_order      INT           NOT NULL DEFAULT 0,
  required_plan   VARCHAR(30)   NOT NULL DEFAULT 'free'
                                REFERENCES plans(code) ON UPDATE CASCADE
);

INSERT INTO journey_stages (key, title, subtitle, emoji, sort_order, required_plan) VALUES
  ('survival',  'Survival',  'Persiapan Dasar Keuangan Sehat', '🛡️', 1, 'free'),
  ('stability', 'Stability', 'Dana Darurat 1 Bulan',           '🏠', 2, 'free'),
  ('saving',    'Saving',    'Saving Goal',                    '🧺', 3, 'normal_plus'),
  ('growth',    'Growth',    'Investasi & Tumbuh',             '🌱', 4, 'vip');


-- =============================================================================
-- 14. JOURNEY TASKS  (system-defined checklist per stage)
-- =============================================================================
CREATE TABLE journey_tasks (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id      UUID          NOT NULL REFERENCES journey_stages(id) ON DELETE CASCADE,
  key           VARCHAR(100)  NOT NULL,
  title         VARCHAR(255)  NOT NULL,
  description   TEXT,
  emoji         VARCHAR(10)   NOT NULL DEFAULT '📋',
  requirement   VARCHAR(20)   NOT NULL DEFAULT 'wajib'
                              CHECK (requirement IN ('wajib', 'opsional')),
  target_type   VARCHAR(30)   NOT NULL DEFAULT 'boolean'
                              CHECK (target_type IN ('boolean', 'amount', 'count', 'days')),
  target_value  BIGINT        NOT NULL DEFAULT 1,
  deadline_days INT,
  sort_order    INT           NOT NULL DEFAULT 0,
  UNIQUE (stage_id, key)
);

INSERT INTO journey_tasks (stage_id, key, title, description, emoji, requirement, target_type, target_value, deadline_days, sort_order)
SELECT id,'dana_darurat', 'Dana Darurat 1 Bulan',    'Kumpulkan dana darurat minimal 1 bulan pengeluaran','🛡️','wajib',   'amount', 3500000,60,1 FROM journey_stages WHERE key='stability';
INSERT INTO journey_tasks (stage_id, key, title, description, emoji, requirement, target_type, target_value, deadline_days, sort_order)
SELECT id,'buat_anggaran','Buat Anggaran Bulanan',   'Rencanakan pengeluaran tiap pos setiap bulan',      '📋','wajib',   'boolean',1,      30,2 FROM journey_stages WHERE key='stability';
INSERT INTO journey_tasks (stage_id, key, title, description, emoji, requirement, target_type, target_value, deadline_days, sort_order)
SELECT id,'catat_7hari',  'Catat Pengeluaran 7 Hari','Konsisten mencatat transaksi selama 7 hari penuh',  '📒','wajib',   'days',   7,      14,3 FROM journey_stages WHERE key='stability';
INSERT INTO journey_tasks (stage_id, key, title, description, emoji, requirement, target_type, target_value, deadline_days, sort_order)
SELECT id,'kurangi_tx',   'Kurangi 1 Pengeluaran',  'Identifikasi dan hentikan satu pengeluaran tidak perlu','✂️','opsional','boolean',1,   30,4 FROM journey_stages WHERE key='stability';


-- =============================================================================
-- 15. USER JOURNEY PROGRESS
-- =============================================================================
CREATE TABLE user_journey_progress (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage_id      UUID        NOT NULL REFERENCES journey_stages(id),
  status        VARCHAR(20) NOT NULL DEFAULT 'locked'
                            CHECK (status IN ('locked', 'active', 'completed')),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, stage_id)
);

CREATE INDEX idx_ujp_user ON user_journey_progress(user_id);
SELECT create_updated_at_trigger('user_journey_progress');


-- =============================================================================
-- 16. USER TASK PROGRESS
-- =============================================================================
CREATE TABLE user_task_progress (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id        UUID        NOT NULL REFERENCES journey_tasks(id) ON DELETE CASCADE,
  current_value  BIGINT      NOT NULL DEFAULT 0,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'in_progress', 'completed')),
  completed_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, task_id)
);

CREATE INDEX idx_utp_user ON user_task_progress(user_id);
SELECT create_updated_at_trigger('user_task_progress');


-- =============================================================================
-- 17. FINANCIAL GOALS
-- =============================================================================
CREATE TABLE financial_goals (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id         UUID          REFERENCES journey_tasks(id) ON DELETE SET NULL,
  title           VARCHAR(255)  NOT NULL,
  emoji           VARCHAR(10)   NOT NULL DEFAULT '🎯',
  target_amount   BIGINT        NOT NULL CHECK (target_amount > 0),
  collected       BIGINT        NOT NULL DEFAULT 0 CHECK (collected >= 0),
  monthly_deposit BIGINT        NOT NULL DEFAULT 0,
  deadline        DATE,
  status          VARCHAR(20)   NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'completed', 'paused')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_goals_user ON financial_goals(user_id);
SELECT create_updated_at_trigger('financial_goals');


-- =============================================================================
-- 18. GOAL MILESTONES
-- =============================================================================
CREATE TABLE goal_milestones (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id     UUID    NOT NULL REFERENCES financial_goals(id) ON DELETE CASCADE,
  step        INT     NOT NULL,
  amount      BIGINT  NOT NULL,
  label       VARCHAR(100),
  is_reached  BOOLEAN NOT NULL DEFAULT FALSE,
  reached_at  TIMESTAMPTZ,
  UNIQUE (goal_id, step)
);


-- =============================================================================
-- 19. GOAL DEPOSITS  (riwayat setoran)
-- =============================================================================
CREATE TABLE goal_deposits (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id       UUID        NOT NULL REFERENCES financial_goals(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        BIGINT      NOT NULL CHECK (amount > 0),
  type          VARCHAR(20) NOT NULL DEFAULT 'manual'
                            CHECK (type IN ('manual', 'auto', 'rollover')),
  note          TEXT,
  deposited_at  DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deposits_goal ON goal_deposits(goal_id);
CREATE INDEX idx_deposits_user ON goal_deposits(user_id);


-- =============================================================================
-- 20. RESET TOKENS  (forgot-password OTP)
-- =============================================================================
CREATE TABLE reset_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  used        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rt_user ON reset_tokens(user_id);


-- =============================================================================
-- 21. REFRESH TOKENS  (JWT rotation)
-- =============================================================================
CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  revoked     BOOLEAN      NOT NULL DEFAULT FALSE,
  device_hint VARCHAR(200),                             -- e.g. 'iPhone 15 · Safari'
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rft_user ON refresh_tokens(user_id);


-- =============================================================================
-- 22. PAYMENT EVENTS  (webhook log from Midtrans / Stripe)
-- =============================================================================
CREATE TABLE payment_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
  invoice_id      UUID        REFERENCES invoices(id) ON DELETE SET NULL,
  provider        VARCHAR(30) NOT NULL,                 -- 'midtrans' | 'stripe'
  event_type      VARCHAR(80) NOT NULL,                 -- 'payment.success' | 'payment.failed' etc.
  provider_ref    VARCHAR(255),                         -- transaction_id / charge_id
  amount          INT,
  currency        CHAR(3)     DEFAULT 'IDR',
  status          VARCHAR(20),                          -- provider status string
  raw_payload     JSONB,                                -- full webhook body
  processed       BOOLEAN     NOT NULL DEFAULT FALSE,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pe_user     ON payment_events(user_id);
CREATE INDEX idx_pe_provider ON payment_events(provider, event_type);
CREATE INDEX idx_pe_ref      ON payment_events(provider_ref);


-- =============================================================================
-- 23. AUDIT LOG  (who did what — compliance + support)
-- =============================================================================
CREATE TABLE audit_logs (
  id          BIGSERIAL     PRIMARY KEY,
  user_id     UUID          REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(80)   NOT NULL,   -- 'user.register' | 'sub.upgrade' | 'tx.create' etc.
  entity_type VARCHAR(50),              -- 'transaction' | 'subscription' | 'user'
  entity_id   UUID,
  meta        JSONB,                    -- diff / context data
  ip          INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user   ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);


-- =============================================================================
-- VIEWS
-- =============================================================================

-- Active plan per user (most recent subscription)
CREATE VIEW v_user_plan AS
SELECT
  u.id         AS user_id,
  u.name,
  u.email,
  p.code       AS plan_code,
  p.name       AS plan_name,
  s.status     AS sub_status,
  s.billing_cycle,
  s.current_period_end,
  s.trial_ends_at
FROM users u
JOIN subscriptions s ON s.user_id = u.id
JOIN plans p         ON p.id      = s.plan_id;

-- Monthly income / expense / balance per user
CREATE VIEW v_monthly_balance AS
SELECT
  user_id,
  EXTRACT(YEAR  FROM date)::INT AS year,
  EXTRACT(MONTH FROM date)::INT AS month,
  SUM(CASE WHEN type='income'  THEN amount ELSE 0 END)          AS total_income,
  SUM(CASE WHEN type='expense' THEN amount ELSE 0 END)          AS total_expense,
  SUM(CASE WHEN type='income'  THEN amount ELSE -amount END)    AS net_balance
FROM transactions
GROUP BY user_id, year, month;

-- Budget utilization with live spent amounts
CREATE VIEW v_budget_utilization AS
SELECT
  bp.id        AS budget_position_id,
  bp.user_id,
  bp.label,
  bp.emoji,
  bp.color,
  bp.allocated,
  bp.month,
  bp.year,
  COALESCE(SUM(t.amount), 0) AS spent,
  CASE
    WHEN bp.allocated = 0 THEN 0
    ELSE ROUND((COALESCE(SUM(t.amount),0) * 100.0) / bp.allocated, 1)
  END AS percent_used
FROM budget_positions bp
LEFT JOIN transactions t
  ON  t.user_id     = bp.user_id
  AND t.category_id = bp.category_id
  AND t.type        = 'expense'
  AND EXTRACT(MONTH FROM t.date)::INT = bp.month
  AND EXTRACT(YEAR  FROM t.date)::INT = bp.year
GROUP BY bp.id;

-- Feature access check helper view
CREATE VIEW v_user_features AS
SELECT
  u.id            AS user_id,
  p.code          AS plan_code,
  f.code          AS feature_code,
  f.label         AS feature_label
FROM users u
JOIN subscriptions s  ON s.user_id = u.id AND s.status IN ('trialing','active')
JOIN plans p          ON p.id = s.plan_id
JOIN plan_features pf ON pf.plan_id = p.id
JOIN features f       ON f.id = pf.feature_id;


-- =============================================================================
-- STORED PROCEDURE: provision_new_user
-- Call this after inserting a new user to set up their free subscription,
-- streak row, usage quota, and silent mode record.
-- =============================================================================
CREATE OR REPLACE PROCEDURE provision_new_user(p_user_id UUID)
LANGUAGE plpgsql AS $$
DECLARE
  v_free_plan_id UUID;
BEGIN
  SELECT id INTO v_free_plan_id FROM plans WHERE code = 'free';

  -- Free subscription (no expiry)
  INSERT INTO subscriptions (user_id, plan_id, billing_cycle, status, current_period_start)
  VALUES (p_user_id, v_free_plan_id, 'monthly', 'active', NOW())
  ON CONFLICT (user_id) DO NOTHING;

  -- Streak row
  INSERT INTO streaks (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Silent mode row
  INSERT INTO silent_modes (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Monthly transaction quota for free plan (30/month)
  INSERT INTO usage_quotas (user_id, feature_code, used, limit_value, reset_on)
  VALUES (p_user_id, 'transactions_limit_30', 0, 30,
          DATE_TRUNC('month', NOW())::DATE + INTERVAL '1 month')
  ON CONFLICT (user_id, feature_code) DO NOTHING;

  -- Monthly budget quota for free plan (4 positions)
  INSERT INTO usage_quotas (user_id, feature_code, used, limit_value, reset_on)
  VALUES (p_user_id, 'budget_positions_limit_4', 0, 4,
          DATE_TRUNC('month', NOW())::DATE + INTERVAL '1 month')
  ON CONFLICT (user_id, feature_code) DO NOTHING;

  -- Initial journey progress: survival = completed, stability = active
  INSERT INTO user_journey_progress (user_id, stage_id, status, started_at, completed_at)
  SELECT p_user_id, id, 'completed', NOW(), NOW()
  FROM journey_stages WHERE key = 'survival'
  ON CONFLICT DO NOTHING;

  INSERT INTO user_journey_progress (user_id, stage_id, status, started_at)
  SELECT p_user_id, id, 'active', NOW()
  FROM journey_stages WHERE key = 'stability'
  ON CONFLICT DO NOTHING;
END;
$$;


-- =============================================================================
-- 24. WORKSPACES  (organisasi / tim — shared finance space)
-- =============================================================================
CREATE TABLE workspaces (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(150)  NOT NULL,
  slug        VARCHAR(80)   NOT NULL UNIQUE,   -- URL-friendly identifier
  logo_url    VARCHAR(500),
  owner_id    UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_id     UUID          REFERENCES plans(id),  -- workspace-level plan (future)
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ws_owner ON workspaces(owner_id);
SELECT create_updated_at_trigger('workspaces');


-- =============================================================================
-- 25. WORKSPACE ROLES  (role definitions per workspace)
-- Role hierarchy: owner > admin > bendahara > viewer
-- =============================================================================
CREATE TABLE workspace_roles (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(30)   NOT NULL UNIQUE,   -- 'owner' | 'admin' | 'bendahara' | 'viewer'
  label       VARCHAR(80)   NOT NULL,
  description TEXT,
  level       INT           NOT NULL DEFAULT 0  -- higher = more permissions
);

INSERT INTO workspace_roles (code, label, description, level) VALUES
  ('owner',      'Owner',      'Pemilik workspace, semua akses penuh',            100),
  ('admin',      'Admin',      'Kelola anggota, kategori, dan pengaturan',         80),
  ('bendahara',  'Bendahara',  'Input & edit transaksi, lihat semua laporan',      60),
  ('viewer',     'Viewer',     'Hanya bisa melihat laporan, tidak bisa input',     20);


-- =============================================================================
-- 26. WORKSPACE MEMBERS  (users inside a workspace with a role)
-- =============================================================================
CREATE TABLE workspace_members (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id)       ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
  role_id       UUID        NOT NULL REFERENCES workspace_roles(id),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX idx_wm_workspace ON workspace_members(workspace_id);
CREATE INDEX idx_wm_user      ON workspace_members(user_id);
SELECT create_updated_at_trigger('workspace_members');


-- =============================================================================
-- 27. WORKSPACE INVITATIONS  (pending email invites)
-- =============================================================================
CREATE TABLE workspace_invitations (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID          NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_by    UUID          NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  email         VARCHAR(255)  NOT NULL,
  role_id       UUID          NOT NULL REFERENCES workspace_roles(id),
  token         VARCHAR(255)  NOT NULL UNIQUE,   -- secure random token in email link
  status        VARCHAR(20)   NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at    TIMESTAMPTZ   NOT NULL,
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, email, status)            -- one active invite per email
);

CREATE INDEX idx_wi_workspace ON workspace_invitations(workspace_id);
CREATE INDEX idx_wi_email     ON workspace_invitations(email);
CREATE INDEX idx_wi_token     ON workspace_invitations(token);


-- =============================================================================
-- VIEW: workspace member details (for member list UI)
-- =============================================================================
CREATE VIEW v_workspace_members AS
SELECT
  wm.id               AS member_id,
  wm.workspace_id,
  wm.joined_at,
  u.id                AS user_id,
  u.name,
  u.email,
  u.avatar_url,
  wr.code             AS role_code,
  wr.label            AS role_label,
  wr.level            AS role_level
FROM workspace_members wm
JOIN users            u  ON u.id  = wm.user_id
JOIN workspace_roles  wr ON wr.id = wm.role_id
ORDER BY wr.level DESC, wm.joined_at ASC;


-- =============================================================================
-- VIEW: pending invitations with inviter info
-- =============================================================================
CREATE VIEW v_workspace_invitations AS
SELECT
  wi.id,
  wi.workspace_id,
  wi.email,
  wi.status,
  wi.expires_at,
  wi.created_at,
  wr.code   AS role_code,
  wr.label  AS role_label,
  u.name    AS invited_by_name,
  u.email   AS invited_by_email
FROM workspace_invitations wi
JOIN workspace_roles  wr ON wr.id = wi.role_id
JOIN users            u  ON u.id  = wi.invited_by;
