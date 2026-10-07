import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray, IsDateString, IsIn, IsInt, IsOptional,
  IsPositive, IsString, MaxLength, Min, ValidateNested, IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Single allocation item ─────────────────────────────────────────────────

export class AllocationDto {
  @ApiProperty({
    enum: ['journey_task', 'goal'],
    description: 'journey_task → update user_task_progress | goal → deposit ke financial_goals',
  })
  @IsIn(['journey_task', 'goal'])
  target_type: 'journey_task' | 'goal';

  @ApiPropertyOptional({ example: 'dana_darurat', description: 'Wajib jika target_type = journey_task' })
  @IsOptional() @IsString() @MaxLength(100)
  task_key?: string;

  @ApiPropertyOptional({ example: 'uuid-goal', description: 'Wajib jika target_type = goal' })
  @IsOptional() @IsString()
  goal_id?: string;

  @ApiPropertyOptional({ example: 'Liburan Akhir Tahun', description: 'Judul target keuangan (diperlukan saat auto-create goal)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ example: 5000000, description: 'Target nominal yang ingin dicapai' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  target_amount?: number;

  @ApiPropertyOptional({ example: '✈️', description: 'Emoji atau ikon target' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  emoji?: string;

  @ApiPropertyOptional({ example: 700000, description: 'Rencana setoran bulanan' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  monthly_deposit?: number;

  @ApiPropertyOptional({ example: '2026-12-01', description: 'Tenggat waktu pengumpulan (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiProperty({ example: 500000, description: 'Jumlah alokasi dalam IDR' })
  @IsInt() @IsPositive()
  amount: number;

  @ApiPropertyOptional({ example: 'manual', enum: ['manual','auto','rollover'] })
  @IsOptional() @IsIn(['manual','auto','rollover'])
  deposit_type?: 'manual' | 'auto' | 'rollover';

  @ApiPropertyOptional({ example: 'Setoran gaji September' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

// ── Main progress payload ──────────────────────────────────────────────────

export class RecordProgressDto {
  @ApiProperty({ example: 500000, description: 'Total amount transaksi ini' })
  @IsInt() @Min(0)
  amount: number;

  @ApiPropertyOptional({ example: 'Setoran Alokasi Bulanan' })
  @IsOptional() @IsString() @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ example: '2026-09-29', description: 'YYYY-MM-DD, default hari ini' })
  @IsOptional() @IsDateString()
  date?: string;

  @ApiProperty({
    type:        [AllocationDto],
    description: 'Array alokasi. Tiap item bisa ditujukan ke task journey atau goal.',
    example: [
      { target_type: 'journey_task', task_key: 'dana_darurat', amount: 500000 },
      { target_type: 'goal',         goal_id:  'uuid-goal',    amount: 500000 },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  allocations: AllocationDto[];
}
