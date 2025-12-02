/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Controller,
  Logger,
  Get,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Post,
  Body,
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

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.CREATED)
  async createAppointment(
    @Req() req: Request,
    @Body()
    body: {
      date: string;
      time: string;
      stylistId: string;
      stylistName: string; // ✅ Nombre del profesional (ej: Over Otalora)
      clientEmail: string;
      clientName: string; // ✅ Nombre del cliente (ej: Henry)
      clientPhone: string; // ✅ Teléfono del cliente (ej: 319...)
    },
  ) {
    const { number_id } = req.user as { number_id: string };

    this.logger.log(`Creando nueva cita desde Dashboard para: ${number_id}`);

    // Pasamos el body completo al servicio, que se encarga de formatear
    return await this.calendarService.createAppointmentFromDashboard(
      number_id,
      body,
    );
  }
}
