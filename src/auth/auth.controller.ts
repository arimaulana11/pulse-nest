import {
  Controller, Post, Get, Patch, Body, Request, HttpCode,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiCreatedResponse,
  ApiUnauthorizedResponse, ApiConflictResponse,
  ApiBadRequestResponse, ApiBody, ApiProperty,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsPhoneNumber } from 'class-validator';

class UpdateMeDto {
  @ApiProperty({ example: 'Budi Santoso', required: false })
  @IsOptional() @IsString() @MaxLength(100)
  name?: string;

  @ApiProperty({ example: '+6281234567890', required: false, nullable: true })
  @IsOptional() @IsString() @MaxLength(20)
  phone?: string | null;

  @ApiProperty({ example: 'id', required: false })
  @IsOptional() @IsString() @MaxLength(10)
  locale?: string;

  @ApiProperty({ example: 'Asia/Jakarta', required: false })
  @IsOptional() @IsString() @MaxLength(50)
  timezone?: string;
}
import { AuthService }     from './auth.service.js';
import { Public }          from './public.decorator.js';
import { RegisterDto }     from './dto/register.dto.js';
import { LoginDto }        from './dto/login.dto.js';
import { GoogleOAuthDto }  from './dto/google-oauth.dto.js';
import {
  ForgotPasswordDto, VerifyOtpDto, ResetPasswordDto,
} from './dto/forgot-password.dto.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ── Register ────────────────────────────────────────────────────────────

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Daftar akun baru',
    description: 'Membuat akun baru dan langsung mengembalikan access token. User otomatis mendapat free plan.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'Akun berhasil dibuat',
    schema: {
      example: {
        message: 'Registrasi berhasil',
        user: { id: 'uuid', name: 'Budi Santoso', email: 'budi@example.com', plan: 'free' },
        accessToken: 'eyJhbGci...',
        tokenType: 'Bearer',
        expiresIn: '15m',
      },
    },
  })
  @ApiConflictResponse({ description: 'Email sudah terdaftar' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.name, dto.email, dto.password);
  }

  // ── Login ────────────────────────────────────────────────────────────────

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Login dengan email & password',
    description: 'Mengembalikan access token yang digunakan sebagai Bearer token di semua endpoint lain.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Login berhasil',
    schema: {
      example: {
        message: 'Login berhasil',
        user: { id: 'uuid', name: 'Budi Santoso', email: 'budi@example.com', plan: 'free' },
        accessToken: 'eyJhbGci...',
        tokenType: 'Bearer',
        expiresIn: '15m',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Email atau password salah' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  // ── Google OAuth ─────────────────────────────────────────────────────────

  @Public()
  @Post('google-oauth')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Upsert user via Google OAuth',
    description: 'Dipanggil oleh Next.js Auth.js setelah Google sign-in. Membuat akun jika belum ada, lalu mengembalikan access token.',
  })
  @ApiBody({ type: GoogleOAuthDto })
  @ApiOkResponse({
    description: 'Google OAuth berhasil',
    schema: {
      example: {
        message: 'Google OAuth berhasil',
        user: { id: 'uuid', name: 'Budi Santoso', email: 'budi@gmail.com', plan: 'free' },
        accessToken: 'eyJhbGci...',
        tokenType: 'Bearer',
      },
    },
  })
  googleOAuth(@Body() dto: GoogleOAuthDto) {
    return this.auth.googleOAuth(dto.email, dto.name, dto.avatar);
  }

  // ── Forgot Password ──────────────────────────────────────────────────────

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Kirim OTP reset password ke email',
    description: 'Selalu mengembalikan 200 — tidak mengungkapkan apakah email terdaftar atau tidak (anti enumeration).',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({
    description: 'OTP dikirim (atau tidak, tanpa konfirmasi)',
    schema: { example: { message: 'Jika email terdaftar, OTP telah dikirim' } },
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  // ── Verify OTP ───────────────────────────────────────────────────────────

  @Public()
  @Post('verify-otp')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Validasi OTP sebelum reset password',
    description: 'Cek apakah OTP 6 digit valid dan belum kadaluarsa. Panggil sebelum reset-password.',
  })
  @ApiBody({ type: VerifyOtpDto })
  @ApiOkResponse({
    description: 'OTP valid',
    schema: { example: { valid: true, message: 'OTP valid' } },
  })
  @ApiBadRequestResponse({ description: 'OTP tidak valid atau sudah kadaluarsa' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.email, dto.otp);
  }

  // ── Reset Password ───────────────────────────────────────────────────────

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reset password dengan OTP',
    description: 'Gunakan OTP dari email untuk mengatur password baru. OTP hanya bisa digunakan sekali.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({
    description: 'Password berhasil direset',
    schema: { example: { message: 'Password berhasil direset. Silakan login.' } },
  })
  @ApiBadRequestResponse({ description: 'OTP tidak valid atau sudah kadaluarsa' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.email, dto.otp, dto.newPassword);
  }

  // ── Me ───────────────────────────────────────────────────────────────────

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Profil user yang sedang login',
    description: 'Mengembalikan data user dari database beserta kode plan aktif.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        id: 'uuid', name: 'Budi Santoso', email: 'budi@example.com',
        phone: null, avatarUrl: null, plan: 'free',
        locale: 'id', timezone: 'Asia/Jakarta', createdAt: '2026-01-10T00:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Token tidak valid atau kadaluarsa' })
  getMe(@Request() req: { user: { id: string } }) {
    return this.auth.getMe(req.user.id);
  }

  @Patch('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update profil user',
    description: 'Update nama, nomor telepon, locale, atau timezone. Semua field opsional.',
  })
  @ApiBody({ type: UpdateMeDto })
  @ApiOkResponse({
    description: 'Profil berhasil diupdate',
    schema: {
      example: {
        id: 'uuid', name: 'Budi Santoso Baru', email: 'budi@example.com',
        phone: '+6281234567890', plan: 'free',
        locale: 'id', timezone: 'Asia/Jakarta',
      },
    },
  })
  updateMe(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateMeDto,
  ) {
    return this.auth.updateMe(req.user.id, dto);
  }
}
