import { Global, Module } from '@nestjs/common';
import { EmailService }    from './email.service.js';

/** Global so any module can inject EmailService without re-importing */
@Global()
@Module({
  providers: [EmailService],
  exports:   [EmailService],
})
export class EmailModule {}
