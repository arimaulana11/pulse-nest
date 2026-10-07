import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn, IsInt, IsPositive, IsString, IsOptional,
  MinLength, MaxLength, Matches,
} from 'class-validator';

export class CreateTransactionDto {
  @ApiProperty({ enum: ['income', 'expense'], example: 'expense' })
  @IsIn(['income', 'expense'])
  type: 'income' | 'expense';

  @ApiProperty({ example: 50000, description: 'Amount in IDR (positive integer)' })
  @IsInt()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 'Makan siang di warteg' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description: string;

  @ApiProperty({ example: '00000000-0000-0000-0000-000000000001', description: 'Category UUID' })
  @IsString()
  categoryId: string;

  @ApiProperty({ example: 'Makan & Minum' })
  @IsString()
  categoryLabel: string;

  @ApiProperty({ example: '🍳' })
  @IsString()
  @MaxLength(10)
  categoryEmoji: string;

  @ApiPropertyOptional({ example: 'Pakai promo GoFood' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ example: '2026-09-24', description: 'YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}
