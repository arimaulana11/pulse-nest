/**
 * Vercel Serverless Entry Point for NestJS
 *
 * Vercel invokes this file as a serverless function.
 * We bootstrap the NestJS app once and reuse it across warm invocations.
 */
import 'reflect-metadata';
import { NestFactory }     from '@nestjs/core';
import { ValidationPipe }  from '@nestjs/common';
import { ExpressAdapter }  from '@nestjs/platform-express';
import { AppModule }       from '../src/app.module';
import express             from 'express';
import type { Request, Response } from 'express';

// Cache the app instance across warm Lambda/serverless invocations
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

  const frontendUrl      = process.env.FRONTEND_URL      ?? 'http://localhost:3000';
  const dashboardUrl     = process.env.DASHBOARD_ADMIN_URL ?? 'http://localhost:2000';
  const vercelPreviewRe  = /https:\/\/.*\.vercel\.app$/;

  app.enableCors({
    origin: (origin, cb) => {
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

// Vercel calls this as the default export handler
export default async function handler(req: Request, res: Response) {
  const app = await bootstrap();
  app(req, res);
}
