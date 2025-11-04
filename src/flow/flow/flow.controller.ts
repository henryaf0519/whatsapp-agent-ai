/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Controller,
  Post,
  Body,
  Res,
  Logger,
  Get,
  Delete,
  Param,
  Put,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { FlowService } from './flow.service';
import { AuthGuard } from '@nestjs/passport'; // <--- AÑADIR

// Definir el tipo para el usuario en el Request
interface JwtUser {
  userId: string;
  email: string;
  waba_id: string;
  number_id: string;
  app_id: string;
}

@Controller('flow')
export class FlowController {
  private readonly logger = new Logger(FlowController.name);
  constructor(private readonly flowService: FlowService) {}

  @Post('webhook')
  async handleFlowWebhook(@Body() body: any, @Res() res: Response) {
    this.logger.log(
      'Petición de Flow recibida (modo de prueba, sin validación de firma)',
    );

    try {
      const encryptedResponsePayload =
        await this.flowService.processDynamicFlowData(body);
      res
        .status(200)
        .header('Content-Type', 'text/plain')
        .send(encryptedResponsePayload);
    } catch (error) {
      this.logger.error('Error procesando el webhook del Flow', error);
      res.status(500).send('Error interno del servidor');
    }
  }

  /*
  ==========================================================================
  NUEVOS ENDPOINTS CRUD PARA GESTIÓN DE FLOWS (ADMIN)
  ==========================================================================
  */

  /**
   * 1. Crear un nuevo Flow (vacío)
   */
  @Post()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.CREATED)
  async createFlow(
    @Req() req: Request,
    @Body('name') name: string,
    @Body('categories') categories?: string[],
  ) {
    const { number_id, waba_id } = req.user as {
      number_id: string;
      waba_id: string;
      app_id: string;
    };
    return this.flowService.createFlow(waba_id, number_id, name, categories);
  }

  /**
   * 3. Obtener todos los Flows de la WABA
   */
  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getFlows(@Req() req: Request) {
    const { number_id, waba_id } = req.user as {
      number_id: string;
      waba_id: string;
      app_id: string;
    };
    return this.flowService.getFlows(waba_id, number_id);
  }

  /**
   * 2. Obtener un Flow específico por su ID
   */
  @Get(':flowId')
  @UseGuards(AuthGuard('jwt'))
  async getFlowById(@Param('flowId') flowId: string, @Req() req: Request) {
    const user = req.user as JwtUser;
    return this.flowService.getFlowById(flowId, user.number_id);
  }

  /**
   * 4. Actualizar el contenido (JSON) de un Flow
   * Espera un body como: { "flowJson": "{...}" }
   */
  @Put(':flowId/assets')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async updateFlowAssets(
    @Param('flowId') flowId: string,
    @Req() req: Request,
    @Body('flowJson') flowJson: string, // Asumimos que el frontend envía el JSON como un string
  ) {
    const user = req.user as JwtUser;
    return this.flowService.updateFlowAssets(flowId, user.number_id, flowJson);
  }

  /**
   * 5. Eliminar un Flow
   */
  @Delete(':flowId')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async deleteFlow(@Param('flowId') flowId: string, @Req() req: Request) {
    const user = req.user as JwtUser;
    return this.flowService.deleteFlow(flowId, user.number_id);
  }

  /**
   * 6. Publicar un Flow
   */

  @Post('publish') // <-- RUTA CAMBIADA (ya no tiene :flowId)
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async publishFlow(
    @Req() req: Request,
    @Body('flowId') flowId: string, // <-- CAMBIADO (viene del body)
    @Body('name') name: string,
  ) {
    const user = req.user as JwtUser;

    // Pasamos todos los parámetros al servicio
    return this.flowService.publishFlow(flowId, name, user.number_id);
  }
}
