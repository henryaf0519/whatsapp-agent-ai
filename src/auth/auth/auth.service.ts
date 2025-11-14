/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DynamoService } from '../../database/dynamo/dynamo.service';
import * as bcrypt from 'bcrypt';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly oauth2Client: OAuth2Client;
  constructor(
    private jwtService: JwtService,
    private dynamoService: DynamoService,
    private readonly whatsappService: WhatsappService,
    private readonly configService: ConfigService,
  ) {
    const clientId = this.configService.get<string>('GMAIL_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GMAIL_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('GMAIL_REDIRECT_URI');
    if (!clientId || !clientSecret || !redirectUri) {
      this.logger.error(
        'Faltan credenciales de Google OAuth (CLIENT_ID, CLIENT_SECRET, REDIRECT_URI) en el .env',
      );
      throw new Error('Configuración de Google OAuth incompleta');
    }

    this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
  }

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.dynamoService.findUserByEmail(email);
    console.log('user: ', user);
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (pass === user.pass) {
      console.log('here');
    }
    const isMatch = await bcrypt.compare(pass, user.password);
    console.log('ismat: ', isMatch);

    if (!isMatch) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const { password, ...result } = user;
    return result;
  }

  async login(
    user: any,
  ): Promise<{ access_token: string; templates: any[]; user: any }> {
    const payload = {
      sub: user.email,
      username: user.email,
      waba_id: user.waba_id,
      number_id: user.number_id,
      app_id: user.app_id,
    };
    const accessToken = this.jwtService.sign(payload);

    let userTemplates: any[] = [];

    if (user.waba_id && user.whatsapp_token) {
      this.logger.log(
        `Obteniendo plantillas directamente desde la API para ${user.email}`,
      );
      try {
        // 1. Obtenemos las plantillas directamente desde el servicio de WhatsApp
        userTemplates = await this.whatsappService.getMessageTemplates(
          user.waba_id,
          user.whatsapp_token,
        );
        this.logger.log(
          'Plantillas obtenidas desde la API: ',
          JSON.stringify(userTemplates, null, 2),
        );
      } catch (error) {
        this.logger.error(
          `Falló la obtención de plantillas para ${user.email}`,
          error,
        );
        userTemplates = [];
      }
    } else {
      this.logger.warn(
        `El usuario ${user.email} no tiene waba_id o token. No se devolverán plantillas.`,
      );
    }

    const safeUser = {
      email: user.email,
      waba_id: user.waba_id,
      number_id: user.number_id,
      app_id: user.app_id,
      hasGoogleAuth: user.hasGoogleAuth || false,
    };

    return {
      access_token: accessToken,
      templates: userTemplates,
      user: safeUser,
    };
  }

  async createUser(
    email: string,
    password: string,
    waba_id: string,
    whatsapp_token: string,
    number_id: string,
    app_id: string,
  ): Promise<any> {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await this.dynamoService.createUserLogin(
      email,
      hashedPassword,
      waba_id,
      whatsapp_token,
      number_id,
      app_id,
    );
    return user;
  }

  /**
   * Orquesta la sincronización de plantillas para un usuario específico.
   * @param wabaId - El ID de la cuenta de WhatsApp Business del usuario.
   * @param token - El token de acceso del usuario.
   */
  private async syncUserTemplates(
    wabaId: string,
    token: string,
  ): Promise<void> {
    try {
      const templates = await this.whatsappService.getMessageTemplates(
        wabaId,
        token,
      );

      if (!templates || templates.length === 0) {
        this.logger.log(
          `No se encontraron plantillas para sincronizar para waba_id: ${wabaId}`,
        );
        return;
      }

      this.logger.log(`Templates `, JSON.stringify(templates, null, 2));

      // 2. Guarda las plantillas en DynamoDB asociadas a ese wabaId
      await this.dynamoService.saveTemplatesForAccount(wabaId, templates);

      this.logger.log(
        `Sincronización de ${templates.length} plantillas completada para ${wabaId}`,
      );
    } catch (error) {
      // Los errores ya se loguean en los servicios de más bajo nivel
      this.logger.error(
        `Falló el proceso de sincronización para waba_id ${wabaId}`,
      );
    }
  }

  /**
   * Genera la URL de autenticación de Google para que el usuario dé su consentimiento.
   * @param userId El email del usuario (o ID) que se pasará en el 'state' para identificarlo en el callback.
   * @returns La URL de autorización para abrir en el popup.
   */
  generateGoogleAuthUrl(userId: string): string {
    const scopes = [
      'https://www.googleapis.com/auth/calendar.events', // Permiso clave para crear/editar eventos
    ];

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // Obligatorio para obtener un refresh_token
      prompt: 'consent', // Fuerza a mostrar la pantalla de consentimiento
      scope: scopes,
      state: userId, // Usamos el email/ID del usuario como 'state'
    });

    this.logger.log(`Generando Google Auth URL para usuario: ${userId}`);
    return authUrl;
  }

  /**
   * Maneja el callback de Google.
   * Intercambia el código de autorización por tokens y guarda el refresh_token.
   * @param code El código de autorización de un solo uso devuelto por Google.
   * @param userId El 'state' que enviamos, que es el email del usuario.
   */
  async handleGoogleCallback(
    code: string,
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(
        `Recibido callback de Google para usuario: ${userId}. Intercambiando código...`,
      );

      // 1. Intercambiar el código por tokens
      const { tokens } = await this.oauth2Client.getToken(code);
      const refreshToken = tokens.refresh_token;

      // 2. Guardar el Refresh Token
      if (refreshToken) {
        this.logger.log(
          `Refresh token obtenido para ${userId}. Guardando en DynamoDB...`,
        );

        // 3. Llamar a nuestro nuevo método de DynamoService
        await this.dynamoService.updateUserGoogleRefreshToken(
          userId,
          refreshToken,
        );

        this.logger.log(`Refresh token guardado exitosamente para ${userId}.`);
        return {
          success: true,
          message: 'Autenticación de Google completada.',
        };
      } else {
        // Esto pasa si el usuario ya había autorizado la app antes
        this.logger.warn(
          `No se recibió un nuevo refresh_token para ${userId}. (Normal si ya estaba autorizado).`,
        );
        return {
          success: true,
          message:
            'Autorización de Google procesada. No se generó un nuevo token (normal si ya estaba conectado).',
        };
      }
    } catch (error) {
      this.logger.error(
        `Error en el callback de Google para ${userId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Error al procesar el callback de Google',
        (error as Error).message,
      );
    }
  }
}
