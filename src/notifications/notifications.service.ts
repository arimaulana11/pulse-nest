/**
 * NotificationsService
 *
 * Hybrid approach:
 *  - Workspace invitations → generated on-the-fly from workspace_invitations table
 *    AND persisted to notifications table so mark-as-read survives reloads
 *  - Other notifications (tips, journey, etc) → stored in notifications table
 *
 * Flow invite:
 *   1. Owner calls POST /workspaces/:id/invite
 *   2. WorkspacesService.invite() saves to workspace_invitations
 *   3. WorkspacesService.invite() calls NotificationsService.createInviteNotification()
 *   4. User opens /notifikasi → getForUser() merges DB notifications + live invite status
 *   5. User clicks Terima/Tolak → acceptInvite/rejectInvite → mark notif as read
 */
import { Injectable } from '@nestjs/common';
import { DataSource }  from 'typeorm';

export interface NotificationItem {
  id:           string;
  type:         'invite' | 'budget' | 'streak' | 'journey' | 'tip' | 'payment' | 'system';
  emoji:        string;
  title:        string;
  body:         string;
  isRead:       boolean;
  createdAt:    string;
  action?:      { label: string; href: string };
  inviteId?:    string;
  workspaceId?: string;
  actions?:     { type: 'accept' | 'reject'; label: string }[];
}

