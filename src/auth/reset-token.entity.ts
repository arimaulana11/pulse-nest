import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('reset_tokens')
export class ResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // FK to users.id — relation object removed to avoid ESM circular-import
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** bcrypt hash of the 6-digit OTP sent via email */
  @Column({ name: 'token_hash', type: 'varchar', length: 255 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'boolean', default: false })
  used: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
