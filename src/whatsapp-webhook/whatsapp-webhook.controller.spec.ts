import { Test, TestingModule } from '@nestjs/testing';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

describe('WhatsappWebhookController', () => {
  let controller: WhatsappWebhookController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsappWebhookController],
    }).compile();

    controller = module.get<WhatsappWebhookController>(WhatsappWebhookController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
