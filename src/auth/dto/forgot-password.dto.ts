import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MinLength, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'budi@example.com' })
  @IsEmail()
  email: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'budi@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6)
  otp: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'budi@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6)
  otp: string;

  @ApiProperty({ example: 'newPassword123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
