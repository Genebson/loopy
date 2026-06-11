import { Command } from 'commander';
import chalk from 'chalk';
import { StateStore } from '@loopy/core';
import type { CardState } from '@loopy/core';

const STATE_DIR = '.loopy/state';

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function colorizeState(state: string): string {
  switch (state) {
    case 'Done':
      return chalk.green(state);
    case 'Blocked':
      return chalk.red(state);
    case 'FailedRetry':
      return chalk.yellow(state);
    default:
      return chalk.cyan(state);
  }
}

export const statusCommand = new Command('status')
  .description('Show current loop status')
  .action(async () => {
    const store = new StateStore(STATE_DIR);
    const cards: CardState[] = await store.loadAll();

    if (cards.length === 0) {
      console.log(chalk.yellow('No active tasks. Run `loopy run` to start.'));
      return;
    }

    const issueHeader = 'Issue #';
    const stateHeader = 'State';
    const branchHeader = 'Branch';
    const updatedHeader = 'Last Updated';

    const rows = cards.map((card) => ({
      issue: String(card.issueNumber),
      state: card.state,
      branch: card.branch || '-',
      updated: card.completedAt ?? card.startedAt,
    }));

    const issueWidth = Math.max(issueHeader.length, ...rows.map((r) => r.issue.length));
    const stateWidth = Math.max(stateHeader.length, ...rows.map((r) => r.state.length));
    const branchWidth = Math.max(branchHeader.length, ...rows.map((r) => r.branch.length));
    const updatedWidth = Math.max(updatedHeader.length, ...rows.map((r) => r.updated ? formatRelativeTime(r.updated).length : 0));

    const header = [
      issueHeader.padEnd(issueWidth),
      stateHeader.padEnd(stateWidth),
      branchHeader.padEnd(branchWidth),
      updatedHeader,
    ].join('  ');

    const separator = [
      ''.padEnd(issueWidth, '─'),
      ''.padEnd(stateWidth, '─'),
      ''.padEnd(branchWidth, '─'),
      ''.padEnd(updatedWidth, '─'),
    ].join('  ');

    console.log(chalk.bold(header));
    console.log(chalk.gray(separator));

    for (const row of rows) {
      const updatedStr = row.updated ? formatRelativeTime(row.updated) : '-';
      const line = [
        row.issue.padEnd(issueWidth),
        colorizeState(row.state).padEnd(stateWidth),
        row.branch.padEnd(branchWidth),
        updatedStr,
      ].join('  ');
      console.log(line);
    }
  });