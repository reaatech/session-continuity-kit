import { describe, it, expect, vi } from 'vitest';
import { SessionEventEmitter } from '../src/events/SessionEventEmitter.js';
import type { SessionEventPayload } from '../src/types/events.js';

describe('SessionEventEmitter', () => {
  it('calls registered handler on emit', () => {
    const emitter = new SessionEventEmitter();
    const handler = vi.fn();

    emitter.on('session:created', handler);
    emitter.emit('session:created', { sessionId: '123' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session:created',
        sessionId: '123',
      })
    );
  });

  it('does not call handler after off', () => {
    const emitter = new SessionEventEmitter();
    const handler = vi.fn();

    emitter.on('session:created', handler);
    emitter.off('session:created', handler);
    emitter.emit('session:created', { sessionId: '123' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('calls multiple handlers for same event', () => {
    const emitter = new SessionEventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    emitter.on('session:created', handler1);
    emitter.on('session:created', handler2);
    emitter.emit('session:created', { sessionId: '123' });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('does nothing when emitting event with no handlers', () => {
    const emitter = new SessionEventEmitter();
    // Should not throw
    emitter.emit('session:created', { sessionId: '123' });
  });

  it('catches handler errors without crashing', () => {
    const emitter = new SessionEventEmitter();
    const errorHandler = vi.fn(() => {
      throw new Error('handler error');
    });
    const goodHandler = vi.fn();

    emitter.on('session:created', errorHandler);
    emitter.on('session:created', goodHandler);

    // Should not throw despite errorHandler throwing
    emitter.emit('session:created', { sessionId: '123' });

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it('removeAllListeners clears all handlers for an event', () => {
    const emitter = new SessionEventEmitter();
    const handler = vi.fn();

    emitter.on('session:created', handler);
    emitter.removeAllListeners('session:created');
    emitter.emit('session:created', { sessionId: '123' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('removeAllListeners without arg clears all handlers', () => {
    const emitter = new SessionEventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    emitter.on('session:created', handler1);
    emitter.on('session:ended', handler2);
    emitter.removeAllListeners();

    emitter.emit('session:created', { sessionId: '123' });
    emitter.emit('session:ended', { sessionId: '123' });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('includes timestamp in payload', () => {
    const emitter = new SessionEventEmitter();
    const handler = vi.fn();

    emitter.on('session:created', handler);
    emitter.emit('session:created', { sessionId: '123' });

    const payload = handler.mock.calls[0][0] as SessionEventPayload;
    expect(payload.timestamp).toBeInstanceOf(Date);
  });
});
