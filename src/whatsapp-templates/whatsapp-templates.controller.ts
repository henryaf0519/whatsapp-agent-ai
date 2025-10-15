import { Controller, Post, Body, UseGuards, Req, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CreateTemplateDto } from './dto/create-template.dto';
import { WhatsappTemplatesService } from './whatsapp-templates.service';

@Controller('templates')
@UseGuards(AuthGuard('jwt'))
export class WhatsappTemplatesController {
  private readonly logger = new Logger(WhatsappTemplatesController.name);

  constructor(private readonly templatesService: WhatsappTemplatesService) {}

  @Post('/create')
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
}
