import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CreateAssignedTaskDto,
  AssignTaskDto,
  BulkAssignTaskDto,
  UpdateAssignmentProgressDto,
} from './dto/assigned-task.dto.js';

interface DbTask {
  id: string; created_by: string; title: string; description: string | null;
  emoji: string; target_type: string; target_value: number; unit_label: string | null;
  deadline: string | null; priority: string; status: string;
  created_at: string; updated_at: string;
}

interface DbAssignment {
  id: string; task_id: string; user_id: string; assigned_by: string | null;
  current_value: number; status: string; note: string | null;
  deadline: string | null; completed_at: string | null; seen_at: string | null;
  created_at: string; updated_at: string;
  // joined fields
  title?: string; description?: string | null; emoji?: string;
  target_type?: string; target_value?: number; unit_label?: string | null;
  task_deadline?: string | null; priority?: string;
  assignee_name?: string; assignee_email?: string;
  assigner_name?: string;
}

function priorityLabel(p: string) {
  return { low: 'Rendah', normal: 'Normal', high: 'Tinggi', urgent: 'Mendesak' }[p] ?? p;
}

function fmt(n: number) {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `Rp ${Math.round(n / 1_000)}k`;
  return `Rp ${n}`;
}

@Injectable()
export class AssignedTasksService {
  constructor(private readonly ds: DataSource) {}

  // ════════════════════════════════════════════════════════════════════════
  // ADMIN — Task templates
  // ════════════════════════════════════════════════════════════════════════

  async adminCreateTask(adminId: string, dto: CreateAssignedTaskDto) {
    const rows = await this.ds.query<{ id: string }[]>(
      `INSERT INTO assigned_tasks
         (created_by, title, description, emoji, target_type, target_value, unit_label, deadline, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        adminId, dto.title, dto.description ?? null,
        dto.emoji ?? '📋', dto.target_type ?? 'boolean',
        dto.target_value ?? 1, dto.unit_label ?? null,
        dto.deadline ?? null, dto.priority ?? 'normal',
      ],
    );
    return { message: 'Task berhasil dibuat', taskId: rows[0].id };
  }

  async adminListTasks(adminId: string) {
    const tasks = await this.ds.query<(DbTask & {
      total_assigned: number; total_completed: number;
    })[]>(
      `SELECT at.*,
              COUNT(ata.id)::int                                           AS total_assigned,
              COUNT(ata.id) FILTER (WHERE ata.status = 'completed')::int  AS total_completed
       FROM assigned_tasks at
       LEFT JOIN assigned_task_assignments ata ON ata.task_id = at.id
       WHERE at.created_by = $1
       GROUP BY at.id
       ORDER BY at.created_at DESC`,
      [adminId],
    );
    return tasks.map((t) => this.formatTask(t));
  }

  async adminGetTask(taskId: string) {
    const rows = await this.ds.query<DbTask[]>(
      `SELECT * FROM assigned_tasks WHERE id = $1`, [taskId],
    );
    if (!rows.length) throw new NotFoundException(`Task '${taskId}' tidak ditemukan`);

    const assignments = await this.ds.query<DbAssignment[]>(
      `SELECT ata.*,
              u.name  AS assignee_name,
              u.email AS assignee_email,
              a.name  AS assigner_name
       FROM assigned_task_assignments ata
       JOIN users u ON u.id = ata.user_id
       LEFT JOIN users a ON a.id = ata.assigned_by
       WHERE ata.task_id = $1
       ORDER BY ata.created_at DESC`,
      [taskId],
    );

    return {
      ...this.formatTask(rows[0]),
      assignments: assignments.map((a) => this.formatAssignment(a, rows[0])),
    };
  }

  async adminUpdateTask(taskId: string, dto: Partial<CreateAssignedTaskDto>) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (dto.title       !== undefined) { fields.push(`title = $${i++}`);       values.push(dto.title); }
    if (dto.description !== undefined) { fields.push(`description = $${i++}`); values.push(dto.description); }
    if (dto.emoji       !== undefined) { fields.push(`emoji = $${i++}`);       values.push(dto.emoji); }
    if (dto.target_type !== undefined) { fields.push(`target_type = $${i++}`); values.push(dto.target_type); }
    if (dto.target_value !== undefined){ fields.push(`target_value = $${i++}`);values.push(dto.target_value); }
    if (dto.unit_label  !== undefined) { fields.push(`unit_label = $${i++}`);  values.push(dto.unit_label); }
    if (dto.deadline    !== undefined) { fields.push(`deadline = $${i++}`);    values.push(dto.deadline); }
    if (dto.priority    !== undefined) { fields.push(`priority = $${i++}`);    values.push(dto.priority); }

    if (!fields.length) return { message: 'Tidak ada perubahan' };

    values.push(taskId);
    await this.ds.query(
      `UPDATE assigned_tasks SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i}`,
      values,
    );
    return { message: 'Task diperbarui', taskId };
  }

  async adminArchiveTask(taskId: string) {
    await this.ds.query(
      `UPDATE assigned_tasks SET status = 'archived', updated_at = NOW() WHERE id = $1`,
      [taskId],
    );
    return { message: 'Task diarsipkan', taskId };
  }

  // ── Assign ke satu user ───────────────────────────────────────────────

  async adminAssignTask(taskId: string, adminId: string, dto: AssignTaskDto) {
    const task = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM assigned_tasks WHERE id = $1 AND status = 'active'`, [taskId],
    );
    if (!task.length) throw new NotFoundException(`Task '${taskId}' tidak ditemukan atau sudah diarsipkan`);

