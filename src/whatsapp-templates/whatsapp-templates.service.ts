/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  CreateTemplateDto,
  HeaderComponentDto,
} from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class WhatsappTemplatesService {
  private readonly logger = new Logger(WhatsappTemplatesService.name);

  constructor(private readonly whatsappService: WhatsappService) {}

  async create(
    number_id: string,
    waba_id: string,
    appId: string,
    templateDto: CreateTemplateDto,
  ): Promise<any> {
    this.logger.log(
      `Iniciando orquestación para plantilla "${templateDto.name}" para WABA ID: ${number_id}`,
    );

    const mutableTemplateDto = JSON.parse(JSON.stringify(templateDto));

    const mediaHeaderComponent = mutableTemplateDto.components.find(
      (c) =>
        c.type === 'HEADER' &&
        ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(
          (c as HeaderComponentDto).format,
        ),
    ) as HeaderComponentDto | undefined;

    if (mediaHeaderComponent?.example?.header_base64) {
      this.logger.log(
        'Se detectó un archivo base64 en el header. Subiendo a Meta...',
      );

      const base64Data = mediaHeaderComponent.example.header_base64;

      const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new HttpException(
          'El formato del string base64 es inválido.',
          HttpStatus.BAD_REQUEST,
        );
      }
      const fileType = matches[1];
      const fileBuffer = Buffer.from(matches[2], 'base64');

      const { handle } = await this.whatsappService.uploadMediaBufferToMeta(
        number_id,
        appId,
        fileBuffer,
        fileType,
      );

      this.logger.log(`Handle obtenido: ${handle}. Actualizando DTO...`);
      mediaHeaderComponent.example.header_handle = [handle];
      delete mediaHeaderComponent.example.header_base64;
    }

    return this.whatsappService.createMessageTemplate(
      number_id,
      waba_id,
      mutableTemplateDto,
    );
  }

  async getTemplates(number_id: string, waba_id: string): Promise<any[]> {
    const token = await this.whatsappService.getWhatsappToken(number_id);
    if (!token) {
      throw new HttpException(
        'No se pudo obtener el token de WhatsApp.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const templates = await this.whatsappService.getMessageTemplates(
        waba_id,
        token,
      );
      return templates;
    } catch (error) {
      this.logger.error(
        `Error al obtener plantillas para WABA ID ${waba_id}: ${
          (error as any).response?.data || (error as any).message
        }`,
      );
      throw new HttpException(
        'No se pudieron obtener las plantillas.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async update(
    templateId: string,
    number_id: string,
    waba_id: string,
    appId: string,
    updateTemplateDto: UpdateTemplateDto,
  ): Promise<any> {
    this.logger.log(
      `Iniciando orquestación para ACTUALIZAR plantilla ID: ${templateId}`,
    );

    // Hacemos una copia mutable para poder modificarla
    const mutableUpdateDto = JSON.parse(JSON.stringify(updateTemplateDto));

    const mediaHeaderComponent = mutableUpdateDto.components.find(
      (c) =>
        c.type === 'HEADER' &&
        ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(c.format),
    ) as HeaderComponentDto | undefined;

    // Si hay una nueva imagen en base64...
    if (mediaHeaderComponent?.example?.header_base64) {
      this.logger.log('Se detectó un archivo base64. Subiendo a Meta...');
      const base64Data = mediaHeaderComponent.example.header_base64;

      const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new HttpException(
          'Formato de base64 inválido.',
          HttpStatus.BAD_REQUEST,
        );
      }
      const fileType = matches[1];
      const fileBuffer = Buffer.from(matches[2], 'base64');

      try {
        // --- USANDO EL MISMO PATRÓN QUE 'CREATE' ---
        const { handle } = await this.whatsappService.uploadMediaBufferToMeta(
          number_id,
          appId,
          fileBuffer,
          fileType,
        );
        this.logger.log(`Handle obtenido: ${handle}. Actualizando DTO...`);

        // Reemplazamos el base64 por el handle válido
        mediaHeaderComponent.example.header_handle = [handle];
        delete mediaHeaderComponent.example.header_base64;
      } catch (uploadError) {
        this.logger.error(
          'Fallo al subir la imagen durante la actualización.',
          uploadError,
        );
        throw uploadError;
      }
    }

    const payload = { components: mutableUpdateDto.components };
    const resp = await this.whatsappService.updateTemplate(
      number_id,
      templateId,
      payload,
    );
    return resp;
  }

  async delete(
    number_id: string,
    waba_id: string,
    templateName: string,
  ): Promise<any> {
    this.logger.log(
      `Iniciando eliminación de plantilla "${templateName}" para WABA ID: ${waba_id}`,
    );

    return this.whatsappService.deleteTemplateByName(
      number_id,
      waba_id,
      templateName,
    );
  }
}
