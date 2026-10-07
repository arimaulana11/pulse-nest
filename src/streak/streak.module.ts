import { Module }           from '@nestjs/common';
import { StreakService }    from './streak.service.js';
import { StreakController } from './streak.controller.js';

@Module({
  providers:   [StreakService],
  controllers: [StreakController],
  exports:     [StreakService],
})
export class StreakModule {}
