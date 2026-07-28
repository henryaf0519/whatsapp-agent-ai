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
import { FlowManagementService } from './flow-management.service';
import { AuthGuard } from '@nestjs/passport';

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

  constructor(
    private readonly flowService: FlowService,
    private readonly flowManagementService: FlowManagementService,
  ) {}

  @Post('webhookPro')
  async handleFlowWebhookPro(@Body() body: any, @Res() res: Response) {
    this.logger.log('Petición de Flow recibida webhookPro');
    try {
      const encryptedResponsePayload = await this.flowService.processDynamicFlowData(body);
      res.status(200).header('Content-Type', 'text/plain').send(encryptedResponsePayload);
    } catch (error) {
      this.logger.error('Error procesando el webhook del Flow', error);
      res.status(500).send('Error interno del servidor');
    }
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.CREATED)
  async createFlow(
    @Req() req: Request,
    @Body('name') name: string,
    @Body('categories') categories?: string[],
  ) {
    const { number_id, waba_id } = req.user as { number_id: string; waba_id: string; app_id: string; };
    return this.flowManagementService.createFlow(waba_id, number_id, name, categories);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getFlows(@Req() req: Request) {
    const { number_id, waba_id } = req.user as { number_id: string; waba_id: string; app_id: string; };
    return this.flowManagementService.getFlows(waba_id, number_id);
  }

  @Get(':flowId')
  @UseGuards(AuthGuard('jwt'))
  async getFlowById(@Param('flowId') flowId: string, @Req() req: Request) {
    const user = req.user as JwtUser;
    return this.flowManagementService.getFlowById(flowId, user.number_id);
  }

  @Put(':flowId/assets')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async updateFlowAssets(
    @Param('flowId') flowId: string,
    @Req() req: Request,
    @Body('flowJson') flowJson: string,
    @Body('navigationMap') navigation: string,
  ) {
    const user = req.user as JwtUser;
    return this.flowManagementService.updateFlowAssets(flowId, user.number_id, flowJson, navigation);
  }

  @Delete(':flowId')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async deleteFlow(@Param('flowId') flowId: string, @Req() req: Request) {
    const user = req.user as JwtUser;
    return this.flowManagementService.deleteFlow(flowId, user.number_id);
  }

  @Post('publish')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async publishFlow(
    @Req() req: Request,
    @Body('flowId') flowId: string,
    @Body('name') name: string,
  ) {
    const user = req.user as JwtUser;
    return this.flowManagementService.publishFlow(flowId, name, user.number_id);
  }

  @Post(':internalFlowId/test')
  @UseGuards(AuthGuard('jwt'))
  async sendTestFlow(
    @Req() req: Request,
    @Body('flowId') flowId: string,
    @Body('to') to: string,
    @Body('screen') screen: string,
    @Body('flowName') flowName: string,
  ) {
    const user = req.user as JwtUser;
    return this.flowManagementService.sendTestFlow(flowId, flowName, to, screen, user.number_id);
  }
}