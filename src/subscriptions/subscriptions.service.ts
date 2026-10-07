import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository }              from '@nestjs/typeorm';
import { DataSource, Repository }        from 'typeorm';
import { Subscription }                  from './subscription.entity.js';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly repo: Repository<Subscription>,
    private readonly ds:   DataSource,
  ) {}

  /** Call the DB stored procedure to fully provision a brand-new user */
  async provisionNewUser(userId: string): Promise<void> {
    await this.ds.query('CALL provision_new_user($1)', [userId]);
  }

  async findByUser(userId: string): Promise<Subscription> {
    const sub = await this.repo.findOne({
      where: { userId },
    });
    if (!sub) throw new NotFoundException('Subscription tidak ditemukan');
    return sub;
  }

  /** Returns the plan code ('free' | 'normal_plus' | 'vip') for a user */
  async getPlanCode(userId: string): Promise<string> {
    const row = await this.ds.query<{ plan_code: string }[]>(
      `SELECT plan_code FROM v_user_plan WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    return row[0]?.plan_code ?? 'free';
  }

  /** Returns all feature codes enabled for a user */
  async listFeatures(userId: string): Promise<string[]> {
    const rows = await this.ds.query<{ feature_code: string }[]>(
      `SELECT feature_code FROM v_user_features WHERE user_id = $1`,
      [userId],
    );
    return rows.map((r) => r.feature_code);
  }

  /** Check whether a user has access to a specific feature */
  async hasFeature(userId: string, featureCode: string): Promise<boolean> {
    const rows = await this.ds.query<{ feature_code: string }[]>(
      `SELECT feature_code FROM v_user_features
       WHERE user_id = $1 AND feature_code = $2`,
      [userId, featureCode],
    );
    return rows.length > 0;
  }

  /** Upgrade a user's plan (called after successful payment) */
  async upgradePlan(
    userId:        string,
    planId:        string,
    billingCycle:  'monthly' | 'yearly',
    providerSubId: string,
    provider:      string,
  ): Promise<Subscription> {
    const periodEnd = billingCycle === 'yearly'
      ? new Date(Date.now() + 365 * 86_400_000)
      : new Date(Date.now() +  30 * 86_400_000);

    await this.repo.update(
      { userId },
      {
        planId,
        billingCycle,
        status:              'active',
        currentPeriodStart:  new Date(),
        currentPeriodEnd:    periodEnd,
        paymentProvider:     provider,
        providerSubId,
        cancelledAt:         null,
      },
    );
    return this.findByUser(userId);
  }

  /** Downgrade / cancel — revert to free at period end */
  async cancel(userId: string): Promise<void> {
    await this.repo.update({ userId }, {
      status:      'cancelled',
      cancelledAt: new Date(),
    });
  }
}
