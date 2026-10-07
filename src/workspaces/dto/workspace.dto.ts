import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsIn, IsOptional, MaxLength, MinLength, IsEmail, IsUrl,
} from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({ example: 'Keluarga Maulana' })
  @IsString() @MinLength(2) @MaxLength(150)
  name: string;

  @ApiProperty({ enum: ['personal', 'family', 'org'], example: 'family' })
  @IsIn(['personal', 'family', 'org'])
  type: 'personal' | 'family' | 'org';

  @ApiPropertyOptional({ example: '💼' })
  @IsOptional() @IsString() @MaxLength(10)
  emoji?: string;

  @ApiPropertyOptional({ example: 'Workspace untuk keuangan keluarga bersama' })
  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  // ── Google Sheet (required for family/org) ─────────────────────────────
  @ApiPropertyOptional({ example: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms' })
  @IsOptional() @IsString()
  sheetId?: string;

  @ApiPropertyOptional({ example: 'transactions' })
  @IsOptional() @IsString() @MaxLength(100)
  sheetTabTx?: string;

  @ApiPropertyOptional({ example: 'budget_positions' })
  @IsOptional() @IsString() @MaxLength(100)
  sheetTabBudget?: string;

  @ApiPropertyOptional({ example: 'journey_progress' })
  @IsOptional() @IsString() @MaxLength(100)
  sheetTabJourney?: string;

  @ApiPropertyOptional({ example: 'goals' })
  @IsOptional() @IsString() @MaxLength(100)
  sheetTabGoals?: string;

  @ApiPropertyOptional({ example: 'pulse@project.iam.gserviceaccount.com' })
  @IsOptional() @IsEmail()
  serviceAccountEmail?: string;
}

export class InviteMemberDto {
  @ApiProperty({ example: 'teman@gmail.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: ['admin', 'bendahara', 'viewer'], example: 'bendahara' })
  @IsIn(['admin', 'bendahara', 'viewer'])
  roleCode: string;
}

export class TestSheetDto {
  @ApiProperty({ example: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms' })
  @IsString()
  sheetId: string;

  @ApiPropertyOptional({ example: 'transactions' })
  @IsOptional() @IsString()
  tabName?: string;
}
