/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DynamoService } from '../../database/dynamo/dynamo.service';
import * as bcrypt from 'bcrypt';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private jwtService: JwtService,
    private dynamoService: DynamoService,
    private readonly whatsappService: WhatsappService,
  ) {}

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
}
