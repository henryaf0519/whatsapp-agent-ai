import { Controller, Post, Body } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { OpenaiService } from '../openai/openai.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly openAIService: OpenaiService,
  ) {}

  @Post('send-message')
  async handleMessage(@Body() body: { message: string; phone: string }) {
    const { message, phone } = body;

    const aiResponse = await this.openAIService.getAIResponse(message);
    const response: unknown = await this.whatsappService.sendMessage(
      phone,
      aiResponse,
    );
    return { status: 'Message sent successfully', response };
  }
}
