/**
 * JourneyService
 *
 * Stage & task definitions  → PostgreSQL (journey_stages, journey_tasks) — immutable master data
 * User progress             → Google Sheets (tab: journey_progress) — mutable per-user state
 *
 * Sheet row schema: id | userId | stageKey | taskKey | currentValue | status | completedAt | updatedAt
 * taskKey = '_stage'  → stage-level progress row
 * taskKey = <key>     → individual task progress row
 */
import { Injectable } from '@nestjs/common';
import { DataSource }  from 'typeorm';
import {
  UpdateTaskProgressDto,
  UpdateStageStatusDto,
  CreateTaskProgressDto,
  StartStageDto,
} from './dto/update-progress.dto.js';
import type { RecordProgressDto } from './dto/progress.dto.js';
import { JourneyProgressSheetsService } from './journey-progress-sheets.service.js';
import type { ProgressRow, JourneySheetCtx } from './journey-progress-sheets.service.js';

export type { JourneySheetCtx };

// ── DB interfaces (definitions only — never changes per user) ─────────────

interface DbStage {
  id: string; key: string; title: string; subtitle: string;
  emoji: string; sort_order: number; required_plan: string;
}

interface DbTask {
  id: string; stage_id: string; key: string; title: string;
  description: string; emoji: string; requirement: string;
  target_type: string; target_value: number;
  deadline_days: number | null; sort_order: number;
}

// ── Formatters ────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}jt`;
  if (n >= 1_000)     return `Rp ${Math.round(n / 1_000)}k`;
  return `Rp ${n}`;
}

function fmtM(n: number) {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `Rp ${Math.round(n / 1_000)}k`;
  return `Rp ${n}`;
}

