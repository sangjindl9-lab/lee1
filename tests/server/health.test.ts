import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.cleanup();
});

describe('GET /api/health', () => {
  it('200과 { ok: true }를 응답한다', async () => {
    const response = await request(ctx.app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ ok: true });
  });

  it('정의되지 않은 API 경로는 404 NOT_FOUND와 한국어 메시지를 응답한다', async () => {
    const response = await request(ctx.app).get('/api/unknown');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: '요청한 API 경로를 찾을 수 없습니다.' },
    });
  });

  it('node 환경에서 실행된다', () => {
    expect(typeof window).toBe('undefined');
  });
});
