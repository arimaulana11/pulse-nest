import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn,
} from 'typeorm';

export type CategoryType = 'income' | 'expense' | 'both';

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // NULL = system category, UUID = user custom category
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 10, default: '📦' })
  emoji: string;

  @Column({ length: 7, default: '#8C7B70' })
  color: string;

  @Column({ type: 'varchar', length: 10, default: 'expense' })
  type: CategoryType;

  @Column({ name: 'is_system', default: false })
  isSystem: boolean;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
  // Note: @OneToMany to Transaction removed — transactions live in Google Sheets,
  // not in the TypeORM entity graph.
}
