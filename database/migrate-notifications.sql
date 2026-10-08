-- =============================================================================
-- Persistent notifications table
-- Stores notifications so they survive page reloads and mark-as-read persists
-- =============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         VARCHAR(30) NOT NULL DEFAULT 'tip'
               CHECK (type IN ('invite','budget','streak','journey','tip','payment','system')),
  emoji        VARCHAR(10) NOT NULL DEFAULT '💡',
  title        VARCHAR(255) NOT NULL,
  body         TEXT        NOT NULL,
  is_read      BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Optional references
  invite_id    UUID        REFERENCES workspace_invitations(id) ON DELETE SET NULL,
  workspace_id UUID        REFERENCES workspaces(id) ON DELETE CASCADE,
  action_label VARCHAR(100),
  action_href  VARCHAR(500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notif_user       ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user_read  ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_created    ON notifications(created_at DESC);
