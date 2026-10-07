import { Module }                from '@nestjs/common';
import { TypeOrmModule }         from '@nestjs/typeorm';
import { User }                  from '../users/user.entity.js';
import { SuperAdminService }     from './super-admin.service.js';
import { SuperAdminController }  from './super-admin.controller.js';

@Module({
  imports:     [TypeOrmModule.forFeature([User])],
  providers:   [SuperAdminService],
  controllers: [SuperAdminController],
})
export class SuperAdminModule {}
