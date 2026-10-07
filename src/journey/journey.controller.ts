import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Request, HttpCode, Headers,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiOkResponse, ApiCreatedResponse, ApiUnauthorizedResponse,
  ApiNotFoundResponse, ApiBody, ApiParam,
} from '@nestjs/swagger';
import { JourneyService }     from './journey.service.js';
import { JourneySyncService }  from './journey-sync.service.js';
import { WorkspacesService }   from '../workspaces/workspaces.service.js';
import { contextFromWorkspace } from '../sheets/sheet-context.js';
import {
  UpdateTaskProgressDto,
  UpdateStageStatusDto,
  CreateTaskProgressDto,
  StartStageDto,
} from './dto/update-progress.dto.js';
import { RecordProgressDto } from './dto/progress.dto.js';

@ApiTags('Journey')
@ApiBearerAuth('access-token')
@Controller('journey')
export class JourneyController {
  constructor(
    private readonly svc:         JourneyService,
    private readonly journeySync: JourneySyncService,
    private readonly wsSvc:       WorkspacesService,
  ) {}

  /** Resolve SheetContext from X-Workspace-Id header, plus inject userName */
  private async ctx(userId: string, wsId?: string, userName?: string) {
    const ws  = await this.wsSvc.getActiveContext(userId, wsId);
    const ctx = contextFromWorkspace(ws);
    return { ...ctx, userName: userName ?? '' };
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET — Static routes first (must be before parameterized routes)
  // ════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({ summary: 'Seluruh journey state user' })
  @ApiOkResponse({ description: 'Array stages' })
  @ApiUnauthorizedResponse({ description: 'Token tidak valid' })
  async getJourney(
    @Request() req: { user: { id: string } },
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.getJourney(req.user.id, await this.ctx(req.user.id, wsId));
  }

  @Get('overview')
  @ApiOperation({ summary: 'Journey overview — semua stage dengan linked goals + summary total tabungan' })
  async getOverview(
    @Request() req: { user: { id: string } },
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.getOverview(req.user.id, await this.ctx(req.user.id, wsId));
  }

  @Get('stability/dana-darurat')
  @ApiOperation({ summary: 'Detail dana darurat (task progress + linked goal + milestones + deposit history)' })
  async getDanaDarurat(
    @Request() req: { user: { id: string } },
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.getDanaDarurat(req.user.id, await this.ctx(req.user.id, wsId));
  }

  // ════════════════════════════════════════════════════════════════════════
  // STAGE SYNC
  // ════════════════════════════════════════════════════════════════════════

  @Post('survival/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sync progress task Survival dari data transaksi' })
  async syncSurvival(
    @Request() req: { user: { id: string } },
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.journeySync.syncSurvival(req.user.id, await this.ctx(req.user.id, wsId));
  }

