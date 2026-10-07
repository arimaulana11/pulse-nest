import { Controller, Get, Post, Request, HttpCode } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiCreatedResponse,
} from '@nestjs/swagger';
import { StreakService } from './streak.service.js';

@ApiTags('Streak')
@ApiBearerAuth('access-token')
@Controller('streak')
export class StreakController {
  constructor(private readonly svc: StreakService) {}

  @Get()
  @ApiOperation({
    summary: 'Ambil data streak user',
    description: 'Mengembalikan streak aktif, rekor terpanjang, status hari ini, dan dots 7 hari terakhir.',
  })
  @ApiOkResponse({
    description: 'Data streak',
    schema: {
      example: {
        currentCount:    5,
        longestCount:    7,
        lastActiveOn:    '2026-09-25',
        silentModeReady: false,
        daysThisWeek:    [
          { label: 'Sen', done: true  },
          { label: 'Sel', done: true  },
          { label: 'Rab', done: true  },
          { label: 'Kam', done: true  },
          { label: 'Jum', done: true  },
          { label: 'Sab', done: false },
          { label: 'Min', done: false },
        ],
        touchedToday:  true,
        isNewRecord:   false,
      },
    },
  })
  getStreak(@Request() req: { user: { id: string } }) {
    return this.svc.getStreak(req.user.id);
  }

  @Post('touch')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Touch streak — catat bahwa user aktif hari ini',
    description: 'Idempotent: panggil setiap kali user buka app. Tidak berubah jika sudah di-touch hari ini.',
  })
  @ApiOkResponse({
    description: 'Streak diperbarui',
    schema: {
      example: {
        currentCount: 6, longestCount: 7, lastActiveOn: '2026-09-25',
        silentModeReady: false, touchedToday: true, isNewRecord: false,
      },
    },
  })
  touchStreak(@Request() req: { user: { id: string } }) {
    return this.svc.touchStreak(req.user.id);
  }
}
