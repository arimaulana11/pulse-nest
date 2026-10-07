import { Module }               from '@nestjs/common';
import { TransactionsService }  from './transactions.service.js';
import { TransactionsController } from './transactions.controller.js';
import { WorkspacesModule }     from '../workspaces/workspaces.module.js';

@Module({
  imports:     [WorkspacesModule],
  controllers: [TransactionsController],
  providers:   [TransactionsService],
  exports:     [TransactionsService],
})
export class TransactionsModule {}
