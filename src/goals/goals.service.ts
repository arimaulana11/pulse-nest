/**
 * GoalsService — PostgreSQL backend
 *
 * Tables: financial_goals, goal_deposits, goal_milestones
 * Milestones auto-created via DB trigger on INSERT.
 * Milestones auto-updated via DB trigger on collected UPDATE.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource }                     from 'typeorm';
import { CreateGoalDto, AddDepositDto }   from './dto/goal.dto.js';
import { randomUUID }                     from 'crypto';

function fmt(n: number) {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000)     return `Rp ${Math.round(n / 1_000)}k`;
  return `Rp ${n}`;
}

interface DbGoal {
  id: string; user_id: string; task_id: string | null;
  title: string; emoji: string;
  target_amount: number; collected: number; monthly_deposit: number;
  deadline: string | null; status: string;
  created_at: string; updated_at: string;
}

interface DbDeposit {
  id: string; goal_id: string; user_id: string;
  amount: number; type: string; note: string | null;
  deposited_at: string; created_at: string; transaction_id: string | null;
}

interface DbMilestone {
  id: string; goal_id: string; step: number;
  amount: number; label: string | null; is_reached: boolean; reached_at: string | null;
}

@Injectable()
export class GoalsService {
  constructor(private readonly ds: DataSource) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async findAll(userId: string) {
    const rows = await this.ds.query<DbGoal[]>(
      `SELECT * FROM financial_goals WHERE user_id = $1 AND status != 'deleted' ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(this.serialize);
  }

  async findOne(userId: string, id: string) {
    const rows = await this.ds.query<DbGoal[]>(
      `SELECT * FROM financial_goals WHERE id = $1 AND user_id = $2 AND status != 'deleted'`,
      [id, userId],
    );
    if (!rows.length) throw new NotFoundException('Goal tidak ditemukan');
    const goal = rows[0];

    const [milestones, deposits] = await Promise.all([
      this.ds.query<DbMilestone[]>(
        `SELECT * FROM goal_milestones WHERE goal_id = $1 ORDER BY step ASC`,
        [id],
      ),
      this.ds.query<DbDeposit[]>(
        `SELECT * FROM goal_deposits WHERE goal_id = $1 ORDER BY deposited_at DESC`,
        [id],
      ),
    ]);

    return {
      ...this.serialize(goal),
      milestones:     milestones.map((m) => ({
        step:      m.step,
        amount:    Number(m.amount),
        formatted: fmt(Number(m.amount)),
        label:     m.label,
        percent:   Math.round((Number(m.amount) / Number(goal.target_amount)) * 100),
        done:      m.is_reached,
        reachedAt: m.reached_at,
      })),
      depositHistory: deposits.map((d) => ({
        id:          d.id,
        type:        d.type,
        label:       d.type === 'auto' ? 'Transfer otomatis' : 'Setor manual',
        amount:      Number(d.amount),
        formatted:   `+${fmt(Number(d.amount))}`,
        note:        d.note,
        depositedAt: d.deposited_at,
        createdAt:   d.created_at,
        transactionId: d.transaction_id,
      })),
    };
  }

  async create(userId: string, dto: CreateGoalDto) {
    const id = randomUUID();
    await this.ds.query(
      `INSERT INTO financial_goals
         (id, user_id, title, emoji, target_amount, collected,
          monthly_deposit, deadline, status)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7,'active')`,
      [id, userId, dto.title, dto.emoji, dto.targetAmount,
       dto.monthlyDeposit ?? 0, dto.deadline ?? null],
    );
    return { message: 'Goal dibuat', id };
  }

  async remove(userId: string, id: string) {
    const rows = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM financial_goals WHERE id = $1 AND user_id = $2`, [id, userId],
    );
    if (!rows.length) throw new NotFoundException('Goal tidak ditemukan');
    await this.ds.query(
      `UPDATE financial_goals SET status = 'deleted' WHERE id = $1`, [id],
    );
    return { message: 'Goal dihapus' };
  }

  // ── Deposits ──────────────────────────────────────────────────────────────

  async getDeposits(userId: string, goalId: string) {
    const rows = await this.ds.query<DbDeposit[]>(
      `SELECT * FROM goal_deposits WHERE goal_id = $1 AND user_id = $2 ORDER BY deposited_at DESC`,
      [goalId, userId],
    );
    return rows.map((d) => ({
      id:          d.id,
      type:        d.type,
      label:       d.type === 'auto' ? 'Transfer otomatis' : 'Setor manual',
      amount:      Number(d.amount),
      formatted:   `+${fmt(Number(d.amount))}`,
      note:        d.note,
      depositedAt: d.deposited_at,
      createdAt:   d.created_at,
    }));
  }

  async addDeposit(userId: string, dto: AddDepositDto, transactionId?: string) {
    const goalRows = await this.ds.query<DbGoal[]>(
      `SELECT * FROM financial_goals WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [dto.goalId, userId],
    );
    if (!goalRows.length) throw new NotFoundException('Goal tidak ditemukan');
    const goal = goalRows[0];

    const depositId    = randomUUID();
    const newCollected = Number(goal.collected) + dto.amount;
    const isCompleted  = newCollected >= Number(goal.target_amount);

    // Insert deposit
    await this.ds.query(
      `INSERT INTO goal_deposits (id, goal_id, user_id, amount, type, note, deposited_at, transaction_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [depositId, dto.goalId, userId, dto.amount,
       dto.type ?? 'manual', dto.note ?? null,
       dto.depositedAt ?? new Date().toISOString().slice(0, 10),
       transactionId ?? null],
    );

    // Update collected (trigger will auto-update milestones)
    await this.ds.query(
      `UPDATE financial_goals
       SET collected = $1, status = $2, updated_at = NOW()
       WHERE id = $3`,
      [newCollected, isCompleted ? 'completed' : goal.status, dto.goalId],
    );

    // Fetch newly unlocked milestones
    const unlocked = await this.ds.query<DbMilestone[]>(
      `SELECT * FROM goal_milestones
       WHERE goal_id = $1 AND is_reached = true AND reached_at >= NOW() - INTERVAL '5 seconds'`,
      [dto.goalId],
    );

    return {
      message:            'Setoran berhasil ditambahkan',
      depositId,
      newCollected,
      newCollectedFormatted: fmt(newCollected),
      isCompleted,
      milestonesUnlocked: unlocked.map((m) => ({
        step: m.step, label: m.label, amount: Number(m.amount),
      })),
    };
  }

  // ── Serializer ────────────────────────────────────────────────────────────

  private serialize(r: DbGoal) {
    const target    = Number(r.target_amount);
    const collected = Number(r.collected);
    const remaining = target - collected;
    const percent   = target > 0 ? Math.round((collected / target) * 100) : 0;
    const monthly   = Number(r.monthly_deposit);
    const monthsLeft= monthly > 0 && remaining > 0
      ? Math.ceil(remaining / monthly) : 0;

    return {
      id:                      r.id,
      taskId:                  r.task_id,
      title:                   r.title,
      emoji:                   r.emoji,
      targetAmount:            target,
      targetFormatted:         fmt(target),
      collected,
      collectedFormatted:      fmt(collected),
      remaining,
      remainingFormatted:      remaining < 0 ? `-${fmt(Math.abs(remaining))}` : fmt(remaining),
      percent,
      monthlyDeposit:          monthly,
      monthlyDepositFormatted: monthly > 0 ? `${fmt(monthly)} / bulan` : 'Belum diatur',
      deadline:                r.deadline,
      projectionMonths:        monthsLeft,
      status:                  r.status as 'active' | 'completed' | 'paused',
      createdAt:               r.created_at,
    };
  }
}
