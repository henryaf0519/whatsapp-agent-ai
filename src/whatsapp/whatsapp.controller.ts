import { Controller } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { OpenaiService } from '../openai/openai.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly openAIService: OpenaiService,
  ) {}
}
