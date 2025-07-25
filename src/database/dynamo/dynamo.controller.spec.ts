import { Test, TestingModule } from '@nestjs/testing';
import { DynamoController } from './dynamo.controller';

describe('DynamoController', () => {
  let controller: DynamoController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DynamoController],
    }).compile();

    controller = module.get<DynamoController>(DynamoController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
