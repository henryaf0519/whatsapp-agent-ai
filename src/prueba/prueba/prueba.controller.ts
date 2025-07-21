import { Controller } from '@nestjs/common';
import { Post, Body } from '@nestjs/common';
import { PruebaService } from '../prueba.service';

@Controller('prueba')
export class PruebaController {
  constructor(private readonly chatbotService: PruebaService) {}

  @Post()
  async handleMessage(
    @Body('message') message: string,
    @Body('threadId') threadId: string,
  ) {
    const reply = await this.chatbotService.conversar(threadId, message);
    return { reply: reply };
  }
}
