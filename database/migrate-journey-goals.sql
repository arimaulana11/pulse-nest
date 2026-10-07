-- =============================================================================
-- Migration: Journey-Goals integration
-- Adds transaction_id FK to goal_deposits (traceability)
-- Adds goal_id FK to user_task_progress (task ↔ goal sync)
-- =============================================================================

-- 1. Link goal_deposits ke transactions (nullable — manual deposits won't have one)
ALTER TABLE goal_deposits
  ADD COLUMN IF NOT EXISTS transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gd_transaction ON goal_deposits(transaction_id);

-- 2. Link user_task_progress ke financial_goals (optional — for task-goal sync)
ALTER TABLE user_task_progress
  ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES financial_goals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_utp_goal ON user_task_progress(goal_id);

-- 3. Ensure financial_goals has task_id FK (might already exist)
-- Already defined in schema.sql: task_id UUID REFERENCES journey_tasks(id) ON DELETE SET NULL
-- No action needed.

-- 4. Function to auto-update milestones when collected changes
CREATE OR REPLACE FUNCTION update_goal_milestones()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.collected <> OLD.collected THEN
    UPDATE goal_milestones
    SET
      is_reached = (NEW.collected >= goal_milestones.amount),
      reached_at = CASE
        WHEN NEW.collected >= goal_milestones.amount AND NOT is_reached THEN NOW()
        WHEN NEW.collected < goal_milestones.amount THEN NULL
        ELSE reached_at
      END
    WHERE goal_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_goal_milestones_update ON financial_goals;
CREATE TRIGGER trg_goal_milestones_update
  AFTER UPDATE OF collected ON financial_goals
  FOR EACH ROW EXECUTE FUNCTION update_goal_milestones();

-- 5. Helper function: auto-create goal_milestones when a goal is inserted
CREATE OR REPLACE FUNCTION create_goal_milestones()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO goal_milestones (goal_id, step, amount, label, is_reached)
  VALUES
    (NEW.id, 1, ROUND(NEW.target_amount * 0.14), '14% – Langkah Awal',    NEW.collected >= ROUND(NEW.target_amount * 0.14)),
    (NEW.id, 2, ROUND(NEW.target_amount * 0.29), '29% – Seperempat Jalan', NEW.collected >= ROUND(NEW.target_amount * 0.29)),
    (NEW.id, 3, ROUND(NEW.target_amount * 0.50), '50% – Setengah Jalan',  NEW.collected >= ROUND(NEW.target_amount * 0.50)),
    (NEW.id, 4, ROUND(NEW.target_amount * 0.71), '71% – Hampir Sampai',   NEW.collected >= ROUND(NEW.target_amount * 0.71)),
    (NEW.id, 5, NEW.target_amount,               '100% – Goal Tercapai!', NEW.collected >= NEW.target_amount)
  ON CONFLICT (goal_id, step) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_milestones ON financial_goals;
CREATE TRIGGER trg_create_milestones
  AFTER INSERT ON financial_goals
  FOR EACH ROW EXECUTE FUNCTION create_goal_milestones();
