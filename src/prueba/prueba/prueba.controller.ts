import { Controller } from '@nestjs/common';
import { Post, Body } from '@nestjs/common';
import { PruebaService } from '../prueba.service';

@Controller('prueba')
export class PruebaController {
  constructor(private readonly chatbotService: PruebaService) {}

  @Post()
  async handleMessage(@Body('message') message: string) {
    console.log('Received message:', message);
    const reply = await this.chatbotService.conversar('1', message);
    return { reply: reply };
  }
}
