import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { ConfigService } from '@nestjs/config';

export interface ConversationRecord {
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

@Injectable()
export class S3ConversationLogService {
  private readonly logger = new Logger(S3ConversationLogService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET')!;
    this.s3 = new S3Client({
      region: this.config.get<string>('AWS_REGION'),
    });
  }

  async saveConversation(threadId: string, records: ConversationRecord[]) {
    const key = `conversations/${threadId}.json`;
    const body = JSON.stringify(records, null, 2);

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
        }),
      );
      this.logger.log(`Saved full conversation to S3: ${key}`);
    } catch (err) {
      this.logger.error(`Failed saving conversation to S3: ${key}`, err as any);
    }
  }

  async log(record: ConversationRecord) {
    const key = `conversations/${record.threadId}/${record.timestamp}.json`;
    const body = JSON.stringify(record, null, 2);
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
        }),
      );
      this.logger.log(`Logged to S3: ${key}`);
    } catch (err) {
      this.logger.error(`Failed to log to S3: ${key}`, err as any);
    }
  }

  // (opcional) lee todo el hilo
  async fetchByThread(threadId: string): Promise<ConversationRecord[]> {
    const prefix = `conversations/${threadId}/`;
    const list = await this.s3.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }),
    );
    const records: ConversationRecord[] = [];
    if (!list.Contents) return records;
    for (const obj of list.Contents) {
      const get = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: obj.Key! }),
      );
      const stream = get.Body as Readable;
      const json = await this.streamToString(stream);
      records.push(JSON.parse(json));
    }
    return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  private streamToString(stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
  }
}
