import { Module }        from '@nestjs/common';
import { APP_GUARD }     from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard }  from './auth/jwt-auth.guard.js';

// DB entities (Postgres — auth + identity layer)
import { User }         from './users/user.entity.js';
import { ResetToken }   from './auth/reset-token.entity.js';
import { Subscription } from './subscriptions/subscription.entity.js';
import { Workspace }    from './workspaces/workspace.entity.js';
import { Category }     from './categories/category.entity.js';

// Feature modules
import { AuthModule }          from './auth/auth.module.js';
import { UsersModule }         from './users/users.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { SheetsModule }        from './sheets/sheets.module.js';
import { TransactionsModule }  from './transactions/transactions.module.js';
import { BudgetModule }        from './budget/budget.module.js';
import { JourneyModule }       from './journey/journey.module.js';
import { GoalsModule }         from './goals/goals.module.js';
import { WorkspacesModule }    from './workspaces/workspaces.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { CategoriesModule }    from './categories/categories.module.js';
import { StreakModule }        from './streak/streak.module.js';
import { AdminModule }         from './admin/admin.module.js';
import { SuperAdminModule }    from './super-admin/super-admin.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // ── PostgreSQL: identity + billing layer only ────────────────────────
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type:        'postgres',
        host:        cfg.get('DB_HOST', 'localhost'),
        port:        cfg.get<number>('DB_PORT', 5432),
        username:    cfg.get('DB_USER', 'pulse_user'),
        password:    cfg.get('DB_PASS', 'pulse_secret'),
        database:    cfg.get('DB_NAME', 'pulse_db'),
        entities:    [User, ResetToken, Subscription, Workspace, Category],
        synchronize: false,
        logging:     cfg.get('NODE_ENV') === 'development',
      }),
    }),

    // ── Modules ─────────────────────────────────────────────────────────
    AuthModule,
    UsersModule,
    SubscriptionsModule,
    SheetsModule,
    TransactionsModule,
    BudgetModule,
    JourneyModule,
    GoalsModule,
    WorkspacesModule,
    NotificationsModule,
    CategoriesModule,
    StreakModule,
    AdminModule,
    SuperAdminModule,
  ],
  providers: [
    // Apply JwtAuthGuard globally — every route is protected by default.
    // Use @Public() decorator on individual routes to opt out (e.g. login, register).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
