import { Test, TestingModule } from '@nestjs/testing';
import { SemanticCacheService } from './semantic-cache.service';

describe('SemanticCacheService', () => {
  let service: SemanticCacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SemanticCacheService],
    }).compile();

    service = module.get<SemanticCacheService>(SemanticCacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
