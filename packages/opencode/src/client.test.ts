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
        .post('/api/session')
        .matchHeader('X-OpenCode-Directory', WORKTREE)
        .reply(200, { id: 'sess-1', url: `${BASE_URL}/session/sess-1`, createdAt: '2026-01-01T00:00:00Z' });

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
        .post('/api/session/sess-1/prompt', { content: 'hello world' })
        .reply(200, {});

      await client.sendPrompt('sess-1', 'hello world');
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('waitForIdle', () => {
    it('returns successfully when session becomes idle', async () => {
      const scope = nock(BASE_URL)
        .post('/api/session/sess-1/wait')
        .reply(200, {});

      await client.waitForIdle('sess-1', 5000);
      expect(scope.isDone()).toBe(true);
    });

    it('throws OpenCodeError with code SESSION_TIMEOUT when exceeding timeoutMs', async () => {
      nock(BASE_URL)
        .post('/api/session/sess-1/wait')
        .delayConnection(2000)
        .reply(200, {});

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
    it('sends correct query params without sinceMessageId', async () => {
      const scope = nock(BASE_URL)
        .get('/api/session/sess-1/message?order=asc&limit=100')
        .reply(200, [{ id: 'msg-1', role: 'user', content: 'hello' }]);

      const messages = await client.getMessages('sess-1');
      expect(scope.isDone()).toBe(true);
      expect(messages).toHaveLength(1);
    });

    it('sends after query param when sinceMessageId is provided', async () => {
      const scope = nock(BASE_URL)
        .get('/api/session/sess-1/message?order=asc&limit=100&after=msg-5')
        .reply(200, [{ id: 'msg-6', role: 'assistant', content: 'response' }]);

      const messages = await client.getMessages('sess-1', 'msg-5');
      expect(scope.isDone()).toBe(true);
      expect(messages).toHaveLength(1);
    });
  });

  describe('replyPermission', () => {
    it('sends allow decision', async () => {
      const scope = nock(BASE_URL)
        .post('/api/session/sess-1/permission/req-1/reply', { decision: 'allow' })
        .reply(200, {});

      await client.replyPermission('sess-1', 'req-1', 'allow');
      expect(scope.isDone()).toBe(true);
    });

    it('sends deny decision', async () => {
      const scope = nock(BASE_URL)
        .post('/api/session/sess-1/permission/req-2/reply', { decision: 'deny' })
        .reply(200, {});

      await client.replyPermission('sess-1', 'req-2', 'deny');
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('abortSession', () => {
    it('calls v1 abort endpoint', async () => {
      const scope = nock(BASE_URL)
        .post('/session/sess-1/abort')
        .reply(200, {});

      await client.abortSession('sess-1');
      expect(scope.isDone()).toBe(true);
    });
  });

  describe('error mapping', () => {
    it('maps network errors to CONNECTION_REFUSED', async () => {
      nock(BASE_URL).post('/api/session').replyWithError({ code: 'ECONNREFUSED' });

      const error = await client.createSession(WORKTREE).then(
        () => { throw new Error('should have thrown'); },
        (e: unknown) => e as OpenCodeError,
      );

      expect(error).toBeInstanceOf(OpenCodeError);
      expect(error.code).toBe('CONNECTION_REFUSED');
    });

    it('maps 404 to SESSION_NOT_FOUND', async () => {
      nock(BASE_URL).post('/api/session/sess-missing/wait').reply(404, 'not found');

      const error = await client.waitForIdle('sess-missing', 5000).then(
        () => { throw new Error('should have thrown'); },
        (e: unknown) => e as OpenCodeError,
      );

      expect(error).toBeInstanceOf(OpenCodeError);
      expect(error.code).toBe('SESSION_NOT_FOUND');
    });

    it('maps 403 to PERMISSION_DENIED', async () => {
      nock(BASE_URL).post('/api/session/sess-1/prompt').reply(403, 'forbidden');

      const error = await client.sendPrompt('sess-1', 'test').then(
        () => { throw new Error('should have thrown'); },
        (e: unknown) => e as OpenCodeError,
      );

      expect(error).toBeInstanceOf(OpenCodeError);
      expect(error.code).toBe('PERMISSION_DENIED');
    });

    it('maps 5xx to SERVER_ERROR', async () => {
      nock(BASE_URL).post('/api/session').reply(500, 'internal error');

      const error = await client.createSession(WORKTREE).then(
        () => { throw new Error('should have thrown'); },
        (e: unknown) => e as OpenCodeError,
      );

      expect(error).toBeInstanceOf(OpenCodeError);
      expect(error.code).toBe('SERVER_ERROR');
    });

    it('maps other status codes to UNKNOWN', async () => {
      nock(BASE_URL).post('/api/session').reply(418, 'teapot');

      const error = await client.createSession(WORKTREE).then(
        () => { throw new Error('should have thrown'); },
        (e: unknown) => e as OpenCodeError,
      );

      expect(error).toBeInstanceOf(OpenCodeError);
      expect(error.code).toBe('UNKNOWN');
    });
  });

  describe('pollPermissionsAndApprove', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('auto-approves when autoApprove is true', async () => {
      const approveClient = new OpenCodeHTTPClient(BASE_URL, { autoApprove: true });
      let permissionCallCount = 0;

      nock(BASE_URL)
        .get('/api/session/sess-1/permission')
        .times(3)
        .reply(200, () => {
          permissionCallCount++;
          if (permissionCallCount === 1) return [{ id: 'req-1' }];
          return [];
        });

      nock(BASE_URL)
        .post('/api/session/sess-1/permission/req-1/reply', { decision: 'allow' })
        .reply(200, {});

      const { stop } = approveClient.pollPermissionsAndApprove('sess-1', 100);

      await vi.advanceTimersByTimeAsync(150);
      await vi.advanceTimersByTimeAsync(150);

      stop();
      expect(permissionCallCount).toBeGreaterThanOrEqual(1);
    });

    it('does NOT approve when autoApprove is false', async () => {
      const noApproveClient = new OpenCodeHTTPClient(BASE_URL, { autoApprove: false });

      nock(BASE_URL)
        .get('/api/session/sess-1/permission')
        .times(2)
        .reply(200, [{ id: 'req-1' }]);

      const { stop } = noApproveClient.pollPermissionsAndApprove('sess-1', 100);

      await vi.advanceTimersByTimeAsync(250);

      stop();
    });
  });
});