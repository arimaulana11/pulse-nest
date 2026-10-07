import { Module }              from '@nestjs/common';
import { TypeOrmModule }       from '@nestjs/typeorm';
import { Workspace }           from './workspace.entity.js';
import { WorkspacesService }   from './workspaces.service.js';
import { WorkspacesController } from './workspaces.controller.js';
import { SheetsModule }        from '../sheets/sheets.module.js';

@Module({
  imports:     [TypeOrmModule.forFeature([Workspace]), SheetsModule],
  providers:   [WorkspacesService],
  controllers: [WorkspacesController],
  exports:     [WorkspacesService],
})
export class WorkspacesModule {}
