import type { SessionEvent, SessionEventPayload, EventHandler } from '../types/events.js';
import type { Logger } from '../types/config.js';

/**
 * Typed event emitter for session lifecycle events.
 * Isolates handler errors so one failing handler does not crash others.
 *
 * @example
 * ```typescript
 * const emitter = new SessionEventEmitter();
 * emitter.on('session:created', (event) => {
 *   console.log(`Session ${event.sessionId} created`);
 * });
 * ```
 */
const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export class SessionEventEmitter {
  private handlers: Map<SessionEvent, Set<EventHandler>> = new Map();
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? noopLogger;
  }

  /**
   * Subscribe to a session event.
   *
   * @param event - Event type
   * @param handler - Callback function
   */
  on(event: SessionEvent, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * Unsubscribe from a session event.
   *
   * @param event - Event type
   * @param handler - Callback function to remove
   */
  off(event: SessionEvent, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  /**
   * Emit a session event to all registered handlers.
   * Errors in individual handlers are caught and logged.
   *
   * @param event - Event type
   * @param payload - Event payload (type and timestamp are added automatically)
   */
  emit(event: SessionEvent, payload: Omit<SessionEventPayload, 'type' | 'timestamp'>): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    const eventPayload: SessionEventPayload = {
      type: event,
      timestamp: new Date(),
      ...payload,
    };

    for (const handler of handlers) {
      try {
        handler(eventPayload);
      } catch (error) {
        this.logger.error(`Event handler error for ${event}:`, error);
      }
    }
  }

  /**
   * Remove all listeners for an event, or all events if no event is specified.
   *
   * @param event - Optional specific event to clear
   */
  removeAllListeners(event?: SessionEvent): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}
