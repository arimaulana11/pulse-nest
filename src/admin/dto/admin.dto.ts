import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean, IsIn, IsInt, IsOptional, IsPositive,
  IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListUsersQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ example: 'budi' })
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['user', 'admin', 'super_admin'] })
  @IsOptional() @IsIn(['user', 'admin', 'super_admin'])
  role?: string;

  @ApiPropertyOptional({ description: 'true | false' })
  @IsOptional() @IsString()
  active?: string;
}

export class SetUserActiveDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  active: boolean;
}

export class SetUserPlanDto {
  @ApiProperty({ example: 'normal_plus', enum: ['free', 'normal_plus', 'vip'] })
  @IsIn(['free', 'normal_plus', 'vip'])
  planCode: string;

  @ApiPropertyOptional({ enum: ['monthly', 'yearly', 'lifetime'], default: 'lifetime' })
  @IsOptional() @IsIn(['monthly', 'yearly', 'lifetime'])
  billingCycle?: 'monthly' | 'yearly' | 'lifetime';

  @ApiPropertyOptional({ example: 365, description: 'Jumlah hari berlaku (null = selamanya)' })
  @IsOptional() @IsInt() @IsPositive()
  periodDays?: number;

  @ApiPropertyOptional({ example: 'Diberikan sebagai reward konten kreator' })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class ToggleFeatureDto {
  @ApiProperty({ example: 'insight_advanced' })
  @IsString() @MaxLength(80)
  feature: string;

  @ApiProperty({ example: true, description: 'true = grant, false = revoke' })
  @IsBoolean()
  grant: boolean;
}

export class AuditLogQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by admin UUID' })
  @IsOptional() @IsUUID()
  adminId?: string;

  @ApiPropertyOptional({ example: 'user.disable' })
  @IsOptional() @IsString()
  action?: string;
}
