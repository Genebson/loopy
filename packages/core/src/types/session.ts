export interface OpenCodeSession {
  id: string;
  url: string;
  status: 'idle' | 'busy' | 'error';
  worktreePath: string;
  createdAt: string;
}