import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsIn, IsInt, IsPositive,
  IsDateString, MaxLength, Min,
} from 'class-validator';

// ── Admin: create task template ───────────────────────────────────────────────

export class CreateAssignedTaskDto {
  @ApiProperty({ example: 'Buat Laporan Keuangan Bulan Ini' })
  @IsString() @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ example: 'Rekap semua pemasukan dan pengeluaran...' })
  @IsOptional() @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '📊' })
  @IsOptional() @IsString() @MaxLength(10)
  emoji?: string;

  @ApiPropertyOptional({ enum: ['boolean','count','amount','days'], default: 'boolean' })
  @IsOptional() @IsIn(['boolean','count','amount','days'])
  target_type?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @IsInt() @Min(1)
  target_value?: number;

  @ApiPropertyOptional({ example: 'Hari', description: 'Label satuan untuk count/days' })
  @IsOptional() @IsString() @MaxLength(50)
  unit_label?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional() @IsDateString()
  deadline?: string;

  @ApiPropertyOptional({ enum: ['low','normal','high','urgent'], default: 'normal' })
  @IsOptional() @IsIn(['low','normal','high','urgent'])
  priority?: string;
}

// ── Admin: assign task ke user ────────────────────────────────────────────────

export class AssignTaskDto {
  @ApiProperty({ description: 'UUID user yang akan di-assign' })
  @IsString()
  user_id: string;

  @ApiPropertyOptional({ example: 'Harap selesaikan sebelum akhir bulan!' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Override deadline task' })
  @IsOptional() @IsDateString()
  deadline?: string;
}

// ── Admin: assign task ke banyak user sekaligus ───────────────────────────────

export class BulkAssignTaskDto {
  @ApiProperty({ type: [String], example: ['uuid-user-1', 'uuid-user-2'] })
  @IsString({ each: true })
  user_ids: string[];

  @ApiPropertyOptional({ example: 'Task bulan Oktober untuk semua user' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional() @IsDateString()
  deadline?: string;
}

// ── User: update progress assignment ─────────────────────────────────────────

export class UpdateAssignmentProgressDto {
  @ApiProperty({ example: 3, description: 'Nilai progress terbaru (absolute, bukan increment)' })
  @IsInt() @Min(0)
  current_value: number;

  @ApiPropertyOptional({ example: 'Sudah selesai setengahnya' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}