    await this.ds.query(
      `INSERT INTO assigned_task_assignments
         (task_id, user_id, assigned_by, note, deadline)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (task_id, user_id) DO UPDATE SET
         note       = EXCLUDED.note,
         deadline   = EXCLUDED.deadline,
         assigned_by = EXCLUDED.assigned_by,
         updated_at  = NOW()`,
      [taskId, dto.user_id, adminId, dto.note ?? null, dto.deadline ?? null],
    );
    return { message: `Task di-assign ke user ${dto.user_id}`, taskId, userId: dto.user_id };
  }

  // ── Bulk assign ke banyak user ────────────────────────────────────────

  async adminBulkAssign(taskId: string, adminId: string, dto: BulkAssignTaskDto) {
    const task = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM assigned_tasks WHERE id = $1 AND status = 'active'`, [taskId],
    );
    if (!task.length) throw new NotFoundException(`Task '${taskId}' tidak ditemukan`);

    let assigned = 0;
    for (const userId of dto.user_ids) {
      await this.ds.query(
        `INSERT INTO assigned_task_assignments
           (task_id, user_id, assigned_by, note, deadline)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (task_id, user_id) DO UPDATE SET
           note        = EXCLUDED.note,
           deadline    = EXCLUDED.deadline,
           assigned_by = EXCLUDED.assigned_by,
           updated_at   = NOW()`,
        [taskId, userId, adminId, dto.note ?? null, dto.deadline ?? null],
      );
      assigned++;
    }
    return { message: `Task di-assign ke ${assigned} user`, taskId, assigned };
  }

  // ── Unassign dari user ────────────────────────────────────────────────

  async adminUnassign(taskId: string, userId: string) {
    await this.ds.query(
      `DELETE FROM assigned_task_assignments WHERE task_id = $1 AND user_id = $2`,
      [taskId, userId],
    );
    return { message: 'Assignment dihapus', taskId, userId };
  }

  // ── Semua user yang bisa di-assign ────────────────────────────────────

  async adminListUsers() {
    return this.ds.query<{ id: string; name: string; email: string }[]>(
      `SELECT id, name, email FROM users
       WHERE email NOT LIKE '%superadmin%'
       ORDER BY name`,
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // USER — Inbox assignments
  // ════════════════════════════════════════════════════════════════════════

  async userGetInbox(userId: string) {
    const assignments = await this.ds.query<DbAssignment[]>(
      `SELECT ata.*,
              at.title, at.description, at.emoji,
              at.target_type, at.target_value, at.unit_label,
              at.deadline AS task_deadline, at.priority,
              a.name AS assigner_name
       FROM assigned_task_assignments ata
       JOIN assigned_tasks at ON at.id = ata.task_id
       LEFT JOIN users a ON a.id = ata.assigned_by
       WHERE ata.user_id = $1 AND at.status = 'active'
       ORDER BY
         CASE ata.status WHEN 'pending' THEN 1 WHEN 'in_progress' THEN 2
                         WHEN 'completed' THEN 3 ELSE 4 END,
         COALESCE(ata.deadline, at.deadline) ASC NULLS LAST`,
      [userId],
    );

    // Mark unseen as seen
    await this.ds.query(
      `UPDATE assigned_task_assignments
       SET seen_at = NOW()
       WHERE user_id = $1 AND seen_at IS NULL`,
      [userId],
    );

    const pending   = assignments.filter((a) => a.status !== 'completed' && a.status !== 'cancelled');
    const completed = assignments.filter((a) => a.status === 'completed');

    return {
      unreadCount: assignments.filter((a) => !a.seen_at).length,
      pendingCount: pending.length,
      assignments: assignments.map((a) => this.formatAssignment(a)),
    };
  }

  async userGetAssignment(userId: string, assignmentId: string) {
    const rows = await this.ds.query<DbAssignment[]>(
      `SELECT ata.*,
              at.title, at.description, at.emoji,
              at.target_type, at.target_value, at.unit_label,
              at.deadline AS task_deadline, at.priority,
              a.name AS assigner_name
       FROM assigned_task_assignments ata
       JOIN assigned_tasks at ON at.id = ata.task_id
       LEFT JOIN users a ON a.id = ata.assigned_by
       WHERE ata.id = $1 AND ata.user_id = $2`,
      [assignmentId, userId],
    );
    if (!rows.length) throw new NotFoundException('Assignment tidak ditemukan');
    return this.formatAssignment(rows[0]);
  }

  async userUpdateProgress(userId: string, assignmentId: string, dto: UpdateAssignmentProgressDto) {
    const rows = await this.ds.query<(DbAssignment & {
      target_type: string; target_value: number;
    })[]>(
      `SELECT ata.*, at.target_type, at.target_value
       FROM assigned_task_assignments ata
       JOIN assigned_tasks at ON at.id = ata.task_id
       WHERE ata.id = $1 AND ata.user_id = $2`,
      [assignmentId, userId],
    );
    if (!rows.length) throw new NotFoundException('Assignment tidak ditemukan');

    const assignment = rows[0];
    const target     = Number(assignment.target_value);
    const newValue   = dto.current_value;
    const isCompleted = newValue >= target;
    const newStatus  = isCompleted ? 'completed'
      : newValue > 0 ? 'in_progress' : 'pending';

    await this.ds.query(
      `UPDATE assigned_task_assignments
       SET current_value = $1,
           status        = $2,
           note          = COALESCE($3, note),
           completed_at  = $4,
           updated_at    = NOW()
       WHERE id = $5`,
      [newValue, newStatus, dto.note ?? null,
       isCompleted ? new Date() : null, assignmentId],
    );

    return {
      message:    isCompleted ? 'Task selesai! 🎉' : 'Progress diperbarui',
      assignmentId,
      current:    newValue,
      target,
      percent:    Math.min(Math.round((newValue / target) * 100), 100),
      status:     newStatus,
      completed:  isCompleted,
    };
  }

  // ── Unread count saja (untuk badge di navbar) ─────────────────────────

  async userUnreadCount(userId: string) {
    const rows = await this.ds.query<{ count: string }[]>(
      `SELECT COUNT(*)::int AS count
       FROM assigned_task_assignments ata
       JOIN assigned_tasks at ON at.id = ata.task_id
       WHERE ata.user_id = $1 AND ata.seen_at IS NULL AND at.status = 'active'`,
      [userId],
    );
    return { unreadCount: Number(rows[0]?.count ?? 0) };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Formatters
  // ════════════════════════════════════════════════════════════════════════

  private formatTask(t: DbTask & { total_assigned?: number; total_completed?: number }) {
    return {
      id:            t.id,
      title:         t.title,
      description:   t.description,
      emoji:         t.emoji,
      targetType:    t.target_type,
      targetValue:   Number(t.target_value),
      targetFormatted: this.fmtTarget(t.target_type, Number(t.target_value), t.unit_label),
      unitLabel:     t.unit_label,
      deadline:      t.deadline,
      priority:      t.priority,
      priorityLabel: priorityLabel(t.priority),
      status:        t.status,
      totalAssigned: t.total_assigned ?? 0,
      totalCompleted:t.total_completed ?? 0,
      createdAt:     t.created_at,
    };
  }

  private formatAssignment(a: DbAssignment, task?: DbTask) {
    const targetType  = a.target_type  ?? task?.target_type  ?? 'boolean';
    const targetValue = Number(a.target_value  ?? task?.target_value  ?? 1);
    const current     = Number(a.current_value);
    const percent     = targetValue > 0 ? Math.min(Math.round((current / targetValue) * 100), 100) : 0;
    const deadline    = a.deadline ?? a.task_deadline ?? null;

    return {
      id:              a.id,
      taskId:          a.task_id,
      title:           a.title         ?? task?.title         ?? '',
      description:     a.description   ?? task?.description   ?? null,
      emoji:           a.emoji         ?? task?.emoji         ?? '📋',
      targetType,
      targetValue,
      targetFormatted: this.fmtTarget(targetType, targetValue, a.unit_label ?? task?.unit_label),
      unitLabel:       a.unit_label    ?? task?.unit_label    ?? null,
      priority:        a.priority      ?? task?.priority      ?? 'normal',
      priorityLabel:   priorityLabel(a.priority ?? task?.priority ?? 'normal'),
      current,
      currentFormatted:this.fmtCurrent(targetType, current, a.unit_label ?? task?.unit_label),
      percent,
      status:          a.status,
      note:            a.note,
      deadline,
      assignerName:    a.assigner_name ?? null,
      assigneeName:    a.assignee_name ?? null,
      assigneeEmail:   a.assignee_email ?? null,
      completedAt:     a.completed_at,
      seenAt:          a.seen_at,
      createdAt:       a.created_at,
    };
  }

  private fmtTarget(type: string, value: number, unit?: string | null): string {
    if (type === 'amount') return fmt(value);
    if (type === 'days')   return `${value} Hari`;
    if (type === 'count')  return `${value}× ${unit ?? ''}`.trim();
    return 'Selesaikan';
  }

  private fmtCurrent(type: string, value: number, unit?: string | null): string {
    if (value === 0) return type === 'boolean' ? 'Belum' : '0';
    if (type === 'amount') return fmt(value);
    if (type === 'days')   return `${value} Hari`;
    if (type === 'count')  return `${value}× ${unit ?? ''}`.trim();
    return value >= 1 ? 'Selesai ✓' : 'Belum';
  }
}
