import { execSync } from 'node:child_process';
import type { GHClient } from '../interfaces/gh-client.js';
import type { OpenCodeClient } from '../interfaces/opencode-client.js';
import type { WorktreeManager } from '../interfaces/worktree-manager.js';
import type { VerifierRunner } from '../interfaces/verifier-runner.js';
import type { LoopyConfig } from '../config/schema.js';
import type { GitHubCard } from '../types/card.js';
import { logger } from '../logger.js';
import { transition, type LoopState, type LoopEvent } from './state-machine.js';
import { StateStore } from '../state/store.js';

export class LoopEngine {
  private readonly ghClient: GHClient;
  private readonly opencodeClient: OpenCodeClient;
  private readonly worktreeManager: WorktreeManager;
  private readonly verifierRunner: VerifierRunner;
  private readonly config: LoopyConfig;
  private readonly stateStore: StateStore;
  private readonly projectId: string;
  private readonly readyColumnOptionId: string;

  constructor(
    ghClient: GHClient,
    opencodeClient: OpenCodeClient,
    worktreeManager: WorktreeManager,
    verifierRunner: VerifierRunner,
    config: LoopyConfig,
    stateDir?: string,
  ) {
    this.ghClient = ghClient;
    this.opencodeClient = opencodeClient;
    this.worktreeManager = worktreeManager;
    this.verifierRunner = verifierRunner;
    this.config = config;
    this.stateStore = new StateStore(stateDir ?? '.loopy/state');

    if ('id' in config.project) {
      this.projectId = config.project.id;
      this.readyColumnOptionId = '';
    } else {
      this.projectId = '';
      this.readyColumnOptionId = '';
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    await this.stateStore.ensureDir();

    if ('owner' in this.config.project) {
      const project = await this.ghClient.getProject({
        owner: this.config.project.owner,
        number: this.config.project.number,
      });
      this.setProperty('projectId', project.id);
    }

    const columns = await this.ghClient.getFieldOptions(this.projectId, 'Status');
    const readyColumn = columns.find((c) => c.role === 'ready');
    const inProgressColumn = columns.find((c) => c.role === 'inProgress');
    const inReviewColumn = columns.find((c) => c.role === 'inReview');
    const doneColumn = columns.find((c) => c.role === 'done');
    const blockedColumn = columns.find((c) => c.role === 'blocked');

    if (!readyColumn || !inProgressColumn || !inReviewColumn || !doneColumn || !blockedColumn) {
      throw new Error('Missing required column configurations');
    }

    this.setProperty('readyColumnOptionId', readyColumn.id);

    while (!signal.aborted) {
      await this.worktreeManager.recover();

      const cards = await this.ghClient.listReadyCards(this.projectId, this.readyColumnOptionId);
      const allStates = await this.stateStore.loadAll();
      const skippedIssueNumbers = new Set(
        allStates.filter((s) => s.state === 'Done' || s.state === 'Blocked').map((s) => s.issueNumber),
      );
      const filteredCards = cards.filter((c) => !skippedIssueNumbers.has(c.issueNumber));

      if (filteredCards.length === 0) {
        logger.info('No ready cards, polling...');
        await this.sleep(this.config.pollInterval, signal);
        continue;
      }

      const card = filteredCards[0];
      await this.processCard(card, {
        readyColumnId: readyColumn.id,
        inProgressColumnId: inProgressColumn.id,
        inReviewColumnId: inReviewColumn.id,
        blockedColumnId: blockedColumn.id,
      }, signal);

      if (signal.aborted) break;
    }

    logger.info('Loop engine stopped');
  }

  private async processCard(
    card: GitHubCard,
    columns: {
      readyColumnId: string;
      inProgressColumnId: string;
      inReviewColumnId: string;
      blockedColumnId: string;
    },
    signal: AbortSignal,
  ): Promise<void> {
    let state: LoopState = 'Idle';
    let retriesLeft = this.config.retries;
    let branch = '';
    let worktreePath = '';

    state = transition(state, { type: 'CARD_PICKED' });
    logger.info({ card: card.issueNumber, state }, 'Card picked');

    try {
      await this.ghClient.moveCard(card.id, columns.inProgressColumnId);
      await this.ghClient.addComment(card.contentId, '🤖 loopy started');

      const slug = this.slugify(card.title);
      const worktree = await this.worktreeManager.create(card.issueNumber, slug);
      branch = worktree.branch;
      worktreePath = worktree.path;

      state = transition(state, { type: 'SESSION_CREATED' });
      logger.info({ card: card.issueNumber, state }, 'Session created');

      const session = await this.opencodeClient.createSession(worktreePath);

      const prompt = `Implement this issue: ${card.title}\n\n${card.body}\n\nURL: ${card.url}`;
      await this.opencodeClient.sendPrompt(session.id, prompt);

      state = transition(state, { type: 'PROMPT_SENT' });
      logger.info({ card: card.issueNumber, state }, 'Prompt sent');

      let permissionPollingStopped = false;
      const permissionPoller = this.config.opencode.autoApprove
        ? this.pollPermissions(session.id, signal, () => permissionPollingStopped)
        : null;

      try {
        await this.opencodeClient.waitForIdle(session.id, this.config.verifier.timeout);
      } finally {
        if (permissionPoller) {
          permissionPollingStopped = true;
          await permissionPoller;
        }
      }

      const verifierResult = await this.verifierRunner.run(
        this.config.verifier.command,
        worktreePath,
        this.config.verifier.env ?? {},
        this.config.verifier.timeout,
      );

      if (!verifierResult.passed) {
        retriesLeft--;
        const failEvent: LoopEvent = { type: 'VERIFIER_FAILED', retriesLeft };
        state = transition(state, failEvent);
        logger.warn({ card: card.issueNumber, state, retriesLeft }, 'Verifier failed');

        if (state === 'FailedRetry') {
          while (retriesLeft > 0 && !signal.aborted) {
            state = transition(state, { type: 'RETRY' });
            logger.info({ card: card.issueNumber, state, retriesLeft }, 'Retrying verifier');

            const retryResult = await this.verifierRunner.run(
              this.config.verifier.command,
              worktreePath,
              this.config.verifier.env ?? {},
              this.config.verifier.timeout,
            );

            if (retryResult.passed) {
              state = transition(state, { type: 'VERIFIER_PASSED' });
              logger.info({ card: card.issueNumber, state }, 'Verifier passed on retry');
              break;
            }

            retriesLeft--;
            state = transition(state, { type: 'VERIFIER_FAILED', retriesLeft });
            logger.warn({ card: card.issueNumber, state, retriesLeft }, 'Verifier failed on retry');

            if (state === 'Blocked') {
              await this.handleBlocked(card, columns.blockedColumnId, 'Verifier failed after max retries', worktreePath);
              await this.stateStore.save({
                issueNumber: card.issueNumber,
                state: 'Blocked',
                retriesLeft: 0,
                branch,
                worktreePath,
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                error: `Verifier failed after ${this.config.retries} retries`,
              });
              return;
            }
          }
        } else {
          await this.handleBlocked(card, columns.blockedColumnId, 'Verifier failed with no retries left', worktreePath);
          await this.stateStore.save({
            issueNumber: card.issueNumber,
            state: 'Blocked',
            retriesLeft: 0,
            branch,
            worktreePath,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            error: 'Verifier failed with no retries left',
          });
          return;
        }
      } else {
        state = transition(state, { type: 'VERIFIER_PASSED' });
        logger.info({ card: card.issueNumber, state }, 'Verifier passed');
      }

      const hasChanges = await this.worktreeManager.hasChanges(worktreePath, 'main');
      if (!hasChanges) {
        await this.ghClient.addComment(card.contentId, '🤖 loopy detected no changes after implementation');
        state = 'Done';
        await this.stateStore.save({
          issueNumber: card.issueNumber,
          state: 'Done',
          retriesLeft,
          branch,
          worktreePath,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          error: null,
        });
        logger.info({ card: card.issueNumber }, 'No changes detected, card done');
        return;
      }

      await this.worktreeManager.commit(worktreePath, `loopy: implement #${card.issueNumber} - ${card.title}`);
      await this.worktreeManager.push(worktreePath);

      state = transition(state, { type: 'PR_OPENED' });
      logger.info({ card: card.issueNumber, state }, 'PR opened');

      const prUrl = this.openPr(worktreePath, branch, card);
      await this.ghClient.moveCard(card.id, columns.inReviewColumnId);
      await this.ghClient.addComment(card.contentId, `🤖 PR opened: ${prUrl}`);

      state = transition(state, { type: 'CARD_MOVED' });
      logger.info({ card: card.issueNumber, state }, 'Card moved to review');

      if (this.config.worktree.cleanup) {
        await this.worktreeManager.remove(worktreePath);
      }

      await this.stateStore.save({
        issueNumber: card.issueNumber,
        state: 'Done',
        retriesLeft,
        branch,
        worktreePath,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ card: card.issueNumber, err: message }, 'Error processing card');

      state = transition(state, { type: 'ERROR', message });
      await this.handleBlocked(card, columns.blockedColumnId, message, worktreePath);
      await this.stateStore.save({
        issueNumber: card.issueNumber,
        state: 'Blocked',
        retriesLeft,
        branch,
        worktreePath,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: message,
      });
    }
  }

  private async handleBlocked(
    card: GitHubCard,
    blockedColumnId: string,
    reason: string,
    worktreePath: string,
  ): Promise<void> {
    try {
      await this.ghClient.moveCard(card.id, blockedColumnId);
      await this.ghClient.addComment(card.contentId, `🤖 loopy blocked: ${reason}`);
    } catch (commentErr) {
      logger.error({ card: card.issueNumber, err: String(commentErr) }, 'Failed to mark card as blocked');
    }

    if (worktreePath && this.config.worktree.cleanup) {
      try {
        await this.worktreeManager.remove(worktreePath);
      } catch {
        logger.warn({ worktreePath }, 'Failed to cleanup worktree for blocked card');
      }
    }
  }

  private async pollPermissions(
    sessionId: string,
    signal: AbortSignal,
    stopped: () => boolean,
  ): Promise<void> {
    while (!signal.aborted && !stopped()) {
      try {
        await this.opencodeClient.replyPermission(sessionId, 'auto', 'allow');
      } catch {
        break;
      }
      await this.sleep(1000, signal);
    }
  }

  private openPr(worktreePath: string, branch: string, card: GitHubCard): string {
    const title = `loopy: #${card.issueNumber} - ${card.title}`;
    const body = `Implements #${card.issueNumber}\n\n${card.url}`;

    try {
      const result = execSync(
        `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --head "${branch}"`,
        { cwd: worktreePath, encoding: 'utf-8' },
      );
      return result.trim();
    } catch (err) {
      logger.error({ err: String(err) }, 'Failed to create PR via gh CLI');
      throw err;
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  }

  private setProperty(key: 'projectId' | 'readyColumnOptionId', value: string): void {
    (this as unknown as Record<string, string>)[key] = value;
  }
}