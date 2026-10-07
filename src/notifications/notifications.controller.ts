import { Controller, Get, Post, Body, Param, Request, HttpCode } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiBody, ApiParam,
} from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service.js';

class InviteActionDto {
  @ApiProperty({ enum: ['accept', 'reject'] })
  @IsIn(['accept', 'reject'])
  action: 'accept' | 'reject';
}

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List notifikasi user',
    description: 'Mengembalikan notifikasi yang di-generate dari undangan workspace pending, budget alerts, dan tips.',
  })
  @ApiOkResponse({
    description: 'List notifikasi + unreadCount',
    schema: {
      example: {
        unreadCount: 1,
        notifications: [{
          id: 'invite_uuid', type: 'invite', emoji: '👥',
          title: 'Undangan Workspace', body: 'Budi mengundang kamu...',
          isRead: false, createdAt: '2026-09-24T00:00:00.000Z',
          inviteId: 'uuid', workspaceId: 'uuid',
          actions: [{ type: 'accept', label: 'Terima' }, { type: 'reject', label: 'Tolak' }],
        }],
      },
    },
  })
  getAll(@Request() req: { user: { id: string } }) {
    return this.svc.getForUser(req.user.id);
  }

  @Post('invites/:inviteId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Terima atau tolak undangan workspace' })
  @ApiParam({ name: 'inviteId', description: 'ID dari workspace_invitations' })
  @ApiBody({ type: InviteActionDto })
  @ApiOkResponse({
    description: 'Hasil aksi',
    schema: { example: { message: 'Berhasil bergabung ke workspace!' } },
  })
  async handleInvite(
    @Request()           req:      { user: { id: string } },
    @Param('inviteId')   inviteId: string,
    @Body()              dto:      InviteActionDto,
  ) {
    if (dto.action === 'accept') {
      return this.svc.acceptInvite(inviteId, req.user.id);
    }
    return this.svc.rejectInvite(inviteId, req.user.id);
  }
}
