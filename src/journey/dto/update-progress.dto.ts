import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

// ── Existing DTOs ─────────────────────────────────────────────────────────

export class UpdateTaskProgressDto {
  @ApiProperty({ example: 'catat_7hari', description: 'Task key dari journey_tasks' })
  @IsString()
  taskKey: string;

  @ApiProperty({ example: 3, minimum: 0 })
  @IsInt() @Min(0)
  currentValue: number;
}

export class UpdateStageStatusDto {
  @ApiProperty({ example: 'stability' })
  @IsString()
  stageKey: string;

  @ApiProperty({ enum: ['locked', 'active', 'completed'] })
  @IsIn(['locked', 'active', 'completed'])
  status: 'locked' | 'active' | 'completed';
}

// ── New DTOs ──────────────────────────────────────────────────────────────

/** POST /journey/stage — mulai stage (set active + started_at) */
export class StartStageDto {
  @ApiProperty({ example: 'saving', description: 'Stage key yang ingin dimulai' })
  @IsString()
  stageKey: string;
}

/** POST /journey/task — buat progress task dari nol / force set nilai */
export class CreateTaskProgressDto {
  @ApiProperty({ example: 'dana_darurat' })
  @IsString()
  taskKey: string;

  @ApiProperty({ example: 500000, minimum: 0 })
  @IsInt() @Min(0)
  currentValue: number;

  @ApiPropertyOptional({ example: 'in_progress', enum: ['pending','in_progress','completed'] })
  @IsOptional()
  @IsIn(['pending', 'in_progress', 'completed'])
  status?: 'pending' | 'in_progress' | 'completed';
}

/** DELETE /journey/task/:taskKey — reset / soft-delete progress task */
export class ResetTaskDto {
  @ApiProperty({ example: 'dana_darurat' })
  @IsString()
  taskKey: string;
}

/** DELETE /journey/stage/:stageKey — reset stage ke locked */
export class ResetStageDto {
  @ApiProperty({ example: 'saving' })
  @IsString()
  stageKey: string;
}
