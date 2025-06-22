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

    const aiResponse = await this.openAIService.getAIResponse(
      message,
      [], // Pass an empty array if there's no chat history
    );
    const aiResponseString =
      typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse);
    const response: unknown = await this.whatsappService.sendMessage(
      phone,
      aiResponseString,
    );
    return { status: 'Message sent successfully', response };
  }
}
