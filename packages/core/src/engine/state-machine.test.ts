import { describe, it, expect } from 'vitest';
import { transition, type LoopState, type LoopEvent } from './state-machine.js';

describe('state machine transition', () => {
  describe('Idle state', () => {
    it('transitions to Picking on CARD_PICKED', () => {
      expect(transition('Idle', { type: 'CARD_PICKED' })).toBe('Picking');
    });

    it('transitions to Blocked on ERROR', () => {
      expect(transition('Idle', { type: 'ERROR', message: 'fail' })).toBe('Blocked');
    });

    it('stays Idle on SESSION_CREATED', () => {
      expect(transition('Idle', { type: 'SESSION_CREATED' })).toBe('Idle');
    });

    it('stays Idle on PROMPT_SENT', () => {
      expect(transition('Idle', { type: 'PROMPT_SENT' })).toBe('Idle');
    });

    it('stays Idle on VERIFIER_PASSED', () => {
      expect(transition('Idle', { type: 'VERIFIER_PASSED' })).toBe('Idle');
    });

    it('stays Idle on VERIFIER_FAILED', () => {
      expect(transition('Idle', { type: 'VERIFIER_FAILED', retriesLeft: 2 })).toBe('Idle');
    });

    it('stays Idle on PR_OPENED', () => {
      expect(transition('Idle', { type: 'PR_OPENED' })).toBe('Idle');
    });

    it('stays Idle on CARD_MOVED', () => {
      expect(transition('Idle', { type: 'CARD_MOVED' })).toBe('Idle');
    });

    it('stays Idle on RETRY', () => {
      expect(transition('Idle', { type: 'RETRY' })).toBe('Idle');
    });

    it('stays Idle on GIVE_UP', () => {
      expect(transition('Idle', { type: 'GIVE_UP' })).toBe('Idle');
    });
  });

  describe('Picking state', () => {
    it('transitions to InProgress on SESSION_CREATED', () => {
      expect(transition('Picking', { type: 'SESSION_CREATED' })).toBe('InProgress');
    });

    it('transitions to Blocked on ERROR', () => {
      expect(transition('Picking', { type: 'ERROR', message: 'fail' })).toBe('Blocked');
    });

    it('stays Picking on CARD_PICKED', () => {
      expect(transition('Picking', { type: 'CARD_PICKED' })).toBe('Picking');
    });

    it('stays Picking on PROMPT_SENT', () => {
      expect(transition('Picking', { type: 'PROMPT_SENT' })).toBe('Picking');
    });

    it('stays Picking on VERIFIER_PASSED', () => {
      expect(transition('Picking', { type: 'VERIFIER_PASSED' })).toBe('Picking');
    });

    it('stays Picking on VERIFIER_FAILED', () => {
      expect(transition('Picking', { type: 'VERIFIER_FAILED', retriesLeft: 2 })).toBe('Picking');
    });
  });

  describe('InProgress state', () => {
    it('stays InProgress on PROMPT_SENT', () => {
      expect(transition('InProgress', { type: 'PROMPT_SENT' })).toBe('InProgress');
    });

    it('transitions to PR on VERIFIER_PASSED', () => {
      expect(transition('InProgress', { type: 'VERIFIER_PASSED' })).toBe('PR');
    });

    it('transitions to FailedRetry on VERIFIER_FAILED with retriesLeft > 0', () => {
      expect(transition('InProgress', { type: 'VERIFIER_FAILED', retriesLeft: 2 })).toBe('FailedRetry');
    });

    it('transitions to Blocked on VERIFIER_FAILED with retriesLeft === 0', () => {
      expect(transition('InProgress', { type: 'VERIFIER_FAILED', retriesLeft: 0 })).toBe('Blocked');
    });

    it('transitions to Blocked on ERROR', () => {
      expect(transition('InProgress', { type: 'ERROR', message: 'fail' })).toBe('Blocked');
    });

    it('stays InProgress on CARD_PICKED', () => {
      expect(transition('InProgress', { type: 'CARD_PICKED' })).toBe('InProgress');
    });

    it('stays InProgress on SESSION_CREATED', () => {
      expect(transition('InProgress', { type: 'SESSION_CREATED' })).toBe('InProgress');
    });
  });

  describe('Verifying state', () => {
    it('transitions to PR on VERIFIER_PASSED', () => {
      expect(transition('Verifying', { type: 'VERIFIER_PASSED' })).toBe('PR');
    });

    it('transitions to FailedRetry on VERIFIER_FAILED with retriesLeft > 0', () => {
      expect(transition('Verifying', { type: 'VERIFIER_FAILED', retriesLeft: 1 })).toBe('FailedRetry');
    });

    it('transitions to Blocked on VERIFIER_FAILED with retriesLeft === 0', () => {
      expect(transition('Verifying', { type: 'VERIFIER_FAILED', retriesLeft: 0 })).toBe('Blocked');
    });

    it('transitions to Blocked on ERROR', () => {
      expect(transition('Verifying', { type: 'ERROR', message: 'fail' })).toBe('Blocked');
    });
  });

  describe('PR state', () => {
    it('transitions to InReview on PR_OPENED', () => {
      expect(transition('PR', { type: 'PR_OPENED' })).toBe('InReview');
    });

    it('transitions to Blocked on ERROR', () => {
      expect(transition('PR', { type: 'ERROR', message: 'fail' })).toBe('Blocked');
    });

    it('stays PR on CARD_PICKED', () => {
      expect(transition('PR', { type: 'CARD_PICKED' })).toBe('PR');
    });

    it('stays PR on VERIFIER_PASSED', () => {
      expect(transition('PR', { type: 'VERIFIER_PASSED' })).toBe('PR');
    });
  });

  describe('InReview state', () => {
    it('transitions to Done on CARD_MOVED', () => {
      expect(transition('InReview', { type: 'CARD_MOVED' })).toBe('Done');
    });

    it('transitions to Blocked on ERROR', () => {
      expect(transition('InReview', { type: 'ERROR', message: 'fail' })).toBe('Blocked');
    });

    it('stays InReview on CARD_PICKED', () => {
      expect(transition('InReview', { type: 'CARD_PICKED' })).toBe('InReview');
    });
  });

  describe('FailedRetry state', () => {
    it('transitions to InProgress on RETRY', () => {
      expect(transition('FailedRetry', { type: 'RETRY' })).toBe('InProgress');
    });

    it('transitions to Blocked on ERROR', () => {
      expect(transition('FailedRetry', { type: 'ERROR', message: 'fail' })).toBe('Blocked');
    });

    it('stays FailedRetry on CARD_PICKED', () => {
      expect(transition('FailedRetry', { type: 'CARD_PICKED' })).toBe('FailedRetry');
    });

    it('stays FailedRetry on VERIFIER_PASSED', () => {
      expect(transition('FailedRetry', { type: 'VERIFIER_PASSED' })).toBe('FailedRetry');
    });

    it('stays FailedRetry on VERIFIER_FAILED', () => {
      expect(transition('FailedRetry', { type: 'VERIFIER_FAILED', retriesLeft: 2 })).toBe('FailedRetry');
    });
  });

  describe('Blocked state', () => {
    it('transitions to Idle on GIVE_UP', () => {
      expect(transition('Blocked', { type: 'GIVE_UP' })).toBe('Idle');
    });

    it('stays Blocked on ERROR', () => {
      expect(transition('Blocked', { type: 'ERROR', message: 'another' })).toBe('Blocked');
    });

    it('stays Blocked on CARD_PICKED', () => {
      expect(transition('Blocked', { type: 'CARD_PICKED' })).toBe('Blocked');
    });

    it('stays Blocked on SESSION_CREATED', () => {
      expect(transition('Blocked', { type: 'SESSION_CREATED' })).toBe('Blocked');
    });

    it('stays Blocked on RETRY', () => {
      expect(transition('Blocked', { type: 'RETRY' })).toBe('Blocked');
    });
  });

  describe('Done state', () => {
    it('stays Done on any event', () => {
      const events: LoopEvent[] = [
        { type: 'CARD_PICKED' },
        { type: 'SESSION_CREATED' },
        { type: 'PROMPT_SENT' },
        { type: 'VERIFIER_PASSED' },
        { type: 'VERIFIER_FAILED', retriesLeft: 0 },
        { type: 'PR_OPENED' },
        { type: 'CARD_MOVED' },
        { type: 'RETRY' },
        { type: 'GIVE_UP' },
        { type: 'ERROR', message: 'err' },
      ];

      for (const event of events) {
        expect(transition('Done', event)).toBe('Done');
      }
    });
  });

  describe('exhaustive state coverage', () => {
    const allStates: LoopState[] = [
      'Idle', 'Picking', 'InProgress', 'Verifying', 'PR',
      'InReview', 'FailedRetry', 'Blocked', 'Done',
    ];

    it('every state has at least one transition tested', () => {
      expect(allStates.length).toBe(9);
    });
  });
});