import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../src/session/SessionManager.js';
import { MemoryAdapter } from '../../storage-memory/src/MemoryAdapter.js';
import { EstimateTokenizer } from '../../tokenizers/src/EstimateTokenizer.js';
import { SessionNotFoundError, HandoffError } from '../src/types/errors.js';
import type { TokenBudgetConfig } from '../src/types/token.js';

describe('SessionManager', () => {
  let manager: SessionManager;
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
    manager = new SessionManager({
      storage: adapter,
      tokenCounter: new EstimateTokenizer(),
    });
  });

  it('creates a session with defaults', async () => {
    const session = await manager.createSession();
    expect(session.id).toBeDefined();
    expect(session.status).toBe('active');
    expect(session.schemaVersion).toBe(1);
    expect(session.version).toBe(1);
    expect(session.participants).toEqual([]);
  });

  it('creates a session with options', async () => {
    const session = await manager.createSession({
      userId: 'user-123',
      metadata: { title: 'Test Session' },
    });
    expect(session.userId).toBe('user-123');
    expect(session.metadata.title).toBe('Test Session');
  });

  it('retrieves a session', async () => {
    const created = await manager.createSession();
    const retrieved = await manager.getSession(created.id);
    expect(retrieved.id).toBe(created.id);
  });

  it('throws when session not found', async () => {
    await expect(manager.getSession('non-existent')).rejects.toThrow(SessionNotFoundError);
  });

  it('updates a session', async () => {
    const created = await manager.createSession();
    const updated = await manager.updateSession(created.id, { status: 'paused' });
    expect(updated.status).toBe('paused');
    expect(updated.version).toBe(2);
  });

  it('ends a session', async () => {
    const created = await manager.createSession();
    await manager.endSession(created.id);
    const session = await manager.getSession(created.id);
    expect(session.status).toBe('completed');
  });

  it('deletes a session', async () => {
    const created = await manager.createSession();
    await manager.deleteSession(created.id);
    await expect(manager.getSession(created.id)).rejects.toThrow(SessionNotFoundError);
  });

  it('adds a message', async () => {
    const session = await manager.createSession();
    const message = await manager.addMessage(session.id, {
      role: 'user',
      content: 'Hello',
    });
    expect(message.content).toBe('Hello');
    expect(message.sessionId).toBe(session.id);
  });

  it('retrieves messages', async () => {
    const session = await manager.createSession();
    await manager.addMessage(session.id, { role: 'user', content: 'Hello' });
    await manager.addMessage(session.id, { role: 'assistant', content: 'Hi' });

    const messages = await manager.getMessages(session.id);
    expect(messages).toHaveLength(2);
  });

  it('gets conversation context with truncation', async () => {
    const budget: TokenBudgetConfig = {
      maxTokens: 100,
      reserveTokens: 20,
      overflowStrategy: 'truncate',
    };

    const mgr = new SessionManager({
      storage: adapter,
      tokenCounter: new EstimateTokenizer(),
      tokenBudget: budget,
    });

    const session = await mgr.createSession({ tokenBudget: budget });
    await mgr.addMessage(session.id, { role: 'user', content: 'A'.repeat(200) });
    await mgr.addMessage(session.id, { role: 'assistant', content: 'B'.repeat(200) });

    const context = await mgr.getConversationContext(session.id);
    expect(context.length).toBeLessThanOrEqual(2);
  });

  it('adds and removes participants', async () => {
    const session = await manager.createSession();
    const participant = await manager.addParticipant(session.id, {
      id: 'user-1',
      role: 'user',
    });
    expect(participant.id).toBe('user-1');

    const participants = await manager.getParticipants(session.id);
    expect(participants).toHaveLength(1);

    await manager.removeParticipant(session.id, 'user-1');
    const updated = await manager.getParticipants(session.id);
    expect(updated[0].leftAt).toBeDefined();
  });

  it('performs agent handoff', async () => {
    const session = await manager.createSession({ activeAgentId: 'agent-A' });
    await manager.handoffToAgent(session.id, 'agent-B', { reason: 'Specialized help' });

    const updated = await manager.getSession(session.id);
    expect(updated.activeAgentId).toBe('agent-B');
  });

  it('throws on handoff to same agent', async () => {
    const session = await manager.createSession({ activeAgentId: 'agent-A' });
    await expect(manager.handoffToAgent(session.id, 'agent-A')).rejects.toThrow(HandoffError);
  });

  it('emits events', async () => {
    const handler = vi.fn();
    manager.on('session:created', handler);

    const session = await manager.createSession();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session:created',
        sessionId: session.id,
      })
    );
  });

  it('cleans up expired sessions', async () => {
    const ttlAdapter = new MemoryAdapter();
    const ttlManager = new SessionManager({
      storage: ttlAdapter,
      tokenCounter: new EstimateTokenizer(),
    });

    const session = await ttlManager.createSession();
    // Manually set expiresAt to past
    await ttlAdapter.updateSession(session.id, { expiresAt: new Date(Date.now() - 1000) });

    const cleaned = await ttlManager.cleanupExpiredSessions();
    expect(cleaned).toBe(1);
  });

  it('returns healthy status', async () => {
    const health = await manager.health();
    expect(health.status).toBe('healthy');
  });

  it('compresses context when compression config is set', async () => {
    const compressionMgr = new SessionManager({
      storage: adapter,
      tokenCounter: new EstimateTokenizer(),
      compression: {
        strategy: 'sliding_window',
        targetTokens: 50,
        maxMessages: 2,
      },
    });

    const session = await compressionMgr.createSession();
    await compressionMgr.addMessage(session.id, { role: 'user', content: 'A'.repeat(200) });
    await compressionMgr.addMessage(session.id, { role: 'assistant', content: 'B'.repeat(200) });

    const result = await compressionMgr.compressContext(session.id);
    expect(result.strategy).toBe('sliding_window');
    expect(result.compressedMessages.length).toBeLessThanOrEqual(2);
  });

  it('throws when compressing without config', async () => {
    const session = await manager.createSession();
    await expect(manager.compressContext(session.id)).rejects.toThrow(
      'No compression config available'
    );
  });

  it('uses summarization compression strategy', async () => {
    const summaryMgr = new SessionManager({
      storage: adapter,
      tokenCounter: new EstimateTokenizer(),
      compression: {
        strategy: 'summarization',
        targetTokens: 50,
        summarizer: { summarize: async () => 'Summary' },
      },
    });
    const session = await summaryMgr.createSession();
    await summaryMgr.addMessage(session.id, { role: 'user', content: 'A'.repeat(200) });
    await summaryMgr.addMessage(session.id, { role: 'assistant', content: 'B'.repeat(200) });

    const result = await summaryMgr.compressContext(session.id);
    expect(result.strategy).toBe('summarization');
    expect(result.summary).toBe('Summary');
  });

  it('uses hybrid compression strategy', async () => {
    const hybridMgr = new SessionManager({
      storage: adapter,
      tokenCounter: new EstimateTokenizer(),
      compression: {
        strategy: 'hybrid',
        targetTokens: 50,
        maxMessages: 1,
        summarizer: { summarize: async () => 'Summary' },
      },
    });
    const session = await hybridMgr.createSession();
    await hybridMgr.addMessage(session.id, { role: 'user', content: 'A'.repeat(200) });
    await hybridMgr.addMessage(session.id, { role: 'assistant', content: 'B'.repeat(200) });

    const result = await hybridMgr.compressContext(session.id);
    expect(result.strategy).toBe('hybrid');
  });

  it('throws when compression strategy requires summarizer but none provided', async () => {
    const badMgr = new SessionManager({
      storage: adapter,
      tokenCounter: new EstimateTokenizer(),
      // Cast to bypass type checking for test
      compression: {
        strategy: 'summarization',
        targetTokens: 50,
      } as unknown as Parameters<typeof SessionManager>[0]['compression'],
    });
    const session = await badMgr.createSession();
    await expect(badMgr.compressContext(session.id)).rejects.toThrow('requires a summarizer');
  });

  it('closes and cleans up timer', async () => {
    const mgrWithCleanup = new SessionManager({
      storage: adapter,
      tokenCounter: new EstimateTokenizer(),
      cleanupInterval: 1,
    });
    await mgrWithCleanup.close();
    // Should not throw on second close
    await mgrWithCleanup.close();
  });

  it('throws TokenBudgetExceededError on overflowStrategy error during addMessage', async () => {
    const budgetMgr = new SessionManager({
      storage: adapter,
      tokenCounter: new EstimateTokenizer(),
      tokenBudget: {
        maxTokens: 10,
        reserveTokens: 0,
        overflowStrategy: 'error',
      },
    });

    const session = await budgetMgr.createSession();
    await expect(
      budgetMgr.addMessage(session.id, {
        role: 'user',
        content: 'A'.repeat(100),
      })
    ).rejects.toThrow('Token budget exceeded');
  });

  it('throws TokenBudgetExceededError on overflowStrategy error during getConversationContext', async () => {
    const budgetMgr = new SessionManager({
      storage: adapter,
      tokenCounter: new EstimateTokenizer(),
      tokenBudget: {
        maxTokens: 100,
        reserveTokens: 0,
        overflowStrategy: 'error',
      },
    });

    const session = await budgetMgr.createSession();
    // Add messages that fit within 100 tokens
    await budgetMgr.addMessage(session.id, { role: 'user', content: 'A'.repeat(80) });
    await budgetMgr.addMessage(session.id, { role: 'assistant', content: 'B'.repeat(80) });

    // Update session budget to be lower so getConversationContext sees overflow
    await adapter.updateSession(session.id, {
      tokenBudget: {
        maxTokens: 10,
        reserveTokens: 0,
        overflowStrategy: 'error',
      },
    });

    await expect(budgetMgr.getConversationContext(session.id)).rejects.toThrow(
      'Token budget exceeded'
    );
  });

  it('starts cleanup job from constructor', async () => {
    const cleanupAdapter = new MemoryAdapter();
    const mgr = new SessionManager({
      storage: cleanupAdapter,
      tokenCounter: new EstimateTokenizer(),
      cleanupInterval: 1,
    });

    // Create a session that expires quickly
    const session = await mgr.createSession();
    await cleanupAdapter.updateSession(session.id, { expiresAt: new Date(Date.now() - 1000) });

    // Manually trigger cleanup (rather than waiting for interval)
    const cleaned = await mgr.cleanupExpiredSessions();
    expect(cleaned).toBe(1);

    // Should have cleaned up
    await expect(mgr.getSession(session.id)).rejects.toThrow(SessionNotFoundError);
    await mgr.close();
  });
});
