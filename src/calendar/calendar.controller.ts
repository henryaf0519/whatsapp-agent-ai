/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Controller,
  Logger,
  Get,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { CalendarService } from './calendar.service';
import { AuthGuard } from '@nestjs/passport'; // <--- AÑADIR

@Controller('appointments')
export class CalendarController {
  private readonly logger = new Logger(CalendarController.name);
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK) // ✅ Es una consulta, devuelve 200, no 201
  async getAppointments(@Req() req: Request) {
    const { number_id } = req.user as {
      number_id: string;
    };
    this.logger.log(`Obteniendo citas para: ${number_id}`);
    return await this.calendarService.getAppointments(number_id);
  }
}
