import type { SessionId } from './session.js';

export type SessionEvent =
  | 'session:created'
  | 'session:updated'
  | 'session:ended'
  | 'session:expired'
  | 'session:deleted'
  | 'message:added'
  | 'message:updated'
  | 'message:deleted'
  | 'participant:joined'
  | 'participant:left'
  | 'agent:handoff'
  | 'compression:applied'
  | 'budget:exceeded'
  | 'error';

export interface SessionEventPayload {
  type: SessionEvent;
  sessionId: SessionId;
  timestamp: Date;
  data?: unknown;
}

export type EventHandler = (payload: SessionEventPayload) => void;
