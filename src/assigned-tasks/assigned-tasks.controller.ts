import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Request, HttpCode,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiCreatedResponse, ApiBody, ApiParam,
} from '@nestjs/swagger';
import { AssignedTasksService } from './assigned-tasks.service.js';
import {
  CreateAssignedTaskDto,
  AssignTaskDto,
  BulkAssignTaskDto,
  UpdateAssignmentProgressDto,
} from './dto/assigned-task.dto.js';

// ── User inbox ────────────────────────────────────────────────────────────────

@ApiTags('Assigned Tasks – User')
@ApiBearerAuth('access-token')
@Controller('tasks')
export class AssignedTasksUserController {
  constructor(private readonly svc: AssignedTasksService) {}

  @Get()
  @ApiOperation({ summary: 'Inbox task yang di-assign ke user ini' })
  @ApiOkResponse({ description: 'Daftar assignments dengan status pending & completed' })
  getInbox(@Request() req: { user: { id: string } }) {
    return this.svc.userGetInbox(req.user.id);
  }

  @Get('unread')
  @ApiOperation({ summary: 'Jumlah task yang belum dibaca (untuk badge navbar)' })
  getUnread(@Request() req: { user: { id: string } }) {
    return this.svc.userUnreadCount(req.user.id);
  }

  @Get(':assignmentId')
  @ApiOperation({ summary: 'Detail satu assignment' })
  @ApiParam({ name: 'assignmentId' })
  getOne(
    @Request()                req: { user: { id: string } },
    @Param('assignmentId')    assignmentId: string,
  ) {
    return this.svc.userGetAssignment(req.user.id, assignmentId);
  }

  @Patch(':assignmentId/progress')
  @ApiOperation({ summary: 'Update progress assignment (user mengerjakan task)' })
  @ApiParam({ name: 'assignmentId' })
  @ApiBody({ type: UpdateAssignmentProgressDto })
  updateProgress(
    @Request()             req: { user: { id: string } },
    @Param('assignmentId') assignmentId: string,
    @Body()                dto: UpdateAssignmentProgressDto,
  ) {
    return this.svc.userUpdateProgress(req.user.id, assignmentId, dto);
  }
}

// ── Admin CRUD ────────────────────────────────────────────────────────────────

@ApiTags('Assigned Tasks – Admin')
@ApiBearerAuth('access-token')
@Controller('admin/tasks')
export class AssignedTasksAdminController {
  constructor(private readonly svc: AssignedTasksService) {}

  // ── List users yang bisa di-assign ───────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'List semua user (untuk dropdown saat assign)' })
  listUsers() {
    return this.svc.adminListUsers();
  }

  // ── Task templates ────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Buat task baru' })
  @ApiBody({ type: CreateAssignedTaskDto })
  @ApiCreatedResponse({ description: 'Task berhasil dibuat' })
  create(
    @Request() req: { user: { id: string } },
    @Body()    dto: CreateAssignedTaskDto,
  ) {
    return this.svc.adminCreateTask(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List semua task yang dibuat admin ini' })
  list(@Request() req: { user: { id: string } }) {
    return this.svc.adminListTasks(req.user.id);
  }

  @Get(':taskId')
  @ApiOperation({ summary: 'Detail task + semua assignments-nya' })
  @ApiParam({ name: 'taskId' })
  getTask(@Param('taskId') taskId: string) {
    return this.svc.adminGetTask(taskId);
  }

  @Patch(':taskId')
  @ApiOperation({ summary: 'Update task template' })
  @ApiParam({ name: 'taskId' })
  @ApiBody({ type: CreateAssignedTaskDto })
  updateTask(
    @Param('taskId') taskId: string,
    @Body()          dto: Partial<CreateAssignedTaskDto>,
  ) {
    return this.svc.adminUpdateTask(taskId, dto);
  }

  @Delete(':taskId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Arsipkan task (soft delete)' })
  @ApiParam({ name: 'taskId' })
  archiveTask(@Param('taskId') taskId: string) {
    return this.svc.adminArchiveTask(taskId);
  }

  // ── Assign / unassign ────────────────────────────────────────────────

  @Post(':taskId/assign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Assign task ke satu user' })
  @ApiParam({ name: 'taskId' })
  @ApiBody({ type: AssignTaskDto })
  assign(
    @Request()           req: { user: { id: string } },
    @Param('taskId')     taskId: string,
    @Body()              dto: AssignTaskDto,
  ) {
    return this.svc.adminAssignTask(taskId, req.user.id, dto);
  }

  @Post(':taskId/assign/bulk')
  @HttpCode(200)
  @ApiOperation({ summary: 'Assign task ke banyak user sekaligus' })
  @ApiParam({ name: 'taskId' })
  @ApiBody({ type: BulkAssignTaskDto })
  bulkAssign(
    @Request()       req: { user: { id: string } },
    @Param('taskId') taskId: string,
    @Body()          dto: BulkAssignTaskDto,
  ) {
    return this.svc.adminBulkAssign(taskId, req.user.id, dto);
  }

  @Delete(':taskId/assign/:userId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cabut assignment dari user tertentu' })
  @ApiParam({ name: 'taskId' })
  @ApiParam({ name: 'userId' })
  unassign(
    @Param('taskId') taskId: string,
    @Param('userId') userId: string,
  ) {
    return this.svc.adminUnassign(taskId, userId);
  }
}
