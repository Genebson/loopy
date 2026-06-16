import { graphql } from '@octokit/graphql';
import type { GHClient, GitHubCard, Column, ColumnRole } from '@loopy/core';
import { GHAPIError, ConfigError } from '@loopy/core';
import { execSync } from 'node:child_process';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

interface ProjectV2 {
  id: string;
  title: string;
}

interface SelectFieldOption {
  id: string;
  name: string;
}

interface SelectField {
  id: string;
  name: string;
  options: SelectFieldOption[];
}

interface IssueContent {
  id: string;
  number: number;
  title: string;
  body: string | null;
  url: string;
  assignees: { nodes: Array<{ login: string }> };
  labels: { nodes: Array<{ name: string }> };
}

interface FieldValue {
  name: string;
  field?: { name: string } | null;
}

interface ProjectItem {
  id: string;
  content: IssueContent | null;
  fieldValues: { nodes: FieldValue[] };
}

interface CacheData {
  projectId: string;
  statusFieldId: string;
  fieldOptions: Record<string, Column[]>;
  updatedAt: string;
}

const COLUMN_ROLE_MAP: Record<string, ColumnRole> = {
  ready: 'ready',
  todo: 'ready',
  backlog: 'blocked',
  'in progress': 'inProgress',
  in_progress: 'inProgress',
  'in review': 'inReview',
  in_review: 'inReview',
  review: 'inReview',
  done: 'done',
  completed: 'done',
  blocked: 'blocked',
};

function mapColumnRole(name: string): ColumnRole {
  return COLUMN_ROLE_MAP[name.toLowerCase().trim()] ?? 'ready';
}

export class GHProjectClient implements GHClient {
  private readonly token: string;
  private readonly cachePath: string;
  private cache: CacheData | null = null;
  private projectId = '';
  private statusFieldId = '';
  private cachedColumns: Column[] = [];

  constructor(cachePath = '.loopy/cache.json') {
    this.cachePath = resolve(cachePath);
    this.token = GHProjectClient.readToken();
  }

  get statusFieldIdValue(): string {
    return this.statusFieldId;
  }

