import { Test, TestingModule } from '@nestjs/testing';
import { WhatsappTemplatesController } from './whatsapp-templates.controller';

describe('WhatsappTemplatesController', () => {
  let controller: WhatsappTemplatesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsappTemplatesController],
    }).compile();

    controller = module.get<WhatsappTemplatesController>(WhatsappTemplatesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
