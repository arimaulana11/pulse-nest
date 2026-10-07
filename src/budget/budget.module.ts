import { Module }            from '@nestjs/common';
import { BudgetService }     from './budget.service.js';
import { BudgetController }  from './budget.controller.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { WorkspacesModule }  from '../workspaces/workspaces.module.js';

@Module({
  imports:     [TransactionsModule, WorkspacesModule],
  controllers: [BudgetController],
  providers:   [BudgetService],
  exports:     [BudgetService],
})
export class BudgetModule {}
