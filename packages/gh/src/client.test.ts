import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { GHProjectClient } from './client.js';
import { GHAPIError, ConfigError } from '@loopy/core';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-uuid'),
}));

import { execSync } from 'node:child_process';

const GH_API = 'https://api.github.com';

const mockExecSync = vi.mocked(execSync);

function mockAuth() {
  mockExecSync.mockReturnValue('test-token-123\n');
}

function mockNoAuth() {
  mockExecSync.mockImplementation(() => {
    throw new Error('gh: command not found');
  });
}

const ORG_PROJECT_RESPONSE = {
  organization: {
    projectV2: { id: 'PROJ_1', title: 'My Project' },
  },
  user: { projectV2: null },
};

const USER_PROJECT_RESPONSE = {
  organization: { projectV2: null },
  user: {
    projectV2: { id: 'PROJ_2', title: 'User Project' },
  },
};

const FIELDS_RESPONSE = {
  node: {
    fields: {
      nodes: [
        {
          id: 'FIELD_STATUS',
          name: 'Status',
          options: [
            { id: 'OPT_TODO', name: 'Todo' },
            { id: 'OPT_IN_PROGRESS', name: 'In Progress' },
            { id: 'OPT_DONE', name: 'Done' },
          ],
        },
      ],
    },
  },
};

