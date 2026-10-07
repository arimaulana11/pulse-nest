import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export type WorkspaceType = 'personal' | 'family' | 'org';

@Entity('workspaces')
export class Workspace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 80, unique: true })
  slug: string;

  @Column({ name: 'logo_url', type: 'varchar', nullable: true })
  logoUrl: string | null;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 20, default: 'personal' })
  type: WorkspaceType;

  @Column({ type: 'varchar', length: 10, default: '💼' })
  emoji: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // ── Google Sheet integration ───────────────────────────────────────────
  @Column({ name: 'sheet_id', type: 'varchar', nullable: true })
  sheetId: string | null;

  @Column({ name: 'sheet_tab_tx', type: 'varchar', default: 'transactions' })
  sheetTabTx: string;

  @Column({ name: 'sheet_tab_budget', type: 'varchar', default: 'budget_positions' })
  sheetTabBudget: string;

  @Column({ name: 'sheet_tab_journey', type: 'varchar', default: 'journey_progress' })
  sheetTabJourney: string;

  @Column({ name: 'sheet_tab_goals', type: 'varchar', default: 'goals' })
  sheetTabGoals: string;

  @Column({ name: 'service_account_email', type: 'varchar', nullable: true })
  serviceAccountEmail: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
