import { Global, Module } from '@nestjs/common';
import { SheetsService }  from './sheets.service.js';

/** Global so every feature module can inject SheetsService without re-importing */
@Global()
@Module({
  providers: [SheetsService],
  exports:   [SheetsService],
})
export class SheetsModule {}
