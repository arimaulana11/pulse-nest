import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsInt, IsPositive, IsOptional,
  IsIn, MaxLength, Matches,
} from 'class-validator';

export class CreateGoalDto {
  @ApiProperty({ example: 'Dana Darurat 3 Bulan' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: '🎯' })
  @IsString()
  @MaxLength(10)
  emoji: string;

  @ApiProperty({ example: 10500000, description: 'Target amount in IDR' })
  @IsInt()
  @IsPositive()
  targetAmount: number;

  @ApiPropertyOptional({ example: 500000, description: 'Monthly deposit plan in IDR' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  monthlyDeposit?: number;

  @ApiPropertyOptional({ example: '2027-03-01', description: 'YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deadline?: string;
}

export class AddDepositDto {
  @ApiProperty({ example: 'uuid-of-goal' })
  @IsString()
  goalId: string;

  @ApiProperty({ example: 500000, description: 'Deposit amount in IDR' })
  @IsInt()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ enum: ['manual', 'auto', 'rollover'], default: 'manual' })
  @IsOptional()
  @IsIn(['manual', 'auto', 'rollover'])
  type?: 'manual' | 'auto' | 'rollover';

  @ApiPropertyOptional({ example: 'Gaji bulan September' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ example: '2026-09-24', description: 'YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  depositedAt?: string;
}
