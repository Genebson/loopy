import type { OpenCodeSession } from '../types/index.js';

export interface OpenCodeClient {
  createSession(worktreePath: string): Promise<OpenCodeSession>;
  sendPrompt(sessionId: string, prompt: string): Promise<void>;
  waitForIdle(sessionId: string, timeoutMs: number): Promise<void>;
  getMessages(sessionId: string, sinceMessageId?: string): Promise<unknown[]>;
  replyPermission(sessionId: string, requestId: string, decision: 'allow' | 'deny'): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
}