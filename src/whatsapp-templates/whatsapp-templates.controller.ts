import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WhatsappTemplatesService } from './whatsapp-templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { Request } from 'express';

@Controller('whatsapp-templates')
@UseGuards(AuthGuard('jwt'))
export class WhatsappTemplatesController {
  constructor(private readonly templatesService: WhatsappTemplatesService) {}

  @Post()
  createTemplate(
    @Body() createTemplateDto: CreateTemplateDto,
    @Req() req: Request,
  ) {
    const { waba_id } = req.user as { waba_id: string };
    //return this.templatesService.create(waba_id, createTemplateDto);
  }
}
