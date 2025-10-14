import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreateTemplateDto } from './dto/create-template.dto';
import { Request } from 'express';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';

@Controller('whatsapp-templates')
@UseGuards(AuthGuard('jwt'))
export class WhatsappTemplatesController {
  constructor(private readonly templatesService: WhatsappService) {}

  @Post()
  createTemplate(
    @Body() createTemplateDto: CreateTemplateDto,
    @Req() req: Request,
  ) {
    const { waba_id } = req.user as { waba_id: string };
    return this.templatesService.createMessageTemplate(
      waba_id,
      createTemplateDto,
    );
  }
}
