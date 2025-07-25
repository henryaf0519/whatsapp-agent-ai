import { Test, TestingModule } from '@nestjs/testing';
import { S3ConversationLogService } from './s3-conversation-log.service';

describe('S3ConversationLogService', () => {
  let service: S3ConversationLogService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [S3ConversationLogService],
    }).compile();

    service = module.get<S3ConversationLogService>(S3ConversationLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
