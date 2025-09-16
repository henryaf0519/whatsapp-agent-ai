/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      throw new Error(
        'REDIS_URL no está configurada en las variables de entorno',
      );
    }

    this.client = createClient({
      url: redisUrl,
      socket: {
        tls: true,
        rejectUnauthorized: false,
      },
    });

    this.client.on('error', (err: Error) =>
      this.logger.error('Error del Cliente Redis', err),
    );
  }

  async onModuleInit() {
    await this.client.connect();
    this.logger.log('Conectado a Redis Cloud');
  }

  async onModuleDestroy() {
    await this.client?.quit();
    this.logger.log('Desconectado de Redis Cloud');
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      // EX establece el TTL en segundos
      await this.client.set(key, value, { EX: ttlSeconds });
    } else {
      await this.client.set(key, value);
    }
  }
}
