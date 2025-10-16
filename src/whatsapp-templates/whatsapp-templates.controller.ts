/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Logger,
  Get,
  HttpCode,
  HttpStatus,
  HttpException,
  Put,
  Param,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreateTemplateDto } from './dto/create-template.dto';
import { WhatsappTemplatesService } from './whatsapp-templates.service';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Controller('templates')
@UseGuards(AuthGuard('jwt'))
export class WhatsappTemplatesController {
  private readonly logger = new Logger(WhatsappTemplatesController.name);

  constructor(private readonly templatesService: WhatsappTemplatesService) {}

  @Post()
  createTemplate(
    @Body() createTemplateDto: CreateTemplateDto,
    @Req() req: import('express').Request,
  ) {
    const { number_id, waba_id } = req.user as {
      number_id: string;
      waba_id: string;
    };
    return this.templatesService.create(
      number_id,
      waba_id,
      '1375929964096026',
      createTemplateDto,
    );
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Req() req: import('express').Request) {
    try {
      const { number_id, waba_id } = req.user as {
        number_id: string;
        waba_id: string;
      };
      const templates = await this.templatesService.getTemplates(
        number_id,
        waba_id,
      );
      return templates;
    } catch (error) {
      if (typeof error === 'object' && error !== null) {
        const responseData = (error as any).response?.data;
        const message = (error as any).message;
        console.error('Error fetching templates:', responseData || message);
      } else {
        console.error('Error fetching templates:', error);
      }
      throw new HttpException(
        'No se pudieron obtener las plantillas.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id') id: string,
    @Body() updateTemplateDto: UpdateTemplateDto,
    @Req() req: import('express').Request,
  ) {
    const { number_id } = req.user as {
      number_id: string;
    };
    return this.templatesService.update(number_id, id, updateTemplateDto);
  }
}
