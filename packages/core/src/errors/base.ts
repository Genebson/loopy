export class LoopyError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(code: string, userMessage: string, cause?: Error) {
    super(userMessage, { cause });
    this.name = 'LoopyError';
    this.code = code;
    this.userMessage = userMessage;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.userMessage,
      cause: (this.cause instanceof Error ? this.cause.message : null),
    };
  }
}