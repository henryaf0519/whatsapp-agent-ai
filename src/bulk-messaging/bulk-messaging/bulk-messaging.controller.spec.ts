import { Test, TestingModule } from '@nestjs/testing';
import { BulkMessagingController } from './bulk-messaging.controller';

describe('BulkMessagingController', () => {
  let controller: BulkMessagingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BulkMessagingController],
    }).compile();

    controller = module.get<BulkMessagingController>(BulkMessagingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
