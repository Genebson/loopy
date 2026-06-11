import type { GitHubCard } from '@loopy/core';

export function createTestCard(overrides?: Partial<GitHubCard>): GitHubCard {
  return {
    id: 'card_test1',
    contentId: 'issue_test1',
    title: 'Test Card',
    body: 'This is a test card',
    columnId: 'opt_ready',
    assignees: [],
    labels: [],
    url: 'https://github.com/test-org/test-repo/issues/1',
    issueNumber: 1,
    ...overrides,
  };
}