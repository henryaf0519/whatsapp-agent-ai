/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
// src/auth/jwt.strategy.ts

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') || 'TU_SECRETO_SUPER_SEGURO',
    });
  }

  validate(payload: {
    sub: string;
    username: string;
    waba_id: string;
    number_id: string;
  }) {
    return {
      userId: payload.sub,
      email: payload.username,
      waba_id: payload.waba_id,
      number_id: payload.number_id,
    };
  }
}
