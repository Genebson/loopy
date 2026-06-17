export type LoopState =
  | 'Idle'
  | 'Picking'
  | 'InProgress'
  | 'Verifying'
  | 'PR'
  | 'InReview'
  | 'FailedRetry'
  | 'Blocked'
  | 'Done';

export type LoopEvent =
  | { type: 'CARD_PICKED' }
  | { type: 'SESSION_CREATED' }
  | { type: 'PROMPT_SENT' }
  | { type: 'BUILD_FAILED'; error: string }
  | { type: 'VERIFIER_PASSED' }
  | { type: 'VERIFIER_FAILED'; retriesLeft: number }
  | { type: 'PR_OPENED' }
  | { type: 'CARD_MOVED' }
  | { type: 'RETRY' }
  | { type: 'GIVE_UP' }
  | { type: 'ERROR'; message: string };

export function transition(state: LoopState, event: LoopEvent): LoopState {
  switch (state) {
    case 'Idle':
      switch (event.type) {
        case 'CARD_PICKED':
          return 'Picking';
        case 'ERROR':
          return 'Blocked';
        default:
          return state;
      }

    case 'Picking':
      switch (event.type) {
        case 'SESSION_CREATED':
          return 'InProgress';
        case 'ERROR':
          return 'Blocked';
        default:
          return state;
      }

    case 'InProgress':
      switch (event.type) {
        case 'PROMPT_SENT':
          return 'InProgress';
        case 'VERIFIER_PASSED':
          return 'PR';
        case 'VERIFIER_FAILED':
          return event.retriesLeft > 0 ? 'FailedRetry' : 'Blocked';
        case 'ERROR':
          return 'Blocked';
        default:
          return state;
      }

    case 'Verifying':
      switch (event.type) {
        case 'VERIFIER_PASSED':
          return 'PR';
        case 'VERIFIER_FAILED':
          return event.retriesLeft > 0 ? 'FailedRetry' : 'Blocked';
        case 'ERROR':
          return 'Blocked';
        default:
          return state;
      }

    case 'PR':
      switch (event.type) {
        case 'PR_OPENED':
          return 'InReview';
        case 'ERROR':
          return 'Blocked';
        default:
          return state;
      }

    case 'InReview':
      switch (event.type) {
        case 'CARD_MOVED':
          return 'Done';
        case 'ERROR':
          return 'Blocked';
        default:
          return state;
      }

    case 'FailedRetry':
      switch (event.type) {
        case 'RETRY':
          return 'InProgress';
        case 'ERROR':
          return 'Blocked';
        default:
          return state;
      }

    case 'Blocked':
      switch (event.type) {
        case 'GIVE_UP':
          return 'Idle';
        case 'ERROR':
          return 'Blocked';
        default:
          return state;
      }

    case 'Done':
      return 'Done';
  }
}