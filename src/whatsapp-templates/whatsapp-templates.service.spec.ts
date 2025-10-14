import { Test, TestingModule } from '@nestjs/testing';
import { WhatsappTemplatesService } from './whatsapp-templates.service';

describe('WhatsappTemplatesService', () => {
  let service: WhatsappTemplatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WhatsappTemplatesService],
    }).compile();

    service = module.get<WhatsappTemplatesService>(WhatsappTemplatesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
