import { Controller, Get, Post, Patch, Body, Param, Request, HttpCode } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiBody, ApiParam,
} from '@nestjs/swagger';
import { IsIn, IsString, IsArray, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service.js';

class InviteActionDto {
  @ApiProperty({ enum: ['accept', 'reject'] })
  @IsIn(['accept', 'reject'])
  action: 'accept' | 'reject';
}

class MarkReadDto {
  @ApiPropertyOptional({ type: [String], description: 'Array ID notifikasi. Kosong = tandai semua.' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ids?: string[];
}

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifikasi user' })
  getAll(@Request() req: { user: { id: string } }) {
    return this.svc.getForUser(req.user.id);
  }

  @Post('invites/:inviteId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Terima atau tolak undangan workspace' })
  @ApiParam({ name: 'inviteId' })
  @ApiBody({ type: InviteActionDto })
  async handleInvite(
    @Request()           req:      { user: { id: string } },
    @Param('inviteId')   inviteId: string,
    @Body()              dto:      InviteActionDto,
  ) {
    if (dto.action === 'accept') return this.svc.acceptInvite(inviteId, req.user.id);
    return this.svc.rejectInvite(inviteId, req.user.id);
  }

  @Patch('read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tandai notifikasi sebagai sudah dibaca',
    description: 'Kirim { ids: [...] } untuk tandai spesifik, atau body kosong untuk tandai semua.',
  })
  @ApiBody({ type: MarkReadDto })
  markRead(
    @Request() req: { user: { id: string } },
    @Body()    dto: MarkReadDto,
  ) {
    return this.svc.markRead(req.user.id, dto.ids);
  }
}
