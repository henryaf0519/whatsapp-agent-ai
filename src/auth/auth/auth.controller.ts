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
  Query,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';

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

  /**
   * ENDPOINT A: Obtener la URL de Autenticación de Google.
   * Protegido por JWT. El frontend llama a este endpoint cuando el usuario
   * (ya logueado en nuestro dashboard) hace clic en "Conectar Google Calendar".
   */
  @Get('google/url')
  @UseGuards(AuthGuard('jwt'))
  getGoogleAuthUrl(@Req() req: Request) {
    // (req.user as any).userId funciona por tu JwtStrategy
    const userId = (req.user as any).userId;

    if (!userId) {
      throw new UnauthorizedException(
        'No se pudo identificar al usuario desde el token.',
      );
    }

    // Generamos la URL de permiso pasándole el email del usuario como 'state'
    const authUrl = this.authService.generateGoogleAuthUrl(userId);

    // Devolvemos la URL al frontend
    return { authUrl };
  }

  /**
   * ENDPOINT B: Manejar el Callback de Google.
   * Este endpoint es público (sin JWT Guard) porque es Google quien lo llama.
   * Google nos envía un 'code' y el 'state' que le pasamos en el Endpoint A.
   */
  @Get('google/callback')
  async handleGoogleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      throw new UnauthorizedException(
        'Callback de Google inválido: faltan "code" o "state".',
      );
    }

    const userId = state; // El 'state' es el email de nuestro usuario
    await this.authService.handleGoogleCallback(code, userId);

    // Una vez procesado el token, respondemos con un HTML simple
    // que le dice a la ventana popup que se cierre.
    res.setHeader('Content-Type', 'text/html');
    res.send(
      '<script>window.close();</script><p>¡Autenticación completada! Ya puedes cerrar esta ventana.</p>',
    );
  }
}