  private static readToken(): string {
    try {
      const token = execSync('gh auth token', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (!token) throw new ConfigError('gh auth token returned empty string');
      return token;
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ConfigError(
        'gh CLI not installed or not authenticated. Run: gh auth login',
        err instanceof Error ? err : undefined,
      );
    }
  }

  private async loadCache(): Promise<void> {
    if (this.cache) return;
    try {
      const raw = await readFile(this.cachePath, 'utf-8');
      const data: CacheData = JSON.parse(raw);
      this.cache = data;
      this.projectId = data.projectId;
      this.statusFieldId = data.statusFieldId;
      this.cachedColumns = data.fieldOptions['Status'] ?? [];
    } catch {
    }
  }

  private async saveCache(): Promise<void> {
    const data: CacheData = {
      projectId: this.projectId,
      statusFieldId: this.statusFieldId,
      fieldOptions: this.cache?.fieldOptions ?? (this.cachedColumns.length > 0 ? { Status: this.cachedColumns } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.cache = data;
    const dir = dirname(this.cachePath);
    const tmpPath = resolve(dir, `.cache-${randomUUID()}.tmp`);
    await mkdir(dir, { recursive: true });
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmpPath, this.cachePath);
  }

  private async graphqlQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const maxAttempts = 2;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await graphql(query, {
          ...variables,
          headers: { authorization: `token ${this.token}` },
        });
        return response as T;
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts - 1 && this.isRetryable(err)) {
          await this.backoff(attempt);
          continue;
        }
        throw this.mapError(err);
      }
    }

    throw this.mapError(lastError);
  }

  private isRetryable(err: unknown): boolean {
    if (err && typeof err === 'object') {
      const status = (err as { status?: number }).status;
      if (typeof status === 'number' && status >= 500) return true;

      const errors = (err as { errors?: Array<{ type?: string }> }).errors;
      if (Array.isArray(errors) && errors.some((e) => e.type === 'RATE_LIMITED')) return true;
    }
    return false;
  }

  private backoff(attempt: number): Promise<void> {
    const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  private mapError(err: unknown): GHAPIError {
    if (err instanceof GHAPIError) return err;

    let userMessage = 'GitHub API error';
    if (err && typeof err === 'object') {
      const status = (err as { status?: number }).status;
      const message = (err as { message?: string }).message;
      if (message) userMessage = `GitHub API error: ${message}`;
      if (status === 401) userMessage = 'GitHub API: Unauthorized. Check your gh auth token.';
      if (status === 404) userMessage = 'GitHub API: Resource not found.';
      if (status === 403) userMessage = 'GitHub API: Forbidden. Check your token permissions.';
    }

    return new GHAPIError(userMessage, err instanceof Error ? err : undefined);
  }

  private getColumnIdByName(name: string): string {
    const col = this.cachedColumns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!col) throw new GHAPIError(`No column found with name "${name}". Call getFieldOptions() first.`);
    return col.id;
  }

  private getColumnNameById(id: string): string {
    if (this.cachedColumns.length === 0) {
      throw new GHAPIError('Column cache is empty. Call getFieldOptions() first to populate column data.');
    }
    const col = this.cachedColumns.find((c) => c.id === id);
    if (!col) throw new GHAPIError(`No column found with id "${id}". Call getFieldOptions() first.`);
    return col.name;
  }

  private mapItemToCard(item: ProjectItem): GitHubCard {
    const content = item.content;
    if (!content) throw new GHAPIError('Card has no issue content');

    const statusField = item.fieldValues.nodes.find((v) => v.field?.name === 'Status');
    const columnId = statusField ? this.getColumnIdByName(statusField.name) : '';

    return {
      id: item.id,
      contentId: content.id,
      title: content.title,
      body: content.body ?? '',
      columnId,
      assignees: content.assignees?.nodes.map((n) => n.login) ?? [],
      labels: content.labels?.nodes.map((n) => n.name) ?? [],
      url: content.url,
      issueNumber: content.number,
    };
  }

  async getProject(params: { owner: string; number: number }): Promise<{ id: string; title: string }> {
    let userProject: ProjectV2 | null = null;
    let orgProject: ProjectV2 | null = null;
    let orgError: unknown;

    try {
      const userResult = await this.graphqlQuery<{
        user: { projectV2: ProjectV2 | null } | null;
      }>(
        `query($owner: String!, $number: Int!) { user(login: $owner) { projectV2(number: $number) { id title } } }`,
        { owner: params.owner, number: params.number },
      );
      userProject = userResult.user?.projectV2 ?? null;
    } catch {}

    try {
      const orgResult = await this.graphqlQuery<{
        organization: { projectV2: ProjectV2 | null } | null;
      }>(
        `query($owner: String!, $number: Int!) { organization(login: $owner) { projectV2(number: $number) { id title } } }`,
        { owner: params.owner, number: params.number },
      );
      orgProject = orgResult.organization?.projectV2 ?? null;
    } catch (err) {
      orgError = err;
    }

    if (userProject) {
      this.projectId = userProject.id;
      return userProject;
    }

    if (orgProject) {
      this.projectId = orgProject.id;
      return orgProject;
    }

    throw new GHAPIError(`Project not found: ${params.owner}/${params.number}. Org error: ${orgError ? String(orgError) : 'none'}`);
  }

  async getFieldOptions(projectId: string, fieldName: string): Promise<Column[]> {
    await this.loadCache();

    if (this.cache?.fieldOptions?.[fieldName]) {
      this.cachedColumns = this.cache.fieldOptions[fieldName];
      const cachedField = this.cache.fieldOptions[fieldName];
      this.statusFieldId = this.cache.statusFieldId;
      this.projectId = this.cache.projectId;
      return cachedField;
    }

    const result = await this.graphqlQuery<{
      node: {
        fields: {
          nodes: Array<SelectField | { id: string; name: string } | null>;
        };
      } | null;
    }>(
      `query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 20) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options { id name }
                }
              }
            }
          }
        }
      }`,
      { projectId },
    );

    const fields = result.node?.fields?.nodes ?? [];
    const field = fields.find((f): f is SelectField => f !== null && 'options' in f && f.name === fieldName);
    if (!field) {
      throw new GHAPIError(`Field "${fieldName}" not found in project`);
    }

    this.statusFieldId = field.id;
    this.projectId = projectId;

    const columns: Column[] = field.options.map((opt) => ({
      id: opt.id,
      name: opt.name,
      role: mapColumnRole(opt.name),
    }));

    this.cachedColumns = columns;

    if (!this.cache) {
      this.cache = { projectId, statusFieldId: field.id, fieldOptions: {}, updatedAt: '' };
    }
    this.cache.projectId = projectId;
    this.cache.statusFieldId = field.id;
    this.cache.fieldOptions[fieldName] = columns;
    await this.saveCache();

    return columns;
  }

  async listReadyCards(projectId: string, readyColumnOptionId: string): Promise<GitHubCard[]> {
    await this.loadCache();

    const readyColumnName = this.getColumnNameById(readyColumnOptionId);

    let hasNextPage = true;
    let endCursor: string | null = null;
    const allCards: GitHubCard[] = [];

    while (hasNextPage) {
      const result: {
        node: {
          items: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: ProjectItem[];
          };
        } | null;
      } = await this.graphqlQuery(
        `query($projectId: ID!, $first: Int!, $after: String) {
          node(id: $projectId) {
            ... on ProjectV2 {
              items(first: $first, after: $after) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  id
                  content {
                    ... on Issue {
                      id number title body url
                      assignees(first: 10) { nodes { login } }
                      labels(first: 10) { nodes { name } }
                    }
                  }
                  fieldValues(first: 20) {
                    nodes {
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        field { ... on ProjectV2SingleSelectField { name } }
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
        { projectId, first: 100, after: endCursor },
      );

      const items = result.node?.items ?? null;
      if (!items) throw new GHAPIError('Failed to fetch project items');

      for (const item of items.nodes) {
        if (!item.content) continue;

        const statusField: FieldValue | undefined = item.fieldValues.nodes.find((v: FieldValue) => v.field?.name === 'Status');
        if (!statusField) continue;
        if (statusField.name.toLowerCase() !== readyColumnName.toLowerCase()) continue;

        allCards.push(this.mapItemToCard(item));
      }

      hasNextPage = items.pageInfo.hasNextPage;
      endCursor = items.pageInfo.endCursor;
    }

    return allCards;
  }

  async getCard(cardId: string): Promise<GitHubCard> {
    await this.loadCache();

    const result = await this.graphqlQuery<{
      node: ProjectItem | null;
    }>(
      `query($itemId: ID!) {
        node(id: $itemId) {
          ... on ProjectV2Item {
            id
            content {
              ... on Issue {
                id number title body url
                assignees(first: 10) { nodes { login } }
                labels(first: 10) { nodes { name } }
              }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
              }
            }
          }
        }
      }`,
      { itemId: cardId },
    );

    if (!result.node) throw new GHAPIError(`Card not found: ${cardId}`);

    return this.mapItemToCard(result.node);
  }

  async getCardByIssueNumber(issueNumber: number): Promise<GitHubCard> {
    if (!this.projectId) throw new ConfigError('Project ID not available. Call getProject() first.');

    const result = await this.graphqlQuery<{
      node: {
        items: {
          nodes: ProjectItem[];
        };
      } | null;
    }>(
      `query($projectId: ID!, $issueNumber: Int!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                content {
                  ... on Issue {
                    id number title body url
                    assignees(first: 10) { nodes { login } }
                    labels(first: 10) { nodes { name } }
                  }
                }
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2SingleSelectField { name } }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { projectId: this.projectId, issueNumber },
    );

    const items = result.node?.items?.nodes ?? [];
    const item = items.find((i) => i.content?.number === issueNumber);

    if (!item) throw new GHAPIError(`Card for issue #${issueNumber} not found in project`);

    return this.mapItemToCard(item);
  }

  async moveCard(cardId: string, columnOptionId: string): Promise<void> {
    if (!this.projectId) throw new ConfigError('Project ID not available. Call getProject() first.');
    if (!this.statusFieldId) throw new ConfigError('Status field ID not available. Call getFieldOptions() first.');

    await this.graphqlQuery(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { singleSelectOptionId: $value }
        }) {
          projectV2Item { id }
        }
      }`,
      {
        projectId: this.projectId,
        itemId: cardId,
        fieldId: this.statusFieldId,
        value: columnOptionId,
      },
    );
  }

  async addComment(issueId: string, body: string): Promise<void> {
    await this.graphqlQuery(
      `mutation($issueId: ID!, $body: String!) {
        addComment(input: { subjectId: $issueId, body: $body }) {
          commentEdge { node { id } }
        }
      }`,
      { issueId, body },
    );
  }
}