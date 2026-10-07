import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, IsOptional, MinLength } from 'class-validator';

export class GoogleOAuthDto {
  @ApiProperty({ example: 'budi@gmail.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Budi Santoso' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ example: 'https://lh3.googleusercontent.com/...' })
  @IsOptional()
  @IsString()
  avatar?: string;
}
