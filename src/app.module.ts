import { Module }        from '@nestjs/common';
import { APP_GUARD }     from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard }  from './auth/jwt-auth.guard.js';

// DB entities
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

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService) => {
        const databaseUrl = cfg.get<string>('DATABASE_URL');
        const isProduction = cfg.get('NODE_ENV') === 'production';

        if (databaseUrl && isProduction) {
          // Production: use @neondatabase/serverless as pg replacement
          // This is pure JS — no native binary needed
          const { Pool, neonConfig } = await import('@neondatabase/serverless');
          const { default: ws } = await import('ws');
          neonConfig.webSocketConstructor = ws;

          return {
            type:           'postgres',
            url:            databaseUrl,
            entities:       [User, ResetToken, Subscription, Workspace, Category],
            synchronize:    false,
            ssl:            { rejectUnauthorized: false },
            logging:        false,
            // Inject neon Pool as the pg driver
            driver:         Pool,
            extra: {
              max: 1,
              connectionTimeoutMillis: 8000,
            },
          } as object;
        }

        if (databaseUrl) {
          return {
            type:        'postgres',
            url:         databaseUrl,
            entities:    [User, ResetToken, Subscription, Workspace, Category],
            synchronize: false,
            ssl:         { rejectUnauthorized: false },
            logging:     false,
          };
        }

        return {
          type:        'postgres',
          host:        cfg.get('DB_HOST', 'localhost'),
          port:        cfg.get<number>('DB_PORT', 5432),
          username:    cfg.get('DB_USER', 'pulse_user'),
          password:    cfg.get('DB_PASS', 'pulse_secret'),
          database:    cfg.get('DB_NAME', 'pulse_db'),
          entities:    [User, ResetToken, Subscription, Workspace, Category],
          synchronize: false,
          logging:     true,
        };
      },
    }),

    AuthModule, UsersModule, SubscriptionsModule, SheetsModule,
    TransactionsModule, BudgetModule, JourneyModule, GoalsModule,
    WorkspacesModule, NotificationsModule, CategoriesModule,
    StreakModule, AdminModule, SuperAdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
