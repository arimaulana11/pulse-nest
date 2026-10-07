import { Module }          from '@nestjs/common';
import { GoalsService }    from './goals.service.js';
import { GoalsController } from './goals.controller.js';

// DataSource provided globally by TypeOrmModule in AppModule

@Module({
  controllers: [GoalsController],
  providers:   [GoalsService],
  exports:     [GoalsService],
})
export class GoalsModule {}
