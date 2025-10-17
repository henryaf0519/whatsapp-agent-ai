/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Get,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';

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
    console.log('user: ', user);
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const loginData = await this.authService.login(user);
    return {
      accessToken: loginData.access_token,
      templates: loginData.templates,
      userData: loginData.user,
    };
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('waba_id') waba_id: string,
    @Body('number_id') number_id: string,
    @Body('app_id') app_id: string,
    @Body('whatsapp_token') whatsapp_token: string,
  ) {
    // ✅ PASAMOS LOS NUEVOS CAMPOS AL SERVICIO
    const user = await this.authService.createUser(
      email,
      password,
      waba_id,
      whatsapp_token,
      number_id,
      app_id,
    );
    return {
      message: 'Usuario registrado con éxito',
      email: user.email,
    };
  }

  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  getProfile(@Req() req: import('express').Request) {
    const userFromJwt = req.user as {
      userId: string;
      email: string;
      waba_id: string;
      app_id: string;
    };

    const safeUserProfile = {
      email: userFromJwt.email,
      waba_id: userFromJwt.waba_id,
      app_id: userFromJwt.app_id,
    };

    return safeUserProfile;
  }
}
