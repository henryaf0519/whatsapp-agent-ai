import { Test, TestingModule } from '@nestjs/testing';
import { DynamoService } from './dynamo.service';
import { ConfigService } from '@nestjs/config';

describe('DynamoService', () => {
  let service: DynamoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamoService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<DynamoService>(DynamoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('generarSlots should return an array of slots without Promise', () => {
    const slots = service.generarSlots(8, 10, 60, 12, 13, '2024-01-01');
    expect(Array.isArray(slots)).toBe(true);
    expect(slots).not.toBeInstanceOf(Promise);
  });
});
