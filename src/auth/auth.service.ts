import {
  Injectable, UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService }       from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { ConfigService }    from '@nestjs/config';
import * as bcrypt          from 'bcryptjs';
import * as nodemailer      from 'nodemailer';

import { UsersService }         from '../users/users.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { StreakService }        from '../streak/streak.service.js';
import { ResetToken }           from './reset-token.entity.js';
import type { JwtPayload }      from './jwt.strategy.js';

@Injectable()
export class AuthService {
  private mailer: nodemailer.Transporter;

  constructor(
    private readonly users:    UsersService,
    private readonly subs:     SubscriptionsService,
    private readonly streak:   StreakService,
    private readonly jwt:      JwtService,
    private readonly cfg:      ConfigService,
    @InjectRepository(ResetToken)
    private readonly resetRepo: Repository<ResetToken>,
  ) {
    this.mailer = nodemailer.createTransport({
      host:   cfg.get('MAIL_HOST', 'smtp.gmail.com'),
      port:   cfg.get<number>('MAIL_PORT', 587),
      secure: false,
      auth: {
        user: cfg.get('MAIL_USER'),
        pass: cfg.get('MAIL_PASS'),
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private buildTokens(user: { id: string; email: string }) {
    const payload: JwtPayload = { sub: user.id, email: user.email, plan: 'free', role: 'user' };
    return {
      accessToken: this.jwt.sign(payload, {
        secret:    this.cfg.get('JWT_SECRET'),
        expiresIn: this.cfg.get('JWT_EXPIRES_IN', '15m'),
      }),
      tokenType: 'Bearer',
      expiresIn: this.cfg.get('JWT_EXPIRES_IN', '15m'),
    };
  }

  // ── Register ─────────────────────────────────────────────────────────────
  // 1. Create user row in PostgreSQL
  // 2. Call provision_new_user() stored procedure → creates subscription,
  //    streak, silent_mode, quota rows atomically

  async register(name: string, email: string, password: string) {
    const user = await this.users.create(name, email, password);

    // Provision free plan + all SaaS scaffolding via stored procedure
    await this.subs.provisionNewUser(user.id);

    return {
      message: 'Registrasi berhasil',
      user:    { id: user.id, name: user.name, email: user.email, plan: 'free' },
      ...this.buildTokens(user),
    };
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive)
      throw new UnauthorizedException('Email atau password salah');

    const valid = await this.users.validatePassword(user, password);
    if (!valid)
      throw new UnauthorizedException('Email atau password salah');

    // Update last_login_at
    await this.users.touchLogin(user.id);

    // Touch streak — non-blocking, failure should not block login
    this.streak.touchStreak(user.id).catch(() => {});

    // Fetch current plan for the token payload
    const planCode = await this.subs.getPlanCode(user.id);

    const payload: JwtPayload = { sub: user.id, email: user.email, plan: planCode, role: user.role ?? 'user' };
    const accessToken = this.jwt.sign(payload, {
      secret:    this.cfg.get('JWT_SECRET'),
      expiresIn: this.cfg.get('JWT_EXPIRES_IN', '15m'),
    });

    return {
      message:     'Login berhasil',
      user:        { id: user.id, name: user.name, email: user.email, plan: planCode, role: user.role },
      accessToken,
      tokenType:   'Bearer',
      expiresIn:   this.cfg.get('JWT_EXPIRES_IN', '15m'),
    };
  }

  // ── Forgot Password ── Step 1: Send OTP via email ─────────────────────────

  async forgotPassword(email: string) {
    const user = await this.users.findByEmail(email);
    // Always 200 — never reveal whether email exists
    if (!user) return { message: 'Jika email terdaftar, OTP telah dikirim' };

    // Invalidate any previous unused tokens
    await this.resetRepo.delete({ userId: user.id, used: false });

    // 6-digit OTP, valid 15 minutes
    const otp       = Math.floor(100_000 + Math.random() * 900_000).toString();
    const tokenHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 15 * 60_000);

    await this.resetRepo.save(
      this.resetRepo.create({ userId: user.id, tokenHash, expiresAt, used: false }),
    );

    const from = this.cfg.get('MAIL_FROM', 'Pulse <noreply@pulse.app>');
    await this.mailer.sendMail({
      from,
      to:      user.email,
      subject: 'Kode OTP Reset Password – Pulse',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
          <h2 style="color:#B25329;margin-bottom:8px">Reset Password Pulse</h2>
          <p>Hai <b>${user.name}</b>,</p>
          <p style="margin-top:12px">Masukkan kode OTP berikut untuk mereset password kamu:</p>
          <div style="font-size:40px;font-weight:800;letter-spacing:10px;
                      color:#B25329;text-align:center;padding:28px 0;
                      background:#FFF4DC;border-radius:12px;margin:20px 0">
            ${otp}
          </div>
          <p style="color:#666;font-size:14px">
            Kode berlaku selama <b>15 menit</b>. Jangan bagikan ke siapapun.
          </p>
          <p style="color:#999;font-size:12px;margin-top:20px">
            Jika kamu tidak meminta reset password, abaikan email ini.
          </p>
        </div>
      `,
    });

    return { message: 'Jika email terdaftar, OTP telah dikirim' };
  }

  // ── Forgot Password ── Step 2: Verify OTP ────────────────────────────────

  async verifyOtp(email: string, otp: string) {
    const user = await this.users.findByEmail(email);
    if (!user) throw new BadRequestException('OTP tidak valid');

    const token = await this.resetRepo.findOne({
      where: { userId: user.id, used: false },
      order: { createdAt: 'DESC' },
    });

    if (!token || token.expiresAt < new Date())
      throw new BadRequestException('OTP tidak valid atau sudah kadaluarsa');

    const match = await bcrypt.compare(otp, token.tokenHash);
    if (!match) throw new BadRequestException('OTP tidak valid');

    return { valid: true, message: 'OTP valid' };
  }

  // ── Forgot Password ── Step 3: Reset Password ─────────────────────────────

  async resetPassword(email: string, otp: string, newPassword: string) {
    const user = await this.users.findByEmail(email);
    if (!user) throw new BadRequestException('OTP tidak valid');

    const token = await this.resetRepo.findOne({
      where: { userId: user.id, used: false },
      order: { createdAt: 'DESC' },
    });

    if (!token || token.expiresAt < new Date())
      throw new BadRequestException('OTP tidak valid atau sudah kadaluarsa');

    const match = await bcrypt.compare(otp, token.tokenHash);
    if (!match) throw new BadRequestException('OTP tidak valid');

    await this.users.updatePassword(user.id, newPassword);
    await this.resetRepo.update(token.id, { used: true });

    return { message: 'Password berhasil direset. Silakan login.' };
  }

  // ── Me ────────────────────────────────────────────────────────────────────

  async getMe(userId: string) {
    const user     = await this.users.findById(userId);
    const planCode = await this.subs.getPlanCode(userId);
    return {
      id:        user.id,
      name:      user.name,
      email:     user.email,
      phone:     user.phone,
      avatarUrl: user.avatarUrl,
      plan:      planCode,
      locale:    user.locale,
      timezone:  user.timezone,
      createdAt: user.createdAt,
    };
  }

  async updateMe(
    userId: string,
    data: { name?: string; phone?: string | null; locale?: string; timezone?: string },
  ) {
    const updated  = await this.users.updateProfile(userId, data);
    const planCode = await this.subs.getPlanCode(userId);
    return {
      id:        updated.id,
      name:      updated.name,
      email:     updated.email,
      phone:     updated.phone,
      avatarUrl: updated.avatarUrl,
      plan:      planCode,
      locale:    updated.locale,
      timezone:  updated.timezone,
      createdAt: updated.createdAt,
    };
  }

  // ── Google OAuth ──────────────────────────────────────────────────────────
  // Called by Next.js Auth.js jwt callback after Google sign-in.
  // Upserts the user (create if not found) then returns an accessToken.

  async googleOAuth(email: string, name: string, avatar?: string) {
    let user = await this.users.findByEmail(email);

    if (!user) {
      // Auto-register Google user with a random unusable password
      const randomPwd = Math.random().toString(36).slice(-16) + 'Aa1!';
      user = await this.users.create(name, email, randomPwd);
      // Set avatar and mark as verified (trusted Google account)
      await this.users.updateAvatar(user.id, avatar ?? null);
      await this.subs.provisionNewUser(user.id);
    }

    const planCode = await this.subs.getPlanCode(user.id);
    // Touch streak on every Google sign-in — non-blocking
    this.streak.touchStreak(user.id).catch(() => {});
    const payload: JwtPayload = { sub: user.id, email: user.email, plan: planCode, role: user.role ?? 'user' };
    const accessToken = this.jwt.sign(payload, {
      secret:    this.cfg.get('JWT_SECRET'),
      expiresIn: this.cfg.get('JWT_EXPIRES_IN', '15m'),
    });

    return {
      message:     'Google OAuth berhasil',
      user:        { id: user.id, name: user.name, email: user.email, plan: planCode },
      accessToken,
      tokenType:   'Bearer',
    };
  }
}
