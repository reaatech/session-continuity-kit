import type { SessionId } from './session.js';

export class SessionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

export class SessionNotFoundError extends SessionError {
  constructor(sessionId: SessionId) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND');
    this.name = 'SessionNotFoundError';
  }
}

export class TokenBudgetExceededError extends SessionError {
  constructor(
    public readonly used: number,
    public readonly limit: number,
    public readonly overage: number
  ) {
    super(`Token budget exceeded: ${used}/${limit} (+${overage} over)`, 'TOKEN_BUDGET_EXCEEDED');
    this.name = 'TokenBudgetExceededError';
  }
}

export class StorageError extends SessionError {
  constructor(
    message: string,
    public readonly adapter: string,
    cause?: Error
  ) {
    super(message, 'STORAGE_ERROR', cause);
    this.name = 'StorageError';
  }
}

export class CompressionError extends SessionError {
  constructor(message: string, cause?: Error) {
    super(message, 'COMPRESSION_ERROR', cause);
    this.name = 'CompressionError';
  }
}

export class ValidationError extends SessionError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class HandoffError extends SessionError {
  constructor(message: string) {
    super(message, 'HANDOFF_ERROR');
    this.name = 'HandoffError';
  }
}
