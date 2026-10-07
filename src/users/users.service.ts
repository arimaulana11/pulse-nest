import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import * as bcrypt          from 'bcryptjs';
import { User }             from './user.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: email.toLowerCase() } });
  }

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User tidak ditemukan');
    return user;
  }

  async create(name: string, email: string, password: string): Promise<User> {
    const exists = await this.findByEmail(email);
    if (exists) throw new ConflictException('Email sudah terdaftar');

    const passwordHash = await bcrypt.hash(password, 12);

    // Use query builder to avoid TypeORM strict-type issues with
    // the nullable `plan` column that now lives on subscriptions
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .into(User)
      .values({
        name:         name.trim(),
        email:        email.toLowerCase().trim(),
        passwordHash,
        isActive:     true,
        isVerified:   false,
      })
      .returning('*')
      .execute();

    return result.generatedMaps[0] as User;
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.repo.update(userId, { passwordHash });
  }

  async validatePassword(user: User, plainPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, user.passwordHash);
  }

  async updateAvatar(userId: string, avatarUrl: string | null): Promise<void> {
    await this.repo.update(userId, { avatarUrl, isVerified: true });
  }

  async updateProfile(
    userId:   string,
    data: { name?: string; phone?: string | null; locale?: string; timezone?: string },
  ): Promise<User> {
    const updates: Partial<User> = {};
    if (data.name     !== undefined) updates.name     = data.name.trim();
    if (data.phone    !== undefined) updates.phone    = data.phone ?? null;
    if (data.locale   !== undefined) updates.locale   = data.locale;
    if (data.timezone !== undefined) updates.timezone = data.timezone;
    await this.repo.update(userId, updates);
    return this.findById(userId);
  }

  async touchLogin(userId: string): Promise<void> {
    await this.repo.update(userId, { lastLoginAt: new Date() });
  }
}
