import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { OpenCodeHTTPClient } from './client.js';
import { OpenCodeError } from '@loopy/core';

const BASE_URL = 'http://localhost:3000';
const WORKTREE = '/tmp/test-worktree';

describe('OpenCodeHTTPClient', () => {
  let client: OpenCodeHTTPClient;

  beforeEach(() => {
    client = new OpenCodeHTTPClient(BASE_URL);
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('createSession', () => {
    it('sends X-OpenCode-Directory header', async () => {
      const scope = nock(BASE_URL)
        .post('/session', { title: 'loopy' })
        .matchHeader('X-OpenCode-Directory', WORKTREE)
        .reply(200, { id: 'sess-1', directory: WORKTREE });

      const session = await client.createSession(WORKTREE);

      expect(scope.isDone()).toBe(true);
      expect(session.id).toBe('sess-1');
      expect(session.worktreePath).toBe(WORKTREE);
      expect(session.status).toBe('idle');
    });
  });

  describe('sendPrompt', () => {
    it('sends correct body', async () => {
      const scope = nock(BASE_URL)
        .post('/session/sess-1/prompt_async', { parts: [{ type: 'text', text: 'hello world' }] })
        .reply(200, {});

      await client.sendPrompt('sess-1', 'hello world');
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('waitForIdle', () => {
    it('returns successfully when session becomes idle', async () => {
      const scope = nock(BASE_URL)
        .get('/session/sess-1')
        .reply(200, { status: 'idle' });

      await client.waitForIdle('sess-1', 5000);
      expect(scope.isDone()).toBe(true);
    });

    it('throws OpenCodeError with code SESSION_TIMEOUT when exceeding timeoutMs', async () => {
      nock(BASE_URL)
        .get('/session/sess-1')
        .delay(100)
        .reply(200, { status: 'running' });

      nock(BASE_URL)
        .post('/session/sess-1/abort')
        .reply(200, {});

      const error = await client.waitForIdle('sess-1', 50).then(
        () => { throw new Error('should have thrown'); },
        (e: unknown) => e as OpenCodeError,
      );

      expect(error).toBeInstanceOf(OpenCodeError);
      expect(error.code).toBe('SESSION_TIMEOUT');
    });
  });

  describe('getMessages', () => {
    it('returns empty array (stub implementation)', async () => {
      const messages = await client.getMessages('sess-1');
      expect(messages).toEqual([]);
    });

    it('returns empty array with sinceMessageId (stub implementation)', async () => {
      const messages = await client.getMessages('sess-1', 'msg-5');
      expect(messages).toEqual([]);
    });
  });

  describe('replyPermission', () => {
    it('sends allow decision', async () => {
      const scope = nock(BASE_URL)
        .post('/session/sess-1/permissions/req-1', { response: 'allow', remember: true })
        .reply(200, {});

      await client.replyPermission('sess-1', 'req-1', 'allow');
      expect(scope.isDone()).toBe(true);
    });

    it('sends deny decision', async () => {
      const scope = nock(BASE_URL)
        .post('/session/sess-1/permissions/req-2', { response: 'deny', remember: true })
        .reply(200, {});

      await client.replyPermission('sess-1', 'req-2', 'deny');
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('abortSession', () => {
    it('calls abort endpoint', async () => {
      const scope = nock(BASE_URL)
        .post('/session/sess-1/abort')
        .reply(200, {});

      await client.abortSession('sess-1');
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('error mapping', () => {
    it('maps network errors to CONNECTION_REFUSED', async () => {
      nock(BASE_URL).post('/session').replyWithError({ code: 'ECONNREFUSED' });

      const error = await client.createSession(WORKTREE).then(
        () => { throw new Error('should have thrown'); },
        (e: unknown) => e as OpenCodeError,
      );

      expect(error).toBeInstanceOf(OpenCodeError);
      expect(error.code).toBe('CONNECTION_REFUSED');
    });

    it('maps 404 to SESSION_NOT_FOUND', async () => {
      nock(BASE_URL).get('/session/sess-missing').reply(404, 'not found');

      const error = await client.waitForIdle('sess-missing', 5000).then(
        () => { throw new Error('should have thrown'); },
        (e: unknown) => e as OpenCodeError,
      );

      expect(error).toBeInstanceOf(OpenCodeError);
      expect(error.code).toBe('SESSION_NOT_FOUND');
    });

    it('maps 403 to PERMISSION_DENIED', async () => {
      nock(BASE_URL).post('/session/sess-1/prompt_async').reply(403, 'forbidden');

      const error = await client.sendPrompt('sess-1', 'test').then(
        () => { throw new Error('should have thrown'); },
        (e: unknown) => e as OpenCodeError,
      );

      expect(error).toBeInstanceOf(OpenCodeError);
      expect(error.code).toBe('PERMISSION_DENIED');
    });

    it('maps 5xx to SERVER_ERROR', async () => {
      nock(BASE_URL).post('/session').reply(500, 'internal error');

      const error = await client.createSession(WORKTREE).then(
        () => { throw new Error('should have thrown'); },
        (e: unknown) => e as OpenCodeError,
      );

      expect(error).toBeInstanceOf(OpenCodeError);
      expect(error.code).toBe('SERVER_ERROR');
    });

    it('maps other status codes to UNKNOWN', async () => {
      nock(BASE_URL).post('/session').reply(418, 'teapot');

      const error = await client.createSession(WORKTREE).then(
        () => { throw new Error('should have thrown'); },
        (e: unknown) => e as OpenCodeError,
      );

      expect(error).toBeInstanceOf(OpenCodeError);
      expect(error.code).toBe('UNKNOWN');
    });
  });

  describe('pollPermissionsAndApprove', () => {
    it.skip('auto-approves when autoApprove is true', async () => {
      const approveClient = new OpenCodeHTTPClient(BASE_URL, { autoApprove: true });
      let permissionCallCount = 0;

      nock(BASE_URL)
        .get('/api/session/status')
        .reply(200, { 'sess-1': { permissions: [{ id: 'req-1' }] } });

      nock(BASE_URL)
        .post('/session/sess-1/permissions/req-1', { response: 'allow', remember: true })
        .reply(200, () => {
          permissionCallCount++;
          return {};
        });

      const { stop } = approveClient.pollPermissionsAndApprove('sess-1', 50);

      await new Promise((r) => setTimeout(r, 100));
      stop();
      expect(permissionCallCount).toBe(1);
    });

    it.skip('does NOT approve when autoApprove is false', async () => {
      const noApproveClient = new OpenCodeHTTPClient(BASE_URL, { autoApprove: false });
      let approvalAttempted = false;

      nock(BASE_URL)
        .get('/api/session/status')
        .reply(200, { 'sess-1': { permissions: [{ id: 'req-1' }] } });

      nock(BASE_URL)
        .post('/session/sess-1/permissions/req-1', { response: 'allow', remember: true })
        .reply(200, () => {
          approvalAttempted = true;
          return {};
        });

      const { stop } = noApproveClient.pollPermissionsAndApprove('sess-1', 50);

      await new Promise((r) => setTimeout(r, 100));
      stop();
      expect(approvalAttempted).toBe(false);
    });
  });
});