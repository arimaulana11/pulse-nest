import { Module }            from '@nestjs/common';
import { JourneyService }    from './journey.service.js';
import { JourneyController } from './journey.controller.js';
import { JourneySyncService }              from './journey-sync.service.js';
import { JourneyProgressSheetsService }    from './journey-progress-sheets.service.js';
import { TransactionsModule }  from '../transactions/transactions.module.js';
import { BudgetModule }        from '../budget/budget.module.js';
import { SheetsModule }        from '../sheets/sheets.module.js';
import { WorkspacesModule }    from '../workspaces/workspaces.module.js';

@Module({
  imports:     [SheetsModule, TransactionsModule, BudgetModule, WorkspacesModule],
  controllers: [JourneyController],
  providers:   [JourneyService, JourneySyncService, JourneyProgressSheetsService],
  exports:     [JourneyService, JourneySyncService, JourneyProgressSheetsService],
})
export class JourneyModule {}
