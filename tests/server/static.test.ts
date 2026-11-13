import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createStore } from '../../src/server/store';

// 빌드한 화면 폴더를 임시 폴더에 흉내 내어 정적 파일 제공과 index.html 대체 응답을 검증합니다.

const INDEX_HTML = '<!doctype html><html lang="ko"><body><div id="root"></div></body></html>';

let tmpRoot: string;
let clientDir: string;
let app: Express;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'bohal-static-'));
  clientDir = path.join(tmpRoot, 'client');
  mkdirSync(path.join(clientDir, 'assets'), { recursive: true });
  writeFileSync(path.join(clientDir, 'index.html'), INDEX_HTML, 'utf8');
  writeFileSync(path.join(clientDir, 'assets', 'app.js'), 'console.log("화면");', 'utf8');
  app = createApp(createStore(path.join(tmpRoot, 'data')), { clientDir });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('빌드한 화면 제공', () => {
  it('GET / 는 index.html을 응답한다', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('<div id="root"></div>');
  });

  it('화면 폴더의 파일을 그대로 제공한다', async () => {
    const response = await request(app).get('/assets/app.js');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.text).toContain('화면');
  });

  it('/api가 아닌 없는 경로는 index.html을 응답한다', async () => {
    const response = await request(app).get('/projects/abc');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('id="root"');
  });

  it('API 경로는 화면보다 먼저 처리된다', async () => {
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });

    const unknown = await request(app).get('/api/unknown');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
  });

  it('GET이 아닌 요청에는 index.html을 응답하지 않는다', async () => {
    const response = await request(app).post('/projects/abc').send({});

    expect(response.status).toBe(404);
    expect(response.text).not.toContain('id="root"');
  });

  it('화면 폴더가 없으면 API만 제공한다', async () => {
    const apiOnly = createApp(createStore(path.join(tmpRoot, 'data2')), { clientDir: null });

    expect((await request(apiOnly).get('/api/health')).status).toBe(200);
    expect((await request(apiOnly).get('/')).status).toBe(404);
  });

  it('index.html이 없는 폴더를 지정해도 오류 없이 API만 제공한다', async () => {
    const apiOnly = createApp(createStore(path.join(tmpRoot, 'data3')), { clientDir: path.join(tmpRoot, 'none') });

    expect((await request(apiOnly).get('/api/health')).status).toBe(200);
    expect((await request(apiOnly).get('/')).status).toBe(404);
  });
});