describe('GHProjectClient', () => {
  beforeEach(() => {
    mockAuth();
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('reads token from gh auth token', () => {
      mockAuth();
      new GHProjectClient();
      expect(mockExecSync).toHaveBeenCalledWith('gh auth token', expect.any(Object));
    });

    it('throws ConfigError when gh is not installed', () => {
      mockNoAuth();
      expect(() => new GHProjectClient()).toThrow(ConfigError);
    });
  });

  describe('getProject', () => {
    it('succeeds with org project', async () => {
      const client = new GHProjectClient();
      const scope = nock(GH_API)
        .post('/graphql')
        .matchHeader('authorization', 'token test-token-123')
        .reply(200, { data: ORG_PROJECT_RESPONSE });

      const result = await client.getProject({ owner: 'myorg', number: 1 });
      expect(result).toEqual({ id: 'PROJ_1', title: 'My Project' });
      scope.done();
    });

    it('falls back to user project when org is null', async () => {
      const client = new GHProjectClient();
      const scope = nock(GH_API)
        .post('/graphql')
        .reply(200, { data: USER_PROJECT_RESPONSE });

      const result = await client.getProject({ owner: 'myuser', number: 2 });
      expect(result).toEqual({ id: 'PROJ_2', title: 'User Project' });
      scope.done();
    });

    it('throws GHAPIError when project not found', async () => {
      const client = new GHProjectClient();
      nock(GH_API)
        .post('/graphql')
        .reply(200, {
          data: {
            organization: { projectV2: null },
            user: { projectV2: null },
          },
        });

      await expect(client.getProject({ owner: 'nonexistent', number: 999 })).rejects.toThrow(GHAPIError);
    });
  });

  describe('getFieldOptions', () => {
    it('returns mapped columns from field options', async () => {
      const client = new GHProjectClient();
      nock(GH_API).post('/graphql').reply(200, { data: ORG_PROJECT_RESPONSE });
      await client.getProject({ owner: 'myorg', number: 1 });

      const scope = nock(GH_API)
        .post('/graphql')
        .reply(200, { data: FIELDS_RESPONSE });

      const columns = await client.getFieldOptions('PROJ_1', 'Status');
      expect(columns).toEqual([
        { id: 'OPT_TODO', name: 'Todo', role: 'ready' },
        { id: 'OPT_IN_PROGRESS', name: 'In Progress', role: 'inProgress' },
        { id: 'OPT_DONE', name: 'Done', role: 'done' },
      ]);
      scope.done();
    });

    it('throws GHAPIError when field not found', async () => {
      const client = new GHProjectClient();
      nock(GH_API).post('/graphql').reply(200, { data: ORG_PROJECT_RESPONSE });
      await client.getProject({ owner: 'myorg', number: 1 });

      nock(GH_API)
        .post('/graphql')
        .reply(200, {
          data: {
            node: { fields: { nodes: [] } },
          },
        });

      await expect(client.getFieldOptions('PROJ_1', 'Nonexistent')).rejects.toThrow(GHAPIError);
    });
  });

  describe('listReadyCards', () => {
    it('returns parsed cards from mocked response', async () => {
      const client = new GHProjectClient();
      nock(GH_API).post('/graphql').reply(200, { data: ORG_PROJECT_RESPONSE });
      await client.getProject({ owner: 'myorg', number: 1 });

      nock(GH_API).post('/graphql').reply(200, { data: FIELDS_RESPONSE });
      await client.getFieldOptions('PROJ_1', 'Status');

      const scope = nock(GH_API)
        .post('/graphql')
        .reply(200, {
          data: {
            node: {
              items: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'ITEM_1',
                    content: {
                      id: 'ISSUE_1',
                      number: 42,
                      title: 'Test issue',
                      body: 'Body text',
                      url: 'https://github.com/myorg/repo/issues/42',
                      assignees: { nodes: [{ login: 'dev1' }] },
                      labels: { nodes: [{ name: 'bug' }] },
                    },
                    fieldValues: {
                      nodes: [
                        { name: 'Todo', field: { name: 'Status' } },
                      ],
                    },
                  },
                ],
              },
            },
          },
        });

      const cards = await client.listReadyCards('PROJ_1', 'OPT_TODO');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        id: 'ITEM_1',
        contentId: 'ISSUE_1',
        title: 'Test issue',
        issueNumber: 42,
        assignees: ['dev1'],
        labels: ['bug'],
        columnId: 'OPT_TODO',
      });
      scope.done();
    });
  });

  describe('moveCard', () => {
    it('issues correct GraphQL mutation', async () => {
      const client = new GHProjectClient();
      nock(GH_API).post('/graphql').reply(200, { data: ORG_PROJECT_RESPONSE });
      await client.getProject({ owner: 'myorg', number: 1 });

      nock(GH_API).post('/graphql').reply(200, { data: FIELDS_RESPONSE });
      await client.getFieldOptions('PROJ_1', 'Status');

      const scope = nock(GH_API)
        .post('/graphql', (body) => {
          const vars = body.variables;
          return (
            vars.projectId === 'PROJ_1' &&
            vars.itemId === 'ITEM_1' &&
            vars.fieldId === 'FIELD_STATUS' &&
            vars.value === 'OPT_DONE'
          );
        })
        .reply(200, {
          data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_1' } } },
        });

      await client.moveCard('ITEM_1', 'OPT_DONE');
      scope.done();
    });
  });

  describe('addComment', () => {
    it('adds comment to issue', async () => {
      const client = new GHProjectClient();
      nock(GH_API).post('/graphql').reply(200, { data: ORG_PROJECT_RESPONSE });
      await client.getProject({ owner: 'myorg', number: 1 });

      nock(GH_API).post('/graphql').reply(200, { data: FIELDS_RESPONSE });
      await client.getFieldOptions('PROJ_1', 'Status');

      nock(GH_API)
        .post('/graphql')
        .reply(200, {
          data: {
            node: {
              id: 'ITEM_1',
              content: {
                id: 'ISSUE_1',
                number: 42,
                title: 'Test',
                body: '',
                url: 'https://github.com/myorg/repo/issues/42',
                assignees: { nodes: [] },
                labels: { nodes: [] },
              },
              fieldValues: {
                nodes: [{ name: 'Todo', field: { name: 'Status' } }],
              },
            },
          },
        });

      const commentScope = nock(GH_API)
        .post('/graphql', (body) => {
          return body.variables.issueId === 'ISSUE_1' && body.variables.body === 'Hello';
        })
        .reply(200, {
          data: { addComment: { commentEdge: { node: { id: 'COMMENT_1' } } } },
        });

      await client.addComment('ITEM_1', 'Hello');
      commentScope.done();
    });
  });

  describe('retry on rate limit', () => {
    it('retries once on rate-limited response', async () => {
      const client = new GHProjectClient();
      nock(GH_API)
        .post('/graphql')
        .reply(200, {
          data: null,
          errors: [{ type: 'RATE_LIMITED', message: 'rate limited' }],
        });

      nock(GH_API)
        .post('/graphql')
        .reply(200, { data: ORG_PROJECT_RESPONSE });

      const result = await client.getProject({ owner: 'myorg', number: 1 });
      expect(result).toEqual({ id: 'PROJ_1', title: 'My Project' });
    });
  });
});