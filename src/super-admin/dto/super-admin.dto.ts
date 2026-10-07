import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean, IsEmail, IsInt, IsOptional, IsPositive,
  IsString, MaxLength, Min, MinLength,
} from 'class-validator';

export class CreateAdminDto {
  @ApiProperty({ example: 'Admin Budi' })
  @IsString() @MinLength(2) @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'admin.budi@pulse.app' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Admin@1234', minLength: 8 })
  @IsString() @MinLength(8) @MaxLength(72)
  password: string;
}

export class UpdatePlanDto {
  @ApiPropertyOptional({ example: 'Normal Plus' })
  @IsOptional() @IsString() @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Paket lengkap untuk pengguna aktif' })
  @IsOptional() @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 29000 })
  @IsOptional() @IsInt() @Min(0)
  priceMonthly?: number;

  @ApiPropertyOptional({ example: 290000 })
  @IsOptional() @IsInt() @Min(0)
  priceYearly?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}

export class PlanFeatureDto {
  @ApiProperty({ example: 'insight_advanced' })
  @IsString() @MaxLength(80)
  featureCode: string;
}

export class CreateFeatureDto {
  @ApiProperty({ example: 'ai_insights', description: 'Unique code, snake_case' })
  @IsString() @MaxLength(80)
  code: string;

  @ApiProperty({ example: 'AI-powered financial insights' })
  @IsString() @MaxLength(150)
  label: string;

  @ApiPropertyOptional({ example: 'Advanced AI analysis of spending patterns' })
  @IsOptional() @IsString()
  description?: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPassword123!' })
  @IsString() @MinLength(8)
  currentPassword: string;

  @ApiProperty({ example: 'NewPassword456!', minLength: 8 })
  @IsString() @MinLength(8) @MaxLength(72)
  newPassword: string;
}
