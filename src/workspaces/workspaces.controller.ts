import {
  Controller, Get, Post, Delete,
  Body, Param, Request, HttpCode,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiCreatedResponse,
  ApiNotFoundResponse, ApiForbiddenResponse, ApiUnauthorizedResponse,
  ApiParam, ApiBody,
} from '@nestjs/swagger';
import { WorkspacesService }    from './workspaces.service.js';
import { CreateWorkspaceDto, InviteMemberDto, TestSheetDto } from './dto/workspace.dto.js';
import { Public } from '../auth/public.decorator.js';

const WS_EXAMPLE = {
  id: 'uuid-v4', name: 'Keluarga Maulana', slug: 'keluarga-maulana',
  type: 'family', emoji: '🏠', logoUrl: null,
};

const MEMBER_EXAMPLE = {
  id: 'uuid-member', userId: 'uuid-user',
  name: 'Budi Santoso', email: 'budi@example.com',
  avatarUrl: null, initials: 'BS',
  roleCode: 'bendahara', roleLabel: 'Bendahara',
  joinedAt: '2026-01-15T00:00:00.000Z',
};

@ApiTags('Workspaces')
@ApiBearerAuth('access-token')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly svc: WorkspacesService) {}

  @Get()
  @ApiOperation({
    summary: 'List semua workspace user',
    description: 'Mengembalikan workspace personal (selalu ada) ditambah semua workspace di mana user adalah member. Gunakan `activeWorkspaceId` untuk menentukan workspace default.',
  })
  @ApiOkResponse({
    description: 'List workspace',
    schema: {
      example: {
        activeWorkspaceId: 'personal',
        workspaces: [
          { id: 'personal', name: 'Personal', type: 'personal', emoji: '👤', slug: 'personal' },
          { ...WS_EXAMPLE },
        ],
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Token tidak valid' })
  async findAll(@Request() req: { user: { id: string } }) {
    const list = await this.svc.findAllForUser(req.user.id);
    return {
      activeWorkspaceId: 'personal',
      workspaces: [
        { id: 'personal', name: 'Personal', type: 'personal', emoji: '👤', slug: 'personal' },
        ...list.map((ws) => ({
          id: ws.id, name: ws.name, type: ws.type, emoji: ws.emoji, slug: ws.slug,
        })),
      ],
    };
  }

  @Post()
  @ApiOperation({
    summary: 'Buat workspace baru',
    description: 'Membuat workspace dan otomatis menambahkan creator sebagai Owner. Untuk workspace non-personal, isi `sheetId` dan `serviceAccountEmail` agar data keuangan disimpan ke Google Sheet workspace.',
  })
  @ApiBody({ type: CreateWorkspaceDto })
  @ApiCreatedResponse({
    description: 'Workspace berhasil dibuat',
    schema: { example: WS_EXAMPLE },
  })
  create(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.svc.create(req.user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detail workspace beserta anggota dan undangan pending',
    description: 'Mengembalikan data workspace lengkap. Hanya bisa diakses oleh member workspace tersebut.',
  })
  @ApiParam({ name: 'id', description: 'Workspace ID (UUID)' })
  @ApiOkResponse({
    description: 'Detail workspace',
    schema: {
      example: {
        workspace: WS_EXAMPLE,
        members: [MEMBER_EXAMPLE],
        pendingInvitations: [{
          id: 'uuid-invite', email: 'teman@example.com',
          roleLabel: 'Viewer', invitedByName: 'Budi Santoso',
          createdAt: '2026-09-20T00:00:00.000Z', expiresAt: '2026-10-04T00:00:00.000Z',
        }],
        roles: [
          { code: 'admin', label: 'Admin' },
          { code: 'bendahara', label: 'Bendahara' },
          { code: 'viewer', label: 'Viewer' },
        ],
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Workspace tidak ditemukan' })
  @ApiForbiddenResponse({ description: 'Bukan anggota workspace ini' })
  async getOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const [ws, members, pending] = await Promise.all([
      this.svc.findOne(id, req.user.id),
      this.svc.getMembers(id),
      this.svc.getPendingInvitations(id),
    ]);

    return {
      workspace: { id: ws.id, name: ws.name, slug: ws.slug, emoji: ws.emoji, type: ws.type, logoUrl: ws.logoUrl },
      members: members.map((m: Record<string, unknown>) => ({
        id: m['member_id'], userId: m['user_id'], name: m['name'], email: m['email'],
        avatarUrl: m['avatar_url'],
        initials: String(m['name'] ?? '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase(),
        roleCode: m['role_code'], roleLabel: m['role_label'], joinedAt: m['joined_at'],
      })),
      pendingInvitations: pending.map((i: Record<string, unknown>) => ({
        id: i['id'], email: i['email'], roleLabel: i['role_label'],
        invitedByName: i['invited_by_name'], createdAt: i['created_at'], expiresAt: i['expires_at'],
      })),
      roles: [
        { code: 'admin',     label: 'Admin'     },
        { code: 'bendahara', label: 'Bendahara' },
        { code: 'viewer',    label: 'Viewer'    },
      ],
    };
  }

  @Post(':id/invite')
  @ApiOperation({
    summary: 'Undang anggota baru via email',
    description: 'Membuat invitation token dan menyimpannya. Hanya Owner dan Admin yang bisa mengundang. Undangan berlaku 14 hari.',
  })
  @ApiParam({ name: 'id', description: 'Workspace ID' })
  @ApiBody({ type: InviteMemberDto })
  @ApiCreatedResponse({
    description: 'Undangan berhasil dibuat',
    schema: { example: { message: 'Undangan dikirim ke teman@example.com', token: 'hex-token-64-chars' } },
  })
  @ApiForbiddenResponse({ description: 'Hanya Owner / Admin yang bisa mengundang' })
  invite(
    @Request()   req: { user: { id: string } },
    @Param('id') id:  string,
    @Body()      dto: InviteMemberDto,
  ) {
    return this.svc.invite(id, req.user.id, dto);
  }

  @Delete(':id/invitations/:inviteId')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Batalkan undangan pending',
    description: 'Mengubah status undangan ke `expired`. Hanya Owner dan Admin yang bisa membatalkan.',
  })
  @ApiParam({ name: 'id', description: 'Workspace ID' })
  @ApiParam({ name: 'inviteId', description: 'Invitation ID' })
  @ApiOkResponse({
    description: 'Undangan dibatalkan',
    schema: { example: { message: 'Undangan dibatalkan' } },
  })
  @ApiForbiddenResponse({ description: 'Hanya Owner / Admin yang bisa membatalkan undangan' })
  cancelInvite(
    @Request()         req:      { user: { id: string } },
    @Param('id')       id:       string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.svc.cancelInvite(id, inviteId, req.user.id);
  }

  @Public()
  @Post('test-sheet')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Test koneksi Google Sheet',
    description: 'Mencoba membaca tab yang ditentukan dari spreadsheet. Gunakan saat setup workspace untuk verifikasi Sheet ID dan akses service account sudah benar.',
  })
  @ApiBody({ type: TestSheetDto })
  @ApiOkResponse({
    description: 'Hasil test koneksi',
    schema: {
      example: { ok: true, message: 'Koneksi berhasil!' },
    },
  })
  testSheet(@Body() dto: TestSheetDto) {
    return this.svc.testSheet(dto.sheetId, dto.tabName);
  }
}
