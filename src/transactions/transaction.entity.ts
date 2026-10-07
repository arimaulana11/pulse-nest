import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';

export type TxType = 'income' | 'expense';
export type TxSource = 'app' | 'import' | 'auto';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'category_id' })
  categoryId: string;

  @Column({ type: 'varchar', length: 10 })
  type: TxType;

  /** Positive integer — IDR (rupiah), no cents */
  @Column({ type: 'bigint' })
  amount: number;

  @Column({ length: 255 })
  description: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 20, default: 'app' })
  source: TxSource;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
