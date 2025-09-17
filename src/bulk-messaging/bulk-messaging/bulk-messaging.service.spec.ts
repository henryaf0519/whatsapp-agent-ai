import { Test, TestingModule } from '@nestjs/testing';
import { BulkMessagingService } from './bulk-messaging.service';

describe('BulkMessagingService', () => {
  let service: BulkMessagingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BulkMessagingService],
    }).compile();

    service = module.get<BulkMessagingService>(BulkMessagingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
