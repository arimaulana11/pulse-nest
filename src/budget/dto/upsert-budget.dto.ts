import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsInt, IsPositive, IsOptional,
  IsUUID, Min, Max, MaxLength,
} from 'class-validator';

export class UpsertBudgetDto {
  @ApiProperty({ example: 'Makan & Minum' })
  @IsString()
  @MaxLength(100)
  label: string;

  @ApiProperty({ example: '🍳' })
  @IsString()
  @MaxLength(10)
  emoji: string;

  @ApiProperty({ example: '#B25329' })
  @IsString()
  @MaxLength(7)
  color: string;

  @ApiProperty({ example: 1500000, description: 'Allocated amount in IDR' })
  @IsInt()
  @IsPositive()
  allocated: number;

  @ApiProperty({ example: 9, minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ example: 2026, minimum: 2020 })
  @IsInt()
  @Min(2020)
  year: number;

  /**
   * UUID of the linked category from the `categories` table.
   * Spending from transactions with this categoryId is counted as "spent"
   * for this budget position.
   */
  @ApiProperty({
    example: '00000000-0000-0000-0000-000000000001',
    description: 'UUID kategori — pengeluaran di kategori ini akan dihitung sebagai realisasi pos',
  })
  @IsString()
  categoryId: string;

  /** Optional label override that the frontend may send — ignored by service */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryLabel?: string;
}