function deadlineLabel(deadlineDays: number | null, startDate?: string | null): string {
  if (!deadlineDays || !startDate) return '-';
  const d = new Date(new Date(startDate).getTime() + deadlineDays * 86_400_000);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

@Injectable()
export class JourneyService {
  constructor(
    private readonly ds:       DataSource,
    private readonly progress: JourneyProgressSheetsService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════
  // GET full journey
  // ════════════════════════════════════════════════════════════════════════

  async getJourney(userId: string, ctx?: JourneySheetCtx) {
    // 1. Load stage & task definitions from DB (static master data)
    const [stages, tasks] = await Promise.all([
      this.ds.query<DbStage[]>(
        `SELECT id, key, title, subtitle, emoji, sort_order, required_plan
         FROM journey_stages ORDER BY sort_order ASC`,
      ),
      this.ds.query<DbTask[]>(
        `SELECT id, stage_id, key, title, description, emoji,
                requirement, target_type, target_value, deadline_days, sort_order
         FROM journey_tasks ORDER BY sort_order ASC`,
      ),
    ]);

    // 2. Load all user progress from Sheets (one read)
    const allProgress = await this.progress.getAll(userId, ctx);
    const stageProgMap = new Map<string, ProgressRow>();
    const taskProgMap  = new Map<string, ProgressRow>(); // key: stageKey::taskKey

    for (const p of allProgress) {
      if (p.taskKey === '_stage') {
        stageProgMap.set(p.stageKey, p);
      } else {
        taskProgMap.set(`${p.stageKey}::${p.taskKey}`, p);
      }
    }

    // 3. Build task index by stage
    const tasksByStage = new Map<string, DbTask[]>();
    for (const t of tasks) {
      if (!tasksByStage.has(t.stage_id)) tasksByStage.set(t.stage_id, []);
      tasksByStage.get(t.stage_id)!.push(t);
    }

    // 4. Default stage statuses (development: all open)
    const DEFAULT_STATUS: Record<string, string> = {
      survival:  'active',
      stability: 'active',
      saving:    'active',
      growth:    'active',
    };

    // 5. Build stage results
    const stageResults = stages.map((stage) => {
      const stageProg  = stageProgMap.get(stage.key);
      const stageTasks = tasksByStage.get(stage.id) ?? [];

      const taskItems = stageTasks.map((task) => {
        const tp      = taskProgMap.get(`${stage.key}::${task.key}`);
        const current = tp ? tp.currentValue : 0;
        const target  = Number(task.target_value);
        const percent = target > 0 ? Math.min(Math.round((current / target) * 100), 100) : 0;
        const tStatus = tp?.status ?? 'pending';

        let currentFormatted: string;
        let targetFormatted:  string;
        if (task.target_type === 'amount') {
          currentFormatted = fmt(current);
          targetFormatted  = fmt(target);
        } else if (task.target_type === 'days') {
          currentFormatted = `${current} hari`;
          targetFormatted  = `${target} hari`;
        } else if (task.target_type === 'count') {
          currentFormatted = `${current}x`;
          targetFormatted  = `${target}x`;
        } else {
          currentFormatted = tStatus === 'completed' ? 'Selesai ✓' : 'Belum';
          targetFormatted  = 'Selesai ✓';
        }

        return {
          key:              task.key,
          taskDbId:         task.id,
          emoji:            task.emoji,
          title:            task.title,
          description:      task.description,
          requirement:      task.requirement,
          targetType:       task.target_type,
          target,
          current,
          percent,
          status:           tStatus,
          currentFormatted,
          targetFormatted,
          deadline:         deadlineLabel(task.deadline_days, stageProg?.status === 'active' ? stageProg.updatedAt : null),
          href:             task.key === 'dana_darurat' ? '/journey/stability/dana-darurat' : null,
        };
      });

      // Auto-derive: all wajib done → stage completed
      const wajibTasks     = taskItems.filter((t) => t.requirement === 'wajib');
      const completedCount = wajibTasks.filter((t) => t.status === 'completed').length;
      const totalCount     = wajibTasks.length;
      const allWajibDone   = totalCount > 0 && completedCount === totalCount;

      let status: 'locked' | 'active' | 'completed';
      if (stageProg?.status === 'completed' || allWajibDone) {
        status = 'completed';
      } else {
        status = (stageProg?.status ?? DEFAULT_STATUS[stage.key] ?? 'locked') as
          'locked' | 'active' | 'completed';
      }

      const overallPercent = totalCount > 0
        ? Math.round((completedCount / totalCount) * 100)
        : (status === 'completed' ? 100 : 0);

      return {
        key: stage.key, stageDbId: stage.id,
        emoji: stage.emoji, title: stage.title,
        subtitle: stage.subtitle, requiredPlan: stage.required_plan,
        status, overallPercent, completedCount, totalCount,
        tasks: taskItems,
        href: stage.key === 'stability' ? '/journey/stability' : `/journey/${stage.key}`,
      };
    });

    // Auto-advance: completed stage → next stage becomes active
    for (let i = 0; i < stageResults.length - 1; i++) {
      if (stageResults[i].status === 'completed' && stageResults[i + 1].status === 'locked') {
        stageResults[i + 1] = { ...stageResults[i + 1], status: 'active' };
      }
    }

    return stageResults;
  }

  // ════════════════════════════════════════════════════════════════════════
  // CRUD helpers — delegate to Sheets
  // ════════════════════════════════════════════════════════════════════════

  async updateTaskProgress(userId: string, dto: UpdateTaskProgressDto, ctx?: JourneySheetCtx) {
    // Get task definition from DB to know target
    const taskRows = await this.ds.query<{ key: string; target_value: number; target_type: string; stage_key: string }[]>(
      `SELECT jt.key, jt.target_value, jt.target_type, js.key AS stage_key
       FROM journey_tasks jt JOIN journey_stages js ON js.id = jt.stage_id
       WHERE jt.key = $1`,
      [dto.taskKey],
    );
    if (!taskRows.length) return { message: 'Task tidak dikenali' };

    const task        = taskRows[0];
    const target      = Number(task.target_value);
    const isCompleted = dto.currentValue >= target;

    await this.progress.upsert({
      userId,
      userName:     ctx?.userName ?? '',
      stageKey:     task.stage_key,
      taskKey:      dto.taskKey,
      currentValue: dto.currentValue,
      status:       isCompleted ? 'completed' : 'in_progress',
      completedAt:  isCompleted ? new Date().toISOString() : '',
    }, ctx);

    return {
      message:   'Progress diperbarui',
      taskKey:   dto.taskKey,
      current:   dto.currentValue,
      target,
      completed: isCompleted,
    };
  }

  async updateStageStatus(userId: string, dto: UpdateStageStatusDto, ctx?: JourneySheetCtx) {
    // Verify stage exists
    const stageRows = await this.ds.query<{ key: string }[]>(
      `SELECT key FROM journey_stages WHERE key = $1`, [dto.stageKey],
    );
    if (!stageRows.length) return { message: 'Stage tidak dikenali' };

    await this.progress.upsert({
      userId,
      userName:     ctx?.userName ?? '',
      stageKey:     dto.stageKey,
      taskKey:      '_stage',
      currentValue: dto.status === 'completed' ? 1 : 0,
      status:       dto.status,
      completedAt:  dto.status === 'completed' ? new Date().toISOString() : '',
    }, ctx);

    return { message: `Stage ${dto.stageKey} → ${dto.status}` };
  }

  async startStage(userId: string, dto: StartStageDto, ctx?: JourneySheetCtx) {
    const stageRows = await this.ds.query<{ key: string }[]>(
      `SELECT key FROM journey_stages WHERE key = $1`, [dto.stageKey],
    );
    if (!stageRows.length) return { message: `Stage '${dto.stageKey}' tidak ditemukan` };

    // Only activate if currently locked — idempotent
    const existing  = await this.progress.getByStage(userId, dto.stageKey, ctx);
    const stageProg = existing.find((r) => r.taskKey === '_stage');

    if (!stageProg || stageProg.status === 'locked') {
      await this.progress.upsert({
        userId, stageKey: dto.stageKey, taskKey: '_stage',
        userName:     ctx?.userName ?? '',
        currentValue: 0, status: 'active',
        completedAt: '',
      }, ctx);
    }

    return { message: `Stage '${dto.stageKey}' dimulai`, stageKey: dto.stageKey, status: 'active' };
  }

  async createTaskProgress(userId: string, dto: CreateTaskProgressDto, ctx?: JourneySheetCtx) {
    const taskRows = await this.ds.query<{ key: string; target_value: number; stage_key: string }[]>(
      `SELECT jt.key, jt.target_value, js.key AS stage_key
       FROM journey_tasks jt JOIN journey_stages js ON js.id = jt.stage_id
       WHERE jt.key = $1`,
      [dto.taskKey],
    );
    if (!taskRows.length) return { message: `Task '${dto.taskKey}' tidak dikenali` };

    const task    = taskRows[0];
    const target  = Number(task.target_value);
    const auto    = dto.currentValue >= target ? 'completed' : 'in_progress';
    const status  = dto.status ?? (dto.currentValue === 0 ? 'pending' : auto);

    await this.progress.upsert({
      userId,
      userName:     ctx?.userName ?? '',
      stageKey:     task.stage_key,
      taskKey:      dto.taskKey,
      currentValue: dto.currentValue,
      status,
      completedAt:  status === 'completed' ? new Date().toISOString() : '',
    }, ctx);

    return {
      message:   'Task progress dibuat/diperbarui',
      taskKey:   dto.taskKey,
      current:   dto.currentValue,
      target,
      status,
      completed: status === 'completed',
    };
  }

  async resetTaskProgress(userId: string, taskKey: string, ctx?: JourneySheetCtx) {
    const taskRows = await this.ds.query<{ key: string; stage_key: string }[]>(
      `SELECT jt.key, js.key AS stage_key
       FROM journey_tasks jt JOIN journey_stages js ON js.id = jt.stage_id
       WHERE jt.key = $1`,
      [taskKey],
    );
    if (!taskRows.length) return { message: `Task '${taskKey}' tidak dikenali` };

    const { stage_key } = taskRows[0];
    await this.progress.resetTask(userId, stage_key, taskKey, ctx);

    return { message: `Progress task '${taskKey}' direset ke 0`, taskKey, affected: 1 };
  }

  async resetStageProgress(userId: string, stageKey: string, ctx?: JourneySheetCtx) {
    const stageRows = await this.ds.query<{ key: string }[]>(
      `SELECT key FROM journey_stages WHERE key = $1`, [stageKey],
    );
    if (!stageRows.length) return { message: `Stage '${stageKey}' tidak dikenali` };

    await this.progress.resetStage(userId, stageKey, ctx);

    return {
      message:       `Stage '${stageKey}' dan semua task-nya direset`,
      stageKey,
      stageAffected: 1,
      tasksReset:    1,
    };
  }

  // ── Getters ───────────────────────────────────────────────────────────

  async getStageByKey(userId: string, stageKey: string, ctx?: JourneySheetCtx) {
    const all   = await this.getJourney(userId, ctx);
    const stage = all.find((s) => s.key === stageKey);
    if (!stage) return { message: `Stage '${stageKey}' tidak ditemukan` };
    return stage;
  }

  async getStageTasksByKey(userId: string, stageKey: string, ctx?: JourneySheetCtx) {
    const all   = await this.getJourney(userId, ctx);
    const stage = all.find((s) => s.key === stageKey);
    if (!stage) return [];
    return {
      stageKey, title: stage.title, subtitle: stage.subtitle,
      emoji: stage.emoji, overallPercent: stage.overallPercent,
      completedCount: stage.completedCount, totalCount: stage.totalCount,
      status: stage.status, tasks: stage.tasks,
    };
  }

  async getTaskByKey(userId: string, stageKey: string, taskKey: string, ctx?: JourneySheetCtx) {
    const all   = await this.getJourney(userId, ctx);
    const stage = all.find((s) => s.key === stageKey);
    if (!stage) return { message: `Stage '${stageKey}' tidak ditemukan` };
    const task  = stage.tasks.find((t) => t.key === taskKey);
    if (!task)  return { message: `Task '${taskKey}' tidak ditemukan dalam stage '${stageKey}'` };
    return { ...task, stageKey, stageTitle: stage.title, stageEmoji: stage.emoji, stageStatus: stage.status };
  }

  // ════════════════════════════════════════════════════════════════════════
  // MULTI-ALLOCATION PROGRESS ENGINE
  // POST /journey/progress
  // Task progress → Sheets | Goal deposits → PostgreSQL (unchanged)
  // ════════════════════════════════════════════════════════════════════════

  async recordProgress(userId: string, dto: RecordProgressDto, ctx?: JourneySheetCtx) {
    const date         = dto.date ?? new Date().toISOString().slice(0, 10);
    const taskResults: object[] = [];
    const goalResults: object[] = [];
    const errors:      string[] = [];

    for (const alloc of dto.allocations) {

      // ── Journey task → Sheets ─────────────────────────────────────────
      if (alloc.target_type === 'journey_task') {
        if (!alloc.task_key) { errors.push('task_key wajib untuk target_type journey_task'); continue; }

        const taskRows = await this.ds.query<{ key: string; target_value: number; target_type: string; stage_key: string }[]>(
          `SELECT jt.key, jt.target_value, jt.target_type, js.key AS stage_key
           FROM journey_tasks jt JOIN journey_stages js ON js.id = jt.stage_id
           WHERE jt.key = $1`,
          [alloc.task_key],
        );
        if (!taskRows.length) { errors.push(`Task '${alloc.task_key}' tidak dikenali`); continue; }

        const task      = taskRows[0];
        const target    = Number(task.target_value);
        const addValue  = task.target_type === 'amount' ? alloc.amount : 1;

        // Get current progress from Sheets
        const existing    = await this.progress.getByStage(userId, task.stage_key, ctx);
        const existingRow = existing.find((r) => r.taskKey === alloc.task_key);
        const prev        = existingRow?.currentValue ?? 0;
        const newValue    = prev + addValue;
        const isCompleted = newValue >= target;

        await this.progress.upsert({
          userId,
          userName:     ctx?.userName ?? '',
          stageKey:     task.stage_key,
          taskKey:      alloc.task_key,
          currentValue: newValue,
          status:       isCompleted ? 'completed' : 'in_progress',
          completedAt:  isCompleted ? new Date().toISOString() : '',
        }, ctx);

        taskResults.push({
          task_key:      alloc.task_key,
          previous:      prev,
          current_value: newValue,
          target,
          percent:       Math.min(Math.round((newValue / target) * 100), 100),
          status:        isCompleted ? 'completed' : 'in_progress',
          completed:     isCompleted,
        });
      }

      // ── Goal deposit → PostgreSQL (unchanged) ─────────────────────────
      if (alloc.target_type === 'goal') {
        if (!alloc.goal_id) { errors.push('goal_id wajib untuk target_type goal'); continue; }

        const goalRows = await this.ds.query<{
          id: string; target_amount: number; collected: number; status: string; title: string;
        }[]>(
          `SELECT id, target_amount, collected, status, title
           FROM financial_goals WHERE id = $1 AND user_id = $2 AND status != 'deleted'`,
          [alloc.goal_id, userId],
        );
        if (!goalRows.length) { errors.push(`Goal '${alloc.goal_id}' tidak ditemukan`); continue; }

        const goal         = goalRows[0];
        const newCollected = Number(goal.collected) + alloc.amount;
        const isCompleted  = newCollected >= Number(goal.target_amount);

        await this.ds.query(
          `INSERT INTO goal_deposits (id, goal_id, user_id, amount, type, note, deposited_at, transaction_id)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NULL)`,
          [alloc.goal_id, userId, alloc.amount, alloc.deposit_type ?? 'manual', alloc.note ?? null, date],
        );

        await this.ds.query(
          `UPDATE financial_goals SET collected = $1, status = $2, updated_at = NOW() WHERE id = $3`,
          [newCollected, isCompleted ? 'completed' : goal.status, alloc.goal_id],
        );

        const unlocked = await this.ds.query<{ step: number; label: string; amount: number }[]>(
          `SELECT step, label, amount FROM goal_milestones
           WHERE goal_id = $1 AND is_reached = true AND reached_at >= NOW() - INTERVAL '3 seconds'`,
          [alloc.goal_id],
        );

        goalResults.push({
          goal_id:             alloc.goal_id,
          title:               goal.title,
          amount_deposited:    alloc.amount,
          new_collected:       newCollected,
          target_amount:       Number(goal.target_amount),
          percent:             Math.round((newCollected / Number(goal.target_amount)) * 100),
          is_completed:        isCompleted,
          milestones_unlocked: unlocked.map((m) => ({ step: m.step, label: m.label, amount: Number(m.amount) })),
        });
      }
    }

    return {
      success:      true,
      message:      'Progress journey dan goal berhasil diperbarui',
      date,
      description:  dto.description,
      total_amount: dto.amount,
      errors:       errors.length > 0 ? errors : undefined,
      data:         { tasks_updated: taskResults, goals_updated: goalResults },
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET /journey/stability/dana-darurat
  // Task progress from Sheets, goal data from PostgreSQL
  // ════════════════════════════════════════════════════════════════════════

  async getDanaDarurat(userId: string, ctx?: JourneySheetCtx) {
    // Task progress from Sheets
    const stageRows  = await this.progress.getByStage(userId, 'stability', ctx);
    const taskProg   = stageRows.find((r) => r.taskKey === 'dana_darurat');
    const taskCurrent = taskProg?.currentValue ?? 0;
    const taskTarget  = 3_500_000;
    const taskPercent = Math.round((taskCurrent / taskTarget) * 100);

    // Goal from PostgreSQL
    let goalData: object | null = null;
    const goalRows = await this.ds.query<{
      id: string; title: string; collected: number; target_amount: number;
      monthly_deposit: number; deadline: string | null; status: string;
    }[]>(
      `SELECT id, title, collected, target_amount, monthly_deposit, deadline, status
       FROM financial_goals
       WHERE user_id = $1 AND status IN ('active','completed')
         AND (title ILIKE '%darurat%' OR title ILIKE '%emergency%')
       ORDER BY created_at ASC LIMIT 1`,
      [userId],
    );

    if (goalRows.length) {
      const g          = goalRows[0];
      const collected  = Number(g.collected);
      const target     = Number(g.target_amount);
      const monthly    = Number(g.monthly_deposit);
      const remaining  = target - collected;
      const monthsLeft = monthly > 0 && remaining > 0 ? Math.ceil(remaining / monthly) : 0;

      const [milestones, deposits] = await Promise.all([
        this.ds.query<{ step: number; amount: number; label: string; is_reached: boolean; reached_at: string | null }[]>(
          `SELECT step, amount, label, is_reached, reached_at FROM goal_milestones WHERE goal_id = $1 ORDER BY step`,
          [g.id],
        ),
        this.ds.query<{ id: string; amount: number; type: string; note: string | null; deposited_at: string }[]>(
          `SELECT id, amount, type, note, deposited_at FROM goal_deposits WHERE goal_id = $1 ORDER BY deposited_at DESC LIMIT 20`,
          [g.id],
        ),
      ]);

      goalData = {
        goalId: g.id, title: g.title,
        collected, collectedFormatted: fmtM(collected),
        target,    targetFormatted:    fmtM(target),
        remaining, remainingFormatted: remaining < 0 ? `-${fmtM(Math.abs(remaining))}` : fmtM(remaining),
        percent: Math.round((collected / target) * 100),
        monthlyDeposit: monthly,
        monthlyDepositFormatted: monthly > 0 ? `${fmtM(monthly)} / bulan` : 'Belum diatur',
        deadline: g.deadline, projectionMonths: monthsLeft, status: g.status,
        milestones: milestones.map((m) => ({
          step: m.step, amount: Number(m.amount), label: m.label,
          percent: Math.round((Number(m.amount) / target) * 100),
          done: m.is_reached, reachedAt: m.reached_at,
        })),
        depositHistory: deposits.map((d) => ({
          id: d.id, type: d.type,
          label: d.type === 'auto' ? 'Transfer otomatis' : 'Setor manual',
          amount: Number(d.amount), formatted: `+${fmtM(Number(d.amount))}`,
          note: d.note, depositedAt: d.deposited_at,
        })),
      };
    }

    return {
      taskKey: 'dana_darurat', taskCurrent, taskTarget, taskPercent,
      taskStatus: taskProg?.status ?? 'pending', taskCompletedAt: taskProg?.completedAt ?? null,
      collected: taskCurrent, collectedFormatted: fmtM(taskCurrent),
      target: taskTarget,     targetFormatted:    fmtM(taskTarget),
      remaining: taskTarget - taskCurrent,
      remainingFormatted: fmtM(Math.max(0, taskTarget - taskCurrent)),
      percent: taskPercent,
      goal: goalData,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET /journey/overview
  // ════════════════════════════════════════════════════════════════════════

  async getOverview(userId: string, ctx?: JourneySheetCtx) {
    const stages = await this.getJourney(userId, ctx);

    const goals = await this.ds.query<{
      id: string; title: string; collected: number; target_amount: number;
      monthly_deposit: number; status: string; task_id: string | null;
    }[]>(
      `SELECT id, title, collected, target_amount, monthly_deposit, status, task_id
       FROM financial_goals WHERE user_id = $1 AND status IN ('active','completed')
       ORDER BY created_at ASC`,
      [userId],
    );

    const goalByTaskId = new Map(goals.map((g) => [g.task_id, g]));

    const enrichedStages = stages.map((stage) => ({
      ...stage,
      tasks: stage.tasks.map((task) => {
        const linkedGoal = goalByTaskId.get(task.taskDbId);
        return {
          ...task,
          linkedGoal: linkedGoal ? {
            goalId:             linkedGoal.id,
            title:              linkedGoal.title,
            collected:          Number(linkedGoal.collected),
            collectedFormatted: fmtM(Number(linkedGoal.collected)),
            targetAmount:       Number(linkedGoal.target_amount),
            targetFormatted:    fmtM(Number(linkedGoal.target_amount)),
            percent:            Math.round((Number(linkedGoal.collected) / Number(linkedGoal.target_amount)) * 100),
            status:             linkedGoal.status,
          } : null,
        };
      }),
    }));

    const totalSaved  = goals.reduce((s, g) => s + Number(g.collected), 0);
    const totalTarget = goals.reduce((s, g) => s + Number(g.target_amount), 0);

    return {
      stages: enrichedStages,
      goalsSummary: {
        totalGoals: goals.length,
        totalSaved, totalSavedFormatted: fmtM(totalSaved),
        totalTarget, totalTargetFormatted: fmtM(totalTarget),
        overallPercent: totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0,
        goals: goals.map((g) => ({
          id: g.id, title: g.title,
          percent: Math.round((Number(g.collected) / Number(g.target_amount)) * 100),
          status: g.status,
        })),
      },
    };
  }
}
