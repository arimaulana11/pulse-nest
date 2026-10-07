/**
 * SuperAdminService
 *
 * Only accessible by role=super_admin.
 * Capabilities:
 *   - Manage admin accounts (promote/demote)
 *   - CRUD plans (pricing, active status)
 *   - Manage plan features (add/remove feature from plan)
 *   - System stats dashboard
 *   - Change own password
 */
import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User }          from '../users/user.entity.js';
import * as bcrypt       from 'bcryptjs';

@Injectable()
export class SuperAdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly ds: DataSource,
  ) {}

  // ── Admin management ───────────────────────────────────────────────────────

  async listAdmins() {
    return this.userRepo.find({
      where: [{ role: 'admin' as const }, { role: 'super_admin' as const }],
      order: { createdAt: 'DESC' },
    }).then((users) => users.map((u) => ({
      id:          u.id,
      name:        u.name,
      email:       u.email,
      role:        u.role,
      isActive:    u.isActive,
      lastLoginAt: u.lastLoginAt,
      createdAt:   u.createdAt,
    })));
  }

  async promoteToAdmin(userId: string, superAdminId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');
    if (user.role === 'super_admin') throw new BadRequestException('Tidak bisa mengubah role super_admin');
    if (user.role === 'admin') throw new ConflictException('User sudah menjadi admin');

    await this.userRepo.update(userId, { role: 'admin' });
    await this.logAction(superAdminId, 'admin.promote', userId, { from: 'user', to: 'admin' });
    return { message: `${user.name} dipromosikan menjadi admin`, userId };
  }

  async demoteFromAdmin(userId: string, superAdminId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');
    if (user.role === 'super_admin') throw new BadRequestException('Tidak bisa menurunkan role super_admin');
    if (user.role === 'user') throw new ConflictException('User bukan admin');

    await this.userRepo.update(userId, { role: 'user' });
    await this.logAction(superAdminId, 'admin.demote', userId, { from: 'admin', to: 'user' });
    return { message: `${user.name} diturunkan dari admin`, userId };
  }

  async createAdmin(data: { name: string; email: string; password: string }, superAdminId: string) {
    const exists = await this.userRepo.findOne({ where: { email: data.email.toLowerCase() } });
    if (exists) throw new ConflictException('Email sudah terdaftar');

    const passwordHash = await bcrypt.hash(data.password, 12);
    const result = await this.userRepo
      .createQueryBuilder()
      .insert()
      .into(User)
      .values({
        name:         data.name.trim(),
        email:        data.email.toLowerCase().trim(),
        passwordHash,
        role:         'admin',
        isActive:     true,
        isVerified:   true,
      })
      .returning('*')
      .execute();

    const newUser = result.generatedMaps[0] as User;
    await this.logAction(superAdminId, 'admin.create', newUser.id, { email: data.email });
    return {
      message: 'Admin berhasil dibuat',
      admin: { id: newUser.id, name: newUser.name, email: newUser.email, role: 'admin' },
    };
  }

  // ── Plans management ───────────────────────────────────────────────────────

  async listPlans() {
    return this.ds.query(
      `SELECT p.*,
              COUNT(pf.feature_id) AS feature_count,
              COUNT(DISTINCT s.user_id) FILTER (WHERE s.status = 'active') AS active_subscribers
       FROM plans p
       LEFT JOIN plan_features pf ON pf.plan_id = p.id
       LEFT JOIN subscriptions s ON s.plan_id = p.id
       GROUP BY p.id
       ORDER BY p.sort_order ASC`,
    );
  }

  async updatePlan(
    planId:      string,
    data: {
      name?:          string;
      description?:   string;
      priceMonthly?:  number;
      priceYearly?:   number;
      isActive?:      boolean;
      sortOrder?:     number;
    },
    superAdminId: string,
  ) {
    const planRows = await this.ds.query<{ id: string; code: string }[]>(
      `SELECT id, code FROM plans WHERE id = $1`, [planId],
    );
    if (!planRows.length) throw new NotFoundException('Plan tidak ditemukan');

    const setClauses: string[] = [];
    const params: unknown[]    = [];
    let i = 1;

    if (data.name          !== undefined) { setClauses.push(`name = $${i++}`);           params.push(data.name); }
    if (data.description   !== undefined) { setClauses.push(`description = $${i++}`);    params.push(data.description); }
    if (data.priceMonthly  !== undefined) { setClauses.push(`price_monthly = $${i++}`);  params.push(data.priceMonthly); }
    if (data.priceYearly   !== undefined) { setClauses.push(`price_yearly = $${i++}`);   params.push(data.priceYearly); }
    if (data.isActive      !== undefined) { setClauses.push(`is_active = $${i++}`);      params.push(data.isActive); }
    if (data.sortOrder     !== undefined) { setClauses.push(`sort_order = $${i++}`);     params.push(data.sortOrder); }

    if (!setClauses.length) return { message: 'Tidak ada perubahan' };

    setClauses.push(`updated_at = NOW()`);
    params.push(planId);
    await this.ds.query(
      `UPDATE plans SET ${setClauses.join(', ')} WHERE id = $${i}`,
      params,
    );

    await this.logAction(superAdminId, 'plan.update', planId, data);
    return { message: `Plan ${planRows[0].code} diperbarui`, planId };
  }

  // ── Plan features management ───────────────────────────────────────────────

  async getPlanFeatures(planId: string) {
    const rows = await this.ds.query(
      `SELECT f.id, f.code, f.label, f.description,
              CASE WHEN pf.plan_id IS NOT NULL THEN true ELSE false END AS included
       FROM features f
       LEFT JOIN plan_features pf ON pf.feature_id = f.id AND pf.plan_id = $1
       ORDER BY f.code`,
      [planId],
    );
    return rows;
  }

  async addFeatureToPlan(planId: string, featureCode: string, superAdminId: string) {
    const featureRows = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM features WHERE code = $1`, [featureCode],
    );
    if (!featureRows.length) throw new NotFoundException(`Feature '${featureCode}' tidak ditemukan`);

    await this.ds.query(
      `INSERT INTO plan_features (plan_id, feature_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [planId, featureRows[0].id],
    );
    await this.logAction(superAdminId, 'plan_feature.add', planId, { featureCode });
    return { message: `Feature '${featureCode}' ditambahkan ke plan`, planId, featureCode };
  }

  async removeFeatureFromPlan(planId: string, featureCode: string, superAdminId: string) {
    const featureRows = await this.ds.query<{ id: string }[]>(
      `SELECT id FROM features WHERE code = $1`, [featureCode],
    );
    if (!featureRows.length) throw new NotFoundException(`Feature '${featureCode}' tidak ditemukan`);

    await this.ds.query(
      `DELETE FROM plan_features WHERE plan_id = $1 AND feature_id = $2`,
      [planId, featureRows[0].id],
    );
    await this.logAction(superAdminId, 'plan_feature.remove', planId, { featureCode });
    return { message: `Feature '${featureCode}' dihapus dari plan`, planId, featureCode };
  }

  // ── Features master list ───────────────────────────────────────────────────

  async listFeatures() {
    return this.ds.query(
      `SELECT f.*, COUNT(pf.plan_id) AS plan_count
       FROM features f LEFT JOIN plan_features pf ON pf.feature_id = f.id
       GROUP BY f.id ORDER BY f.code`,
    );
  }

  async createFeature(data: { code: string; label: string; description?: string }, superAdminId: string) {
    const existing = await this.ds.query(`SELECT id FROM features WHERE code = $1`, [data.code]);
    if (existing.length) throw new ConflictException(`Feature code '${data.code}' sudah ada`);

    const rows = await this.ds.query<{ id: string }[]>(
      `INSERT INTO features (code, label, description) VALUES ($1, $2, $3) RETURNING id`,
      [data.code, data.label, data.description ?? null],
    );
    await this.logAction(superAdminId, 'feature.create', rows[0].id, data);
    return { message: 'Feature dibuat', featureId: rows[0].id, ...data };
  }

  // ── System stats ───────────────────────────────────────────────────────────

  async getStats() {
    const [userStats, planStats, recentLogs] = await Promise.all([
      this.ds.query(`
        SELECT
          COUNT(*) FILTER (WHERE is_active = true)  AS total_active,
          COUNT(*) FILTER (WHERE is_active = false) AS total_inactive,
          COUNT(*) FILTER (WHERE role = 'admin')    AS total_admins,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_last_30d
        FROM users WHERE role = 'user'
      `),
      this.ds.query(`
        SELECT p.code, p.name,
               COUNT(s.user_id) FILTER (WHERE s.status = 'active')    AS active,
               COUNT(s.user_id) FILTER (WHERE s.status = 'cancelled') AS cancelled
        FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id
        GROUP BY p.id ORDER BY p.sort_order
      `),
      this.ds.query(`
        SELECT al.action, al.created_at, al.meta, u.name AS admin_name, u.email AS admin_email
        FROM admin_logs al JOIN users u ON u.id = al.admin_id
        ORDER BY al.created_at DESC LIMIT 10
      `),
    ]);

    return {
      users:      userStats[0],
      plans:      planStats,
      recentLogs,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Change super admin password ────────────────────────────────────────────

  async changePassword(superAdminId: string, currentPassword: string, newPassword: string) {
    const user = await this.userRepo.findOne({ where: { id: superAdminId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Password lama tidak cocok');

    if (newPassword.length < 8) throw new BadRequestException('Password baru minimal 8 karakter');

    const hash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.update(superAdminId, { passwordHash: hash });
    await this.logAction(superAdminId, 'super_admin.password_change', superAdminId, {});
    return { message: 'Password berhasil diubah' };
  }

  // ── Helper ─────────────────────────────────────────────────────────────────

  private async logAction(adminId: string, action: string, targetId: string, meta: object) {
    await this.ds.query(
      `INSERT INTO admin_logs (admin_id, action, target_type, target_id, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, action, action.split('.')[0], targetId, JSON.stringify(meta)],
    );
  }
}
