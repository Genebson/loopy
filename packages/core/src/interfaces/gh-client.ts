import type { GitHubCard, Column } from '../types/index.js';

export interface GHClient {
  getProject(params: { owner: string; number: number }): Promise<{ id: string; title: string }>;
  getFieldOptions(projectId: string, fieldName: string): Promise<Column[]>;
  listReadyCards(projectId: string, readyColumnOptionId: string): Promise<GitHubCard[]>;
  getCard(cardId: string): Promise<GitHubCard>;
  moveCard(cardId: string, columnOptionId: string): Promise<void>;
  addComment(issueId: string, body: string): Promise<void>;
}