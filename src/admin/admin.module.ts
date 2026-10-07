import { Module }          from '@nestjs/common';
import { TypeOrmModule }   from '@nestjs/typeorm';
import { User }            from '../users/user.entity.js';
import { Subscription }    from '../subscriptions/subscription.entity.js';
import { AdminService }    from './admin.service.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports:     [TypeOrmModule.forFeature([User, Subscription])],
  providers:   [AdminService],
  controllers: [AdminController],
  exports:     [AdminService],
})
export class AdminModule {}
