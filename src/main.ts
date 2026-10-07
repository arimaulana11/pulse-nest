import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS — allow localhost + network IP
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const dashboardAdminUrl = process.env.DASHBOARD_ADMIN_URL ?? 'http://localhost:2000';
  app.enableCors({
    origin: [
      frontendUrl,
      dashboardAdminUrl,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
    credentials: true,
  });

  // Global API prefix
  app.setGlobalPrefix('api/v1');

  // ── Swagger ────────────────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Pulse API')
    .setDescription(
      `## Personal Finance SaaS — REST API

Pulse API mengelola autentikasi, data pengguna, subscription, dan data keuangan (transaksi, anggaran, journey, goals) yang disimpan di Google Sheets.

### Autentikasi

Semua endpoint kecuali \`/auth/*\` memerlukan **Bearer token** di header:
\`\`\`
Authorization: Bearer <accessToken>
\`\`\`
Token didapat dari \`POST /auth/login\` atau \`POST /auth/google-oauth\`.

Klik tombol **Authorize 🔓** di kanan atas, masukkan token, lalu klik Authorize.

### Workspace Mode

Endpoint transaksi dan anggaran mendukung mode workspace. Kirim header tambahan:
\`\`\`
X-Workspace-Id: <workspace-uuid>
\`\`\`
Tanpa header ini, data dibaca/ditulis ke Google Sheet personal (global dari env).

### Base URL

\`/api/v1\`
      `,
    )
    .setVersion('1.0')
    .setContact('Pulse Dev', '', '')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Masukkan access token dari POST /auth/login',
        name: 'Authorization',
        in: 'header',
      },
      'access-token',
    )
    .addServer(`http://localhost:${process.env.PORT ?? 4000}`, 'Local Development')
    .addTag('Auth', 'Registrasi, login, reset password, dan profil pengguna')
    .addTag('Transactions', 'CRUD transaksi via Google Sheets')
    .addTag('Budget', 'Pos anggaran bulanan via Google Sheets')
    .addTag('Journey', 'Progress journey finansial via Google Sheets')
    .addTag('Goals', 'Financial goals & deposit history via Google Sheets')
    .addTag('Subscription', 'Plan, billing, dan feature access')
    .addTag('Workspaces', 'Workspace management, anggota, dan undangan')
    .addTag('Streak', 'Streak harian gamification')
    .addTag('Notifications', 'Notifikasi dan workspace invitations')
    .addTag('Categories', 'Kategori transaksi')
    .addTag('Admin', '🔐 Admin only — manajemen user, plan override, audit log')
    .addTag('Super Admin', '👑 Super Admin only — admin management, plans CRUD, features')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Pulse API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',          // collapse by default, expand on click
      filter: true,                  // enable search/filter box
      displayRequestDuration: true,  // show response time
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customCss: `
      .swagger-ui .topbar { background: #B25329; }
      .swagger-ui .topbar .download-url-wrapper { display: none; }
      .swagger-ui .info .title { color: #B25329; }
    `,
  });

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`🚀 Pulse API running on http://localhost:${port}/api/v1`);
  console.log(`📚 Swagger UI       → http://localhost:${port}/docs`);
  console.log(`📄 OpenAPI JSON     → http://localhost:${port}/docs-json`);
}

bootstrap();
