import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LoopState } from '../engine/state-machine.js';

interface CardState {
  issueNumber: number;
  state: LoopState;
  retriesLeft: number;
  branch: string;
  worktreePath: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export class StateStore {
  private readonly stateDir: string;

  constructor(stateDir: string = '.loopy/state') {
    this.stateDir = resolve(stateDir);
  }

  async ensureDir(): Promise<void> {
    await fs.promises.mkdir(this.stateDir, { recursive: true });
  }

  async save(cardState: CardState): Promise<void> {
    await this.ensureDir();
    const filePath = this.getFilePath(cardState.issueNumber);
    const tmpPath = resolve(dirname(filePath), `.state-${randomUUID()}.tmp`);
    await fs.promises.writeFile(tmpPath, JSON.stringify(cardState, null, 2), 'utf-8');
    await fs.promises.rename(tmpPath, filePath);
  }

  async load(issueNumber: number): Promise<CardState | null> {
    const filePath = this.getFilePath(issueNumber);
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data) as CardState;
    } catch {
      return null;
    }
  }

  async loadAll(): Promise<CardState[]> {
    await this.ensureDir();
    const files = await fs.promises.readdir(this.stateDir);
    const states: CardState[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = await fs.promises.readFile(resolve(this.stateDir, file), 'utf-8');
        states.push(JSON.parse(data) as CardState);
      } catch {
        // skip invalid files
      }
    }
    return states;
  }

  async delete(issueNumber: number): Promise<void> {
    const filePath = this.getFilePath(issueNumber);
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // file doesn't exist, that's fine
    }
  }

  private getFilePath(issueNumber: number): string {
    return resolve(this.stateDir, `${issueNumber}.json`);
  }
}

export type { CardState };