import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy }                  from '@nestjs/passport';
import { ExtractJwt, Strategy }              from 'passport-jwt';
import { ConfigService }                     from '@nestjs/config';
import { UsersService }                      from '../users/users.service.js';

export interface JwtPayload {
  sub:   string;   // user id
  email: string;
  plan:  string;
  role:  string;   // 'user' | 'admin' | 'super_admin'
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(cfg: ConfigService, private users: UsersService) {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      cfg.get<string>('JWT_SECRET', 'secret'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.users.findById(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedException();
    return user;   // attached to request.user
  }
}
