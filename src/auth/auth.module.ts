import { Module }         from '@nestjs/common';
import { TypeOrmModule }  from '@nestjs/typeorm';
import { JwtModule }      from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { ResetToken }           from './reset-token.entity.js';
import { AuthService }          from './auth.service.js';
import { AuthController }       from './auth.controller.js';
import { JwtStrategy }          from './jwt.strategy.js';
import { UsersModule }          from '../users/users.module.js';
import { SubscriptionsModule }  from '../subscriptions/subscriptions.module.js';
import { StreakModule }         from '../streak/streak.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResetToken]),
    PassportModule,
    JwtModule.registerAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret:      cfg.get<string>('JWT_SECRET', 'secret'),
        signOptions: { expiresIn: cfg.get('JWT_EXPIRES_IN', '15m') },
      }),
    }),
    UsersModule,
    SubscriptionsModule,
    StreakModule,
  ],
  providers:   [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports:     [AuthService],
})
export class AuthModule {}
