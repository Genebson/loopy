import type { OpenCodeClient, OpenCodeSession } from '@loopy/core';
import { OpenCodeError } from '@loopy/core';
import type { OpenCodeErrorCode } from '@loopy/core';

interface OpenCodeHTTPClientOptions {
  autoApprove?: boolean;
}

export class OpenCodeHTTPClient implements OpenCodeClient {
  private readonly baseUrl: string;
  private readonly autoApprove: boolean;

  constructor(baseUrl: string, options?: OpenCodeHTTPClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.autoApprove = options?.autoApprove ?? false;
  }

  async createSession(worktreePath: string): Promise<OpenCodeSession> {
    const response = await this.request('POST', '/api/session', worktreePath, {});
    const data = await response.json() as Record<string, unknown>;
    return {
      id: data.id as string,
      url: data.url as string,
      status: 'idle',
      worktreePath,
      createdAt: data.createdAt as string,
    };
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/prompt`, undefined, { content: prompt });
  }

  async waitForIdle(sessionId: string, timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await this.request('POST', `/api/session/${sessionId}/wait`, undefined, undefined, controller.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        await this.abortSession(sessionId);
        throw new OpenCodeError('SESSION_TIMEOUT', `Session ${sessionId} wait timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getMessages(sessionId: string, sinceMessageId?: string): Promise<unknown[]> {
    let path = `/api/session/${sessionId}/message?order=asc&limit=100`;
    if (sinceMessageId) {
      path += `&after=${encodeURIComponent(sinceMessageId)}`;
    }
    const response = await this.request('GET', path);
    const data = await response.json() as unknown[];
    return data;
  }

  async replyPermission(sessionId: string, requestId: string, decision: 'allow' | 'deny'): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/permission/${requestId}/reply`, undefined, { decision });
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/abort`);
  }

  pollPermissionsAndApprove(sessionId: string, intervalMs: number): { stop: () => void } {
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped) return;
      try {
        const response = await this.request('GET', `/api/session/${sessionId}/permission`, undefined, undefined);
        const permissions = await response.json() as Array<{ id: string }>;
        if (permissions.length > 0 && this.autoApprove) {
          for (const perm of permissions) {
            await this.replyPermission(sessionId, perm.id, 'allow');
          }
        }
      } catch {
        // swallow errors during polling
      }
    }, intervalMs);

    return {
      stop() {
        stopped = true;
        clearInterval(timer);
      },
    };
  }

  private async request(
    method: string,
    path: string,
    worktreePath?: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (worktreePath) {
      headers['X-OpenCode-Directory'] = worktreePath;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw new OpenCodeError('CONNECTION_REFUSED', `Failed to connect to OpenCode at ${this.baseUrl}`, error instanceof Error ? error : undefined);
    }

    if (!response.ok) {
      throw this.mapStatusError(response);
    }

    return response;
  }

  private mapStatusError(response: Response): OpenCodeError {
    const status = response.status;
    let code: OpenCodeErrorCode;
    let message: string;

    switch (status) {
      case 403:
        code = 'PERMISSION_DENIED';
        message = `Permission denied: ${response.url}`;
        break;
      case 404:
        code = 'SESSION_NOT_FOUND';
        message = `Session not found: ${response.url}`;
        break;
      default:
        if (status >= 500) {
          code = 'SERVER_ERROR';
          message = `Server error ${status}: ${response.url}`;
        } else {
          code = 'UNKNOWN';
          message = `HTTP ${status}: ${response.url}`;
        }
    }

    return new OpenCodeError(code, message);
  }
}