import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export type SubStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
export type BillingCycle = 'monthly' | 'yearly' | 'lifetime';

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // FK to users.id — relation object removed to avoid ESM circular-import issue
  // (emitDecoratorMetadata emits runtime class refs which break before-init cycles)
  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({ name: 'billing_cycle', type: 'varchar', default: 'monthly' })
  billingCycle: BillingCycle;

  @Column({ type: 'varchar', default: 'active' })
  status: SubStatus;

  @Column({ name: 'trial_ends_at', type: 'timestamp', nullable: true })
  trialEndsAt: Date | null;

  @Column({ name: 'current_period_start', type: 'timestamp' })
  currentPeriodStart: Date;

  @Column({ name: 'current_period_end', type: 'timestamp', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'payment_provider', type: 'varchar', nullable: true })
  paymentProvider: string | null;

  @Column({ name: 'provider_sub_id', type: 'varchar', nullable: true })
  providerSubId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