  @Post('stability/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sync progress task Stability' })
  async syncStability(
    @Request() req: { user: { id: string } },
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.journeySync.syncStability(req.user.id, await this.ctx(req.user.id, wsId));
  }

  @Post('saving/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sync progress task Saving' })
  async syncSaving(
    @Request() req: { user: { id: string } },
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.journeySync.syncSaving(req.user.id, await this.ctx(req.user.id, wsId));
  }

  @Post('growth/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sync progress task Growth (manual only)' })
  async syncGrowth(
    @Request() req: { user: { id: string } },
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.journeySync.syncGrowth(req.user.id, await this.ctx(req.user.id, wsId));
  }

  // ════════════════════════════════════════════════════════════════════════
  // GET — Parameterized routes (after static routes)
  // ════════════════════════════════════════════════════════════════════════

  @Get(':stageKey')
  @ApiOperation({ summary: 'Detail satu stage + tasks' })
  @ApiParam({ name: 'stageKey', enum: ['survival','stability','saving','growth'] })
  async getStage(
    @Request()         req:      { user: { id: string } },
    @Param('stageKey') stageKey: string,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.getStageByKey(req.user.id, stageKey, await this.ctx(req.user.id, wsId));
  }

  @Get(':stageKey/tasks')
  @ApiOperation({ summary: 'Tasks dari satu stage' })
  @ApiParam({ name: 'stageKey', enum: ['survival','stability','saving','growth'] })
  async getStageTasks(
    @Request()         req:      { user: { id: string } },
    @Param('stageKey') stageKey: string,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.getStageTasksByKey(req.user.id, stageKey, await this.ctx(req.user.id, wsId));
  }

  @Get(':stageKey/tasks/:taskKey')
  @ApiOperation({ summary: 'Detail satu task dalam stage' })
  @ApiParam({ name: 'stageKey' })
  @ApiParam({ name: 'taskKey', example: 'dana_darurat' })
  async getTask(
    @Request()         req:      { user: { id: string } },
    @Param('stageKey') stageKey: string,
    @Param('taskKey')  taskKey:  string,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.getTaskByKey(req.user.id, stageKey, taskKey, await this.ctx(req.user.id, wsId));
  }

  // ════════════════════════════════════════════════════════════════════════
  // POST — Create
  // ════════════════════════════════════════════════════════════════════════

  @Post('stage/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mulai stage (set status → active)' })
  @ApiBody({ type: StartStageDto })
  async startStage(
    @Request() req: { user: { id: string; name?: string } },
    @Body()    dto: StartStageDto,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.startStage(req.user.id, dto, await this.ctx(req.user.id, wsId, req.user.name));
  }

  @Post('task')
  @ApiOperation({ summary: 'Buat / force-set progress task' })
  @ApiBody({ type: CreateTaskProgressDto })
  @ApiCreatedResponse({ schema: { example: { message: 'Task progress dibuat/diperbarui', taskKey: 'dana_darurat', current: 500000, target: 3500000, status: 'in_progress', completed: false } } })
  async createTaskProgress(
    @Request() req: { user: { id: string; name?: string } },
    @Body()    dto: CreateTaskProgressDto,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.createTaskProgress(req.user.id, dto, await this.ctx(req.user.id, wsId, req.user.name));
  }

  // ════════════════════════════════════════════════════════════════════════
  // PATCH — Update
  // ════════════════════════════════════════════════════════════════════════

  @Patch('task')
  @ApiOperation({ summary: 'Update progress task (increment)' })
  @ApiBody({ type: UpdateTaskProgressDto })
  async updateTask(
    @Request() req: { user: { id: string; name?: string } },
    @Body()    dto: UpdateTaskProgressDto,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.updateTaskProgress(req.user.id, dto, await this.ctx(req.user.id, wsId, req.user.name));
  }

  @Patch('stage')
  @ApiOperation({ summary: 'Update status stage secara manual' })
  @ApiBody({ type: UpdateStageStatusDto })
  async updateStage(
    @Request() req: { user: { id: string; name?: string } },
    @Body()    dto: UpdateStageStatusDto,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.updateStageStatus(req.user.id, dto, await this.ctx(req.user.id, wsId, req.user.name));
  }

  // ════════════════════════════════════════════════════════════════════════
  // DELETE — Soft Delete (reset)
  // ════════════════════════════════════════════════════════════════════════

  @Delete('task/:taskKey')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset progress satu task (soft delete)' })
  @ApiParam({ name: 'taskKey', example: 'dana_darurat' })
  async resetTask(
    @Request()        req:     { user: { id: string } },
    @Param('taskKey') taskKey: string,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.resetTaskProgress(req.user.id, taskKey, await this.ctx(req.user.id, wsId));
  }

  @Delete('stage/:stageKey')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset seluruh stage + semua tasks-nya (soft delete)' })
  @ApiParam({ name: 'stageKey', enum: ['survival','stability','saving','growth'] })
  async resetStage(
    @Request()         req:      { user: { id: string } },
    @Param('stageKey') stageKey: string,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.resetStageProgress(req.user.id, stageKey, await this.ctx(req.user.id, wsId));
  }

  // ════════════════════════════════════════════════════════════════════════
  // MULTI-ALLOCATION PROGRESS ENGINE
  // ════════════════════════════════════════════════════════════════════════

  @Post('progress')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record progress multi-alokasi' })
  @ApiBody({ type: RecordProgressDto })
  async recordProgress(
    @Request() req: { user: { id: string; name?: string } },
    @Body()    dto: RecordProgressDto,
    @Headers('x-workspace-id') wsId?: string,
  ) {
    return this.svc.recordProgress(req.user.id, dto, await this.ctx(req.user.id, wsId, req.user.name));
  }
}
