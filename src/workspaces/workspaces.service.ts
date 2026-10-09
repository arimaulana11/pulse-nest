import {
  Injectable, NotFoundException, ForbiddenException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomBytes }            from 'crypto';
import { Workspace }              from './workspace.entity.js';
import { CreateWorkspaceDto, InviteMemberDto } from './dto/workspace.dto.js';
import { SheetsService }          from '../sheets/sheets.service.js';
import { NotificationsService }   from '../notifications/notifications.service.js';
import { EmailService }           from '../email/email.service.js';

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private readonly repo:   Repository<Workspace>,
    private readonly ds:     DataSource,
    private readonly sheets: SheetsService,
    private readonly notifs: NotificationsService,
    private readonly email:  EmailService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80);
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = this.slugify(base);
    let i    = 0;
    while (await this.repo.findOne({ where: { slug } })) {
      slug = `${this.slugify(base)}-${++i}`;
    }
    return slug;
  }

  // ── CRUD ───────────────────────────────────────────────────────────────

  async create(ownerId: string, dto: CreateWorkspaceDto): Promise<Workspace> {
    const slug = await this.uniqueSlug(dto.name);

    const ws = this.repo.create({
      name:                dto.name,
      slug,
      ownerId,
      type:                dto.type,
      emoji:               dto.emoji ?? '💼',
      description:         dto.description ?? null,
      sheetId:             dto.sheetId ?? null,
      sheetTabTx:          dto.sheetTabTx ?? 'transactions',
      sheetTabBudget:      dto.sheetTabBudget ?? 'budget_positions',
      sheetTabJourney:     dto.sheetTabJourney ?? 'journey_progress',
      sheetTabGoals:       dto.sheetTabGoals ?? 'goals',
      serviceAccountEmail: dto.serviceAccountEmail ?? null,
    });

    const saved = await this.repo.save(ws);

    // Add creator as owner member
    const ownerRole = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM workspace_roles WHERE code = 'owner' LIMIT 1`,
    );
    if (ownerRole[0]) {
      await this.ds.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [saved.id, ownerId, ownerRole[0].id],
      );
    }

    return saved;
  }

  async findAllForUser(userId: string): Promise<Workspace[]> {
    // Get workspaces where user is a member
    const rows = await this.ds.query<{ workspace_id: string }[]>(
      `SELECT workspace_id FROM workspace_members WHERE user_id = $1`,
      [userId],
    );
    if (!rows.length) return [];
    const ids = rows.map((r) => r.workspace_id);
    return this.repo
      .createQueryBuilder('ws')
      .where('ws.id IN (:...ids)', { ids })
      .andWhere('ws.is_active = true')
      .orderBy('ws.created_at', 'ASC')
      .getMany();
  }

  async findOne(workspaceId: string, userId: string): Promise<Workspace> {
    const ws = await this.repo.findOne({ where: { id: workspaceId, isActive: true } });
    if (!ws) throw new NotFoundException('Workspace tidak ditemukan');
    await this.assertMember(workspaceId, userId);
    return ws;
  }

  // ── Members ────────────────────────────────────────────────────────────

  async getMembers(workspaceId: string) {
    return this.ds.query(
      `SELECT * FROM v_workspace_members WHERE workspace_id = $1`,
      [workspaceId],
    );
  }

  async invite(workspaceId: string, inviterId: string, dto: InviteMemberDto) {
    await this.assertRole(workspaceId, inviterId, ['owner', 'admin']);

    const role = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM workspace_roles WHERE code = $1`,
      [dto.roleCode],
    );
    if (!role[0]) throw new NotFoundException('Role tidak ditemukan');

    // Revoke any existing pending invite for this email
    await this.ds.query(
      `UPDATE workspace_invitations
       SET status = 'expired'
       WHERE workspace_id = $1 AND email = $2 AND status = 'pending'`,
      [workspaceId, dto.email],
    );

    const token     = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 14 * 86_400_000); // 14 days

    const inviteRows = await this.ds.query<{ id: string }[]>(
      `INSERT INTO workspace_invitations
         (workspace_id, invited_by, email, role_id, token, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING id`,
      [workspaceId, inviterId, dto.email, role[0].id, token, expiresAt],
    );
    const inviteId = inviteRows[0]?.id;

    // Fetch names for notification
    const [wsRows, inviterRows, roleRows] = await Promise.all([
      this.ds.query<{ name: string }[]>(`SELECT name FROM workspaces WHERE id = $1`, [workspaceId]),
      this.ds.query<{ name: string }[]>(`SELECT name FROM users WHERE id = $1`, [inviterId]),
      this.ds.query<{ label: string }[]>(`SELECT label FROM workspace_roles WHERE code = $1`, [dto.roleCode]),
    ]);

    // Fire-and-forget: create persistent notification for invitee
    if (inviteId) {
      void this.notifs.createInviteNotification(
        dto.email, inviteId, workspaceId,
        inviterRows[0]?.name ?? 'Someone',
        wsRows[0]?.name     ?? 'Workspace',
        roleRows[0]?.label  ?? dto.roleCode,
      );

      // Fire-and-forget: send email to invitee
      void this.email.sendWorkspaceInvite({
        toEmail:       dto.email,
        inviterName:   inviterRows[0]?.name ?? 'Someone',
        workspaceName: wsRows[0]?.name     ?? 'Workspace',
        roleLabel:     roleRows[0]?.label  ?? dto.roleCode,
        inviteToken:   token,
        expiresAt,
      });
    }

    return { message: `Undangan dikirim ke ${dto.email}`, token };
  }

  async cancelInvite(workspaceId: string, inviteId: string, userId: string) {
    await this.assertRole(workspaceId, userId, ['owner', 'admin']);
    await this.ds.query(
      `UPDATE workspace_invitations
       SET status = 'expired'
       WHERE id = $1 AND workspace_id = $2 AND status = 'pending'`,
      [inviteId, workspaceId],
    );
    return { message: 'Undangan dibatalkan' };
  }

  async getPendingInvitations(workspaceId: string) {
    return this.ds.query(
      `SELECT * FROM v_workspace_invitations
       WHERE workspace_id = $1 AND status = 'pending'`,
      [workspaceId],
    );
  }

  // ── Google Sheet test ──────────────────────────────────────────────────

  async testSheet(sheetId: string, tabName = 'Sheet1'): Promise<{ ok: boolean; message: string }> {
    try {
      // Try reading the given tab — success means credentials + sheetId are correct
      await this.sheets.readAllWithId(sheetId, tabName);
      return { ok: true, message: 'Koneksi berhasil!' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found') || msg.includes('404')) {
        return { ok: false, message: 'Sheet atau tab tidak ditemukan. Pastikan Sheet ID benar dan sudah di-share ke service account.' };
      }
      if (msg.includes('403') || msg.includes('permission')) {
        return { ok: false, message: 'Akses ditolak. Share spreadsheet ke service account dengan role Editor.' };
      }
      return { ok: false, message: `Koneksi gagal: ${msg}` };
    }
  }

  // ── Guard helpers ──────────────────────────────────────────────────────

  async assertMember(workspaceId: string, userId: string): Promise<void> {
    const rows = await this.ds.query<unknown[]>(
      `SELECT 1 FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
    );
    if (!rows.length) throw new ForbiddenException('Kamu bukan anggota workspace ini');
  }

  async assertRole(workspaceId: string, userId: string, roles: string[]): Promise<void> {
    const rows = await this.ds.query<{ role_code: string }[]>(
      `SELECT wr.code AS role_code
       FROM workspace_members wm
       JOIN workspace_roles wr ON wr.id = wm.role_id
       WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
      [workspaceId, userId],
    );
    if (!rows.length || !roles.includes(rows[0].role_code)) {
      throw new ForbiddenException('Tidak memiliki izin untuk aksi ini');
    }
  }

  /** Get workspace context for a user — used by data services to pick the right Sheet */
  async getActiveContext(userId: string, workspaceId?: string) {
    if (!workspaceId || workspaceId === 'personal') {
      return null; // Use global env-based sheet
    }
    const ws = await this.findOne(workspaceId, userId);
    if (!ws.sheetId) return null; // workspace has no sheet configured — fall back to personal
    return ws;
  }
}
