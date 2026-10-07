/**
 * NotificationsService
 *
 * Notifications are not stored in a table — they are generated on-the-fly
 * by querying existing data sources (budget overruns, streak state,
 * workspace invitations).
 *
 * For a full persistent notification system, this service can be extended
 * to write to a `notifications` table and mark them read/deleted there.
 * For now we return a computed list that reflects real current state.
 */
import { Injectable } from '@nestjs/common';
import { DataSource }  from 'typeorm';

export interface NotificationItem {
  id:         string;
  type:       'invite' | 'budget' | 'streak' | 'journey' | 'tip' | 'payment';
  emoji:      string;
  title:      string;
  body:       string;
  isRead:     boolean;
  createdAt:  string;
  action?:    { label: string; href: string };
  inviteId?:  string;
  workspaceId?: string;
  actions?:   { type: 'accept' | 'reject'; label: string }[];
}

@Injectable()
export class NotificationsService {
  constructor(private readonly ds: DataSource) {}

  async getForUser(userId: string): Promise<{ unreadCount: number; notifications: NotificationItem[] }> {
    const notifications: NotificationItem[] = [];

    // ── 1. Workspace invitations pending ─────────────────────────────────
    const invites = await this.ds.query<{
      id: string; workspace_id: string; workspace_name: string;
      invited_by_name: string; role_label: string; created_at: string;
    }[]>(
      `SELECT
         wi.id,
         wi.workspace_id,
         w.name   AS workspace_name,
         u.name   AS invited_by_name,
         wr.label AS role_label,
         wi.created_at
       FROM workspace_invitations wi
       JOIN workspaces      w  ON w.id  = wi.workspace_id
       JOIN users           u  ON u.id  = wi.invited_by
       JOIN workspace_roles wr ON wr.id = wi.role_id
       WHERE wi.email = (SELECT email FROM users WHERE id = $1)
         AND wi.status = 'pending'
         AND wi.expires_at > NOW()
       ORDER BY wi.created_at DESC`,
      [userId],
    );

    for (const inv of invites) {
      notifications.push({
        id:          `invite_${inv.id}`,
        type:        'invite',
        emoji:       '👥',
        title:       `Undangan Workspace`,
        body:        `${inv.invited_by_name} mengundang kamu bergabung ke workspace "${inv.workspace_name}" sebagai ${inv.role_label}.`,
        isRead:      false,
        createdAt:   inv.created_at,
        inviteId:    inv.id,
        workspaceId: inv.workspace_id,
        actions: [
          { type: 'accept', label: 'Terima' },
          { type: 'reject', label: 'Tolak'  },
        ],
      });
    }

    // ── 2. Budget overrun alerts (>= 90% terpakai bulan ini) ─────────────
    // We query Google Sheets via BudgetService — but since notifications
    // are a lightweight endpoint, we skip Sheets here and just return
    // a tip pointing to /budget instead.
    // Budget alerts can be wired later if budget data is in DB.

    // ── 3. Journey tip ────────────────────────────────────────────────────
    notifications.push({
      id:        'tip_journey',
      type:      'tip',
      emoji:     '💡',
      title:     'Tips Manajemen Keuangan',
      body:      'Coba terapkan metode 50/30/20 — 50% kebutuhan, 30% keinginan, 20% tabungan.',
      isRead:    true,
      createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      action:    { label: 'Lihat Journey', href: '/journey' },
    });

    const unreadCount = notifications.filter((n) => !n.isRead).length;
    return { unreadCount, notifications };
  }

  /** Accept a workspace invitation */
  async acceptInvite(inviteId: string, userId: string): Promise<{ message: string }> {
    // Fetch invite + role
    const rows = await this.ds.query<{
      workspace_id: string; role_id: string; email: string;
    }[]>(
      `SELECT workspace_id, role_id, email FROM workspace_invitations
       WHERE id = $1 AND status = 'pending' AND expires_at > NOW()`,
      [inviteId],
    );
    if (!rows.length) return { message: 'Undangan tidak ditemukan atau sudah kadaluarsa' };

    const inv = rows[0];
    // Verify email matches current user
    const userRow = await this.ds.query<{ email: string }[]>(
      `SELECT email FROM users WHERE id = $1`, [userId],
    );
    if (!userRow.length || userRow[0].email !== inv.email) {
      return { message: 'Undangan bukan untuk akun ini' };
    }

    // Add member
    await this.ds.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [inv.workspace_id, userId, inv.role_id],
    );
    // Mark invite accepted
    await this.ds.query(
      `UPDATE workspace_invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
      [inviteId],
    );
    return { message: 'Berhasil bergabung ke workspace!' };
  }

  /** Reject a workspace invitation */
  async rejectInvite(inviteId: string, userId: string): Promise<{ message: string }> {
    const rows = await this.ds.query<{ email: string }[]>(
      `SELECT wi.id, u.email FROM workspace_invitations wi
       JOIN users u ON u.id = $2
       WHERE wi.id = $1 AND wi.email = u.email AND wi.status = 'pending'`,
      [inviteId, userId],
    );
    if (!rows.length) return { message: 'Undangan tidak ditemukan' };

    await this.ds.query(
      `UPDATE workspace_invitations SET status = 'declined' WHERE id = $1`,
      [inviteId],
    );
    return { message: 'Undangan telah ditolak.' };
  }
}
