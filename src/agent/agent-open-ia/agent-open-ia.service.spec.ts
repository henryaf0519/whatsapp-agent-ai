import { Test, TestingModule } from '@nestjs/testing';
import { AgentOpenIaService } from './agent-open-ia.service';
import { ConfigService } from '@nestjs/config';
import { DynamoService } from 'src/database/dynamo/dynamo.service';

describe('AgentOpenIaService', () => {
  let service: AgentOpenIaService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      // Proporciona valores simulados para las variables de entorno
      if (key === 'OPENAI_API_KEY') return 'test_openai_key';
      if (key === 'PINECONE_API_KEY') return 'test_pinecone_key';
      if (key === 'PINECONE_INDEX') return 'test_pinecone_index';
      if (key === 'PINECONE_HOST') return 'test_pinecone_host';
      return null;
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AgentOpenIaService],
    }).compile();

    service = module.get<AgentOpenIaService>(AgentOpenIaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
