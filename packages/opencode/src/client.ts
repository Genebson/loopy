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
    const response = await this.request('POST', '/session', worktreePath, { title: 'loopy' });
    const data = await response.json() as Record<string, unknown>;
    return {
      id: data.id as string,
      url: `${this.baseUrl}/session/${data.id}`,
      status: 'idle',
      worktreePath: (data.directory as string) ?? worktreePath,
      createdAt: new Date().toISOString(),
    };
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/prompt_async`, undefined, {
      parts: [{ type: 'text', text: prompt }],
    });
  }

  async waitForIdle(sessionId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const pollInterval = 3000;
    const stableThreshold = 10;
    let lastUpdated = 0;
    let stableCount = 0;

    while (Date.now() < deadline) {
      try {
        const response = await this.request('GET', `/session/${sessionId}`);
        const sessionData = (await response.json()) as Record<string, unknown>;
        const timeData = sessionData.time as { updated?: number } | undefined;
        const currentUpdated = timeData?.updated ?? 0;
        const status = sessionData.status as string | undefined;

        if (status === 'idle' || status === 'completed') {
          return;
        }
        if (status === 'error') {
          throw new OpenCodeError('SESSION_ERROR', `Session ${sessionId} ended with error`);
        }

        if (currentUpdated === lastUpdated) {
          stableCount++;
          if (stableCount >= stableThreshold) {
            return;
          }
        } else {
          stableCount = 0;
          lastUpdated = currentUpdated;
        }
      } catch (err) {
        if (err instanceof OpenCodeError && err.message.includes('SESSION_NOT_FOUND')) {
          return;
        }
        throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    await this.abortSession(sessionId);
    throw new OpenCodeError('SESSION_TIMEOUT', `Session ${sessionId} wait timed out after ${timeoutMs}ms`);
  }

  async getMessages(_sessionId: string, _sinceMessageId?: string): Promise<unknown[]> {
    return [];
  }

  async replyPermission(sessionId: string, requestId: string, decision: 'allow' | 'deny'): Promise<void> {
    await this.request('POST', `/session/${sessionId}/permissions/${requestId}`, undefined, {
      response: decision,
      remember: true,
    });
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/abort`);
  }

  pollPermissionsAndApprove(sessionId: string, intervalMs: number): { stop: () => void } {
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped) return;
      try {
        const response = await this.request('GET', '/session/status');
        const statuses = (await response.json()) as Record<string, { permissions?: Array<{ id: string }> }>;
        const sessionStatus = statuses[sessionId];
        const permissions = sessionStatus?.permissions ?? [];
        if (permissions.length > 0 && this.autoApprove) {
          for (const perm of permissions) {
            await this.replyPermission(sessionId, perm.id, 'allow');
          }
        }
      } catch {
        void 0;
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
      });
    } catch (error) {
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
