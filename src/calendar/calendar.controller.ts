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
  Delete,
  Param,
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

  @Delete(':appointmentId') // 🆕 Endpoint: DELETE /appointments/:appointmentId
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.NO_CONTENT) // ✅ Respuesta 204: Petición exitosa sin contenido para devolver
  async cancelAppointment(
    @Req() req: Request,
    @Param('appointmentId') appointmentId: string, // El ID de la cita (que debe ser el SK)
  ) {
    const { number_id } = req.user as {
      number_id: string;
    };
    this.logger.log(
      `Cancelando cita ${appointmentId} para usuario: ${number_id}`,
    );

    // 🚨 Asumimos que 'appointmentId' es el Sort Key (SK) de DynamoDB
    await this.calendarService.cancelAppointment(number_id, appointmentId);

    // Al no haber 'return', NestJS usa el HttpStatus.NO_CONTENT definido
  }
}