interface DbNotification {
  id: string; type: string; emoji: string; title: string; body: string;
  is_read: boolean; invite_id: string | null; workspace_id: string | null;
  action_label: string | null; action_href: string | null; created_at: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly ds: DataSource) {}

  // ── Get all notifications for a user ────────────────────────────────

  async getForUser(userId: string): Promise<{ unreadCount: number; notifications: NotificationItem[] }> {
    // 1. Load persisted notifications from DB
    const dbNotifs = await this.ds.query<DbNotification[]>(
      `SELECT id, type, emoji, title, body, is_read, invite_id,
              workspace_id, action_label, action_href, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    );

    // 2. Load pending invites that don't yet have a DB notification
    //    (e.g. invites created before this migration)
    const existingInviteIds = new Set(
      dbNotifs.filter((n) => n.invite_id).map((n) => n.invite_id!),
    );

    const liveInvites = await this.ds.query<{
      id: string; workspace_id: string; workspace_name: string;
      invited_by_name: string; role_label: string; created_at: string;
    }[]>(
      `SELECT wi.id, wi.workspace_id, w.name AS workspace_name,
              u.name AS invited_by_name, wr.label AS role_label, wi.created_at
       FROM workspace_invitations wi
       JOIN workspaces      w  ON w.id  = wi.workspace_id
       JOIN users           u  ON u.id  = wi.invited_by
       JOIN workspace_roles wr ON wr.id = wi.role_id
       WHERE wi.email = (SELECT email FROM users WHERE id = $1)
         AND wi.status = 'pending'
         AND wi.expires_at > NOW()
         AND wi.id != ALL($2::uuid[])
       ORDER BY wi.created_at DESC`,
      [userId, existingInviteIds.size > 0 ? [...existingInviteIds] : ['00000000-0000-0000-0000-000000000000']],
    );

    // Persist any live invites that don't have a DB record yet
    for (const inv of liveInvites) {
      await this.createInviteNotificationForUser(
        userId, inv.id, inv.workspace_id,
        inv.invited_by_name, inv.workspace_name, inv.role_label,
      );
    }

    // 3. Reload DB notifications (now includes newly inserted ones)
    const allNotifs = await this.ds.query<DbNotification[]>(
      `SELECT id, type, emoji, title, body, is_read, invite_id,
              workspace_id, action_label, action_href, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    );

    // 4. For invite notifications, check if invite is still pending
    //    (user may have accepted/rejected in another session)
    const pendingInviteIds = new Set(
      (await this.ds.query<{ id: string }[]>(
        `SELECT id FROM workspace_invitations
         WHERE email = (SELECT email FROM users WHERE id = $1)
           AND status = 'pending' AND expires_at > NOW()`,
        [userId],
      )).map((r) => r.id),
    );

    const notifications: NotificationItem[] = allNotifs.map((n) => {
      const item: NotificationItem = {
        id:          n.id,
        type:        n.type as NotificationItem['type'],
        emoji:       n.emoji,
        title:       n.title,
        body:        n.body,
        isRead:      n.is_read,
        createdAt:   n.created_at,
        inviteId:    n.invite_id ?? undefined,
        workspaceId: n.workspace_id ?? undefined,
      };

      if (n.action_label && n.action_href) {
        item.action = { label: n.action_label, href: n.action_href };
      }

      // Only show accept/reject buttons if invite is still pending
      if (n.type === 'invite' && n.invite_id && pendingInviteIds.has(n.invite_id)) {
        item.actions = [
          { type: 'accept', label: 'Terima' },
          { type: 'reject', label: 'Tolak'  },
        ];
      }

      return item;
    });

    const unreadCount = notifications.filter((n) => !n.isRead).length;
    return { unreadCount, notifications };
  }

  // ── Create invite notification (called from WorkspacesService) ───────

  async createInviteNotification(
    inviteeEmail:  string,
    inviteId:      string,
    workspaceId:   string,
    inviterName:   string,
    workspaceName: string,
    roleLabel:     string,
  ): Promise<void> {
    // Find the user ID for this email
    const rows = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM users WHERE email = $1`, [inviteeEmail],
    );
    if (!rows.length) return; // User not registered yet — skip

    await this.createInviteNotificationForUser(
      rows[0].id, inviteId, workspaceId, inviterName, workspaceName, roleLabel,
    );
  }

  private async createInviteNotificationForUser(
    userId:        string,
    inviteId:      string,
    workspaceId:   string,
    inviterName:   string,
    workspaceName: string,
    roleLabel:     string,
  ): Promise<void> {
    await this.ds.query(
      `INSERT INTO notifications
         (user_id, type, emoji, title, body, invite_id, workspace_id, is_read)
       VALUES ($1, 'invite', '👥', $2, $3, $4, $5, false)
       ON CONFLICT DO NOTHING`,
      [
        userId,
        'Undangan Workspace',
        `${inviterName} mengundang kamu bergabung ke workspace "${workspaceName}" sebagai ${roleLabel}.`,
        inviteId,
        workspaceId,
      ],
    );
  }

  // ── Mark notifications as read ────────────────────────────────────────

  async markRead(userId: string, ids?: string[]): Promise<{ updated: number }> {
    let result: [unknown, number];

    if (ids && ids.length > 0) {
      result = await this.ds.query(
        `UPDATE notifications
         SET is_read = true, read_at = NOW()
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_read = false`,
        [userId, ids],
      );
    } else {
      // Mark all as read
      result = await this.ds.query(
        `UPDATE notifications
         SET is_read = true, read_at = NOW()
         WHERE user_id = $1 AND is_read = false`,
        [userId],
      );
    }

    return { updated: result[1] ?? 0 };
  }

  // ── Accept invitation ─────────────────────────────────────────────────

  async acceptInvite(inviteId: string, userId: string): Promise<{ message: string }> {
    const rows = await this.ds.query<{ workspace_id: string; role_id: string; email: string }[]>(
      `SELECT workspace_id, role_id, email FROM workspace_invitations
       WHERE id = $1 AND status = 'pending' AND expires_at > NOW()`,
      [inviteId],
    );
    if (!rows.length) return { message: 'Undangan tidak ditemukan atau sudah kadaluarsa' };

    const inv     = rows[0];
    const userRow = await this.ds.query<{ email: string }[]>(
      `SELECT email FROM users WHERE id = $1`, [userId],
    );
    if (!userRow.length || userRow[0].email !== inv.email) {
      return { message: 'Undangan bukan untuk akun ini' };
    }

    await this.ds.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [inv.workspace_id, userId, inv.role_id],
    );
    await this.ds.query(
      `UPDATE workspace_invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
      [inviteId],
    );
    // Mark related notification as read
    await this.ds.query(
      `UPDATE notifications SET is_read = true, read_at = NOW()
       WHERE user_id = $1 AND invite_id = $2`,
      [userId, inviteId],
    );

    return { message: 'Berhasil bergabung ke workspace!' };
  }

  // ── Reject invitation ─────────────────────────────────────────────────

  async rejectInvite(inviteId: string, userId: string): Promise<{ message: string }> {
    const rows = await this.ds.query<{ email: string }[]>(
      `SELECT wi.id FROM workspace_invitations wi
       JOIN users u ON u.id = $2
       WHERE wi.id = $1 AND wi.email = u.email AND wi.status = 'pending'`,
      [inviteId, userId],
    );
    if (!rows.length) return { message: 'Undangan tidak ditemukan' };

    await this.ds.query(
      `UPDATE workspace_invitations SET status = 'declined' WHERE id = $1`,
      [inviteId],
    );
    await this.ds.query(
      `UPDATE notifications SET is_read = true, read_at = NOW()
       WHERE user_id = $1 AND invite_id = $2`,
      [userId, inviteId],
    );

    return { message: 'Undangan telah ditolak.' };
  }
}
