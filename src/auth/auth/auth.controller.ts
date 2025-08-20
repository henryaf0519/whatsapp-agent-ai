/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body('email') email: string,
    @Body('password') password: string,
  ) {
    const user = await this.authService.validateUser(email, password);

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    return this.authService.login(user);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('waba_id') waba_id: string,
    @Body('whatsapp_token') whatsapp_token: string,
  ) {
    // ✅ PASAMOS LOS NUEVOS CAMPOS AL SERVICIO
    const user = await this.authService.createUser(
      email,
      password,
      waba_id,
      whatsapp_token,
    );
    return {
      message: 'Usuario registrado con éxito',
      email: user.email,
    };
  }
}
