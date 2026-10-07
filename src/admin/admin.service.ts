/**
 * AdminService
 *
 * Used by both /admin (role=admin|super_admin) endpoints.
 * Admins can:
 *   - List & search users
 *   - Enable / disable a user
 *   - Manually set a user's subscription plan
 *   - View a user's subscription + feature details
 *   - Write audit log entries
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, ILike } from 'typeorm';
import { User }         from '../users/user.entity.js';
import { Subscription } from '../subscriptions/subscription.entity.js';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    private readonly ds: DataSource,
  ) {}

  // ── Admin audit log ───────────────────────────────────────────────────────

  async log(
    adminId:    string,
    action:     string,
    targetType: string,
    targetId:   string | null,
    meta:       object,
    ip?:        string,
  ) {
    await this.ds.query(
      `INSERT INTO admin_logs (admin_id, action, target_type, target_id, meta, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [adminId, action, targetType, targetId, JSON.stringify(meta), ip ?? null],
    );
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async listUsers(opts: {
    page:    number;
    limit:   number;
    q?:      string;
    role?:   string;
    active?: string;
  }) {
    const qb = this.userRepo.createQueryBuilder('u');
    if (opts.q)      qb.andWhere('(LOWER(u.name) LIKE :q OR LOWER(u.email) LIKE :q)', { q: `%${opts.q.toLowerCase()}%` });
    if (opts.role)   qb.andWhere('u.role = :role', { role: opts.role });
    if (opts.active !== undefined) {
      qb.andWhere('u.is_active = :active', { active: opts.active === 'true' });
    }

    const total  = await qb.getCount();
    const users  = await qb
      .orderBy('u.created_at', 'DESC')
      .skip((opts.page - 1) * opts.limit)
      .take(opts.limit)
      .getMany();

    // Attach plan codes
    const userIds = users.map((u) => u.id);
    const plans: { user_id: string; plan_code: string }[] = userIds.length
      ? await this.ds.query(
          `SELECT user_id::text, plan_code FROM v_user_plan WHERE user_id = ANY($1::uuid[])`,
          [userIds],
        )
      : [];
    const planMap = new Map(plans.map((p) => [p.user_id, p.plan_code]));

    return {
      data: users.map((u) => this.serializeUser(u, planMap.get(u.id) ?? 'free')),
      total,
      page:       opts.page,
      totalPages: Math.ceil(total / opts.limit) || 1,
    };
  }

  async getUserDetail(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    const [planRows, features, sub] = await Promise.all([
      this.ds.query<{ plan_code: string }[]>(
        `SELECT plan_code FROM v_user_plan WHERE user_id = $1`, [userId],
      ),
      this.ds.query<{ feature_code: string }[]>(
        `SELECT feature_code FROM v_user_features WHERE user_id = $1`, [userId],
      ),
      this.subRepo.findOne({ where: { userId } }),
    ]);

    return {
      ...this.serializeUser(user, planRows[0]?.plan_code ?? 'free'),
      features:     features.map((f) => f.feature_code),
      subscription: sub,
    };
  }

  // ── Enable / Disable user ─────────────────────────────────────────────────

  async setUserActive(userId: string, active: boolean, adminId: string, ip?: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');
    if (user.role === 'super_admin') throw new BadRequestException('Tidak bisa menonaktifkan super_admin');

    await this.userRepo.update(userId, { isActive: active });
    await this.log(adminId, active ? 'user.enable' : 'user.disable', 'user', userId, { wasActive: user.isActive }, ip);
    return { message: `User ${active ? 'diaktifkan' : 'dinonaktifkan'}`, userId, isActive: active };
  }

  // ── Manual plan override ──────────────────────────────────────────────────

  async setUserPlan(
    userId:      string,
    planCode:    string,
    adminId:     string,
    opts: { billingCycle?: 'monthly' | 'yearly' | 'lifetime'; periodDays?: number; note?: string },
    ip?: string,
  ) {
    // Validate plan
    const planRows = await this.ds.query<{ id: string; code: string }[]>(
      `SELECT id, code FROM plans WHERE code = $1 AND is_active = true`, [planCode],
    );
    if (!planRows.length) throw new BadRequestException(`Plan '${planCode}' tidak ditemukan atau tidak aktif`);
    const plan = planRows[0];

    // Get or provision subscription
    let sub = await this.subRepo.findOne({ where: { userId } });
    const oldPlan = sub ? await this.ds.query<{ plan_code: string }[]>(
      `SELECT plan_code FROM v_user_plan WHERE user_id = $1`, [userId],
    ).then((r) => r[0]?.plan_code ?? 'free') : 'free';

    const billingCycle = opts.billingCycle ?? 'lifetime';
    const days         = opts.periodDays ?? (planCode === 'free' ? null : 365);
    const periodEnd    = days ? new Date(Date.now() + days * 86_400_000) : null;

    if (sub) {
      await this.subRepo.update(
        { userId },
        {
          planId:             plan.id,
          billingCycle,
          status:             'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd:   periodEnd,
          paymentProvider:    'manual_admin',
          providerSubId:      `admin_${adminId}_${Date.now()}`,
          cancelledAt:        null,
        },
      );
    } else {
      // Provision first
      await this.ds.query('CALL provision_new_user($1)', [userId]);
      await this.subRepo.update(
        { userId },
        { planId: plan.id, billingCycle, status: 'active', currentPeriodEnd: periodEnd, paymentProvider: 'manual_admin' },
      );
    }

    await this.log(adminId, 'subscription.plan_override', 'user', userId, {
      oldPlan, newPlan: planCode, billingCycle, periodDays: days, note: opts.note,
    }, ip);

    return {
      message:      `Plan user diubah ke ${planCode}`,
      userId,
      plan:         planCode,
      billingCycle,
      periodEnd:    periodEnd?.toISOString() ?? null,
    };
  }

  // ── Manual feature toggle (grant/revoke feature outside plan) ─────────────

  async toggleFeature(
    userId:    string,
    feature:   string,
    grant:     boolean,
    adminId:   string,
    ip?:       string,
  ) {
    // Verify feature exists
    const featureRows = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM features WHERE code = $1`, [feature],
    );
    if (!featureRows.length) throw new BadRequestException(`Feature '${feature}' tidak dikenali`);

    // We manage per-user feature overrides via usage_quotas table as a boolean flag
    // For simplicity: store in a dedicated user_feature_overrides pattern using quota table
    // or we use a JSON column in users. Best practice: separate table.
    // Here we use admin_logs as audit only and rely on plan for actual gating.
    // If you need per-user feature override: extend schema with user_feature_overrides table.

    await this.log(adminId, grant ? 'feature.grant' : 'feature.revoke', 'user', userId, { feature }, ip);

    return {
      message: `Feature '${feature}' ${grant ? 'diberikan ke' : 'dicabut dari'} user`,
      note:    'Feature override per-user memerlukan tabel user_feature_overrides. Saat ini hanya tercatat di audit log.',
    };
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  async getAuditLog(opts: { page: number; limit: number; adminId?: string; action?: string }) {
    const conditions: string[] = [];
    const params: unknown[]    = [];
    let i = 1;

    if (opts.adminId) { conditions.push(`al.admin_id = $${i++}`); params.push(opts.adminId); }
    if (opts.action)  { conditions.push(`al.action ILIKE $${i++}`); params.push(`%${opts.action}%`); }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (opts.page - 1) * opts.limit;

    const [logs, countRows] = await Promise.all([
      this.ds.query(
        `SELECT al.*, u.name AS admin_name, u.email AS admin_email
         FROM admin_logs al JOIN users u ON u.id = al.admin_id
         ${where}
         ORDER BY al.created_at DESC
         LIMIT $${i++} OFFSET $${i}`,
        [...params, opts.limit, offset],
      ),
      this.ds.query(`SELECT COUNT(*) FROM admin_logs al ${where}`, params),
    ]);

    return {
      data:       logs,
      total:      Number(countRows[0]?.count ?? 0),
      page:       opts.page,
      totalPages: Math.ceil(Number(countRows[0]?.count ?? 0) / opts.limit) || 1,
    };
  }

  // ── Helper ─────────────────────────────────────────────────────────────────

  private serializeUser(u: User, plan: string) {
    return {
      id:          u.id,
      name:        u.name,
      email:       u.email,
      phone:       u.phone,
      avatarUrl:   u.avatarUrl,
      role:        u.role,
      plan,
      isActive:    u.isActive,
      isVerified:  u.isVerified,
      lastLoginAt: u.lastLoginAt,
      createdAt:   u.createdAt,
    };
  }
}
