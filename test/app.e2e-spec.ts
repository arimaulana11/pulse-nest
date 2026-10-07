import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication }   from '@nestjs/common';
import * as request           from 'supertest';
import { AppModule }          from '../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  it('GET /api/v1/auth/me should return 401 without token', () => {
    return request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);
  });
});
