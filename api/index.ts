/**
 * Vercel Serverless Entry Point for NestJS
 */
import 'reflect-metadata';
import { NestFactory }     from '@nestjs/core';
import { ValidationPipe }  from '@nestjs/common';
import { ExpressAdapter }  from '@nestjs/platform-express';
import express             from 'express';
import type { Request, Response } from 'express';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');

let cachedApp: express.Express | null = null;

async function bootstrap(): Promise<express.Express> {
  if (cachedApp) return cachedApp;

  const server  = express();
  const adapter = new ExpressAdapter(server);

  const app = await NestFactory.create(AppModule, adapter, {
    logger: ['error', 'warn'],
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const frontendUrl     = process.env.FRONTEND_URL      ?? 'http://localhost:3000';
  const dashboardUrl    = process.env.DASHBOARD_ADMIN_URL ?? 'http://localhost:2000';
  const vercelPreviewRe = /https:\/\/.*\.vercel\.app$/;

  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (
        !origin ||
        origin === frontendUrl ||
        origin === dashboardUrl ||
        vercelPreviewRe.test(origin) ||
        origin.startsWith('http://localhost')
      ) {
        cb(null, true);
      } else {
        cb(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');
  await app.init();

  cachedApp = server;
  return server;
}

export default async function handler(req: Request, res: Response) {
  const app = await bootstrap();
  app(req, res);
}
