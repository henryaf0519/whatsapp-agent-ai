/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsResponse,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

export interface MessagePayload {
  from: string;
  text: string;
  SK: string;
  url?: string;
}
const allowedOrigins = [
  'http://localhost:5173',
  'https://orvexchat-666d6.web.app',
];

@WebSocketGateway({
  path: '/socket',
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
export class SocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(SocketGateway.name);

  public sendNewMessageNotification(
    businessId: string,
    conversationId: string,
    message: MessagePayload,
  ): void {
    this.server
      .to(businessId)
      .emit('newNotification', { conversationId, message });

    this.server
      .to(`${businessId}#${conversationId}`)
      .emit('newMessage', message);
  }

  public sendNewMessageToConversation(
    conversationId: string,
    message: MessagePayload,
  ): void {
    this.server.to(conversationId).emit('newMessage', message);
  }

  afterInit(server: Server): void {
    this.logger.log('WebSocket Gateway inicializado.');
  }

  handleConnection(client: Socket): void {}

  handleDisconnect(client: Socket): void {}

  @SubscribeMessage('subscribeToCompany')
  handleSubscribeToCompany(
    @ConnectedSocket() client: Socket,
    @MessageBody() companyId: string,
  ): void {
    client.join(companyId);
  }

  @SubscribeMessage('subscribeToChat')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: string,
  ): WsResponse<{ status: string; conversationId?: string; message?: string }> {
    if (!conversationId || typeof conversationId !== 'string') {
      this.logger.warn('ID de conversación inválido proporcionado.');
      return {
        event: 'subscribeToChat',
        data: { status: 'error', message: 'Invalid conversationId provided.' },
      };
    }
    client.join(conversationId);

    return {
      event: 'subscribeToChat',
      data: { status: 'success', conversationId },
    };
  }

  @SubscribeMessage('unsubscribeFromChat')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: string,
  ): void {
    this.logger.log(
      `Cliente ${client.id} se ha desuscrito del chat ${conversationId}`,
    );
    client.leave(conversationId);
  }
}
