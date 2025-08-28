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

// Es una buena práctica definir una interfaz para la carga útil de tus mensajes.
export interface MessagePayload {
  from: string;
  text: string;
  SK: string;
  url?: string;
  // Agrega aquí otros campos que pueda tener tu mensaje.
}

@WebSocketGateway({
  path: '/socket', // Define una ruta específica para el WebSocket
})
export class SocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(SocketGateway.name);

  // Método para enviar una notificación de nuevo mensaje.
  // Este método será llamado por tu DynamoController.
  public sendNewMessageNotification(
    conversationId: string,
    message: MessagePayload,
  ): void {
    this.logger.log(`Emitiendo 'newMessage' para el chat: ${conversationId}`);
    this.server.to(conversationId).emit('newMessage', message);
    this.server.emit('newNotification', { conversationId, message });
  }

  // Métodos del ciclo de vida del Gateway
  afterInit(server: Server): void {
    this.logger.log('WebSocket Gateway inicializado.');
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  // Puedes crear un método para suscribir a un cliente a un chat específico si lo necesitas.
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

    this.logger.log(
      `Cliente ${client.id} se ha suscrito al chat ${conversationId}`,
    );
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
