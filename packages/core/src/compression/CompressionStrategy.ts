import type { Message } from '../types/session.js';
import type { TokenCounter } from '../types/token.js';

/**
 * Calculate token count for a message, using cached count if available.
 */
export function calculateMessageTokens(message: Message, counter: TokenCounter): number {
  if (message.tokenCount !== undefined) {
    return message.tokenCount;
  }

  let count: number;
  if (typeof message.content === 'string') {
    count = counter.count(message.content);
  } else if (Array.isArray(message.content)) {
    const text = message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('');
    count = counter.count(text);
  } else {
    count = counter.count(JSON.stringify(message.content));
  }

  if (message.metadata?.toolCalls) {
    for (const toolCall of message.metadata.toolCalls) {
      count += counter.count(toolCall.name);
      count += counter.count(toolCall.arguments);
    }
  }

  if (message.metadata?.toolResults) {
    for (const toolResult of message.metadata.toolResults) {
      count += counter.count(toolResult.result);
    }
  }

  return count;
}

/**
 * Deterministic chronological comparison of two messages.
 *
 * Orders by `createdAt`, breaking ties with the monotonic `sequence` when both
 * messages carry one (true insertion order), and otherwise by `id`. This keeps
 * ordering stable and reproducible even when messages share the same
 * millisecond timestamp — so a user/assistant turn or a tool-call/result pair
 * never reorders between reads.
 *
 * Returns a negative number when `a` precedes `b`, positive when it follows.
 */
export function compareMessages(a: Message, b: Message): number {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.sequence !== undefined && b.sequence !== undefined) {
    return a.sequence - b.sequence;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Separate system messages from other messages.
 */
export function preserveSystemMessages(messages: Message[]): {
  systemMessages: Message[];
  otherMessages: Message[];
} {
  return {
    systemMessages: messages.filter((m) => m.role === 'system'),
    otherMessages: messages.filter((m) => m.role !== 'system'),
  };
}

/**
 * Greedily fit messages within a token budget, preserving order.
 * Processes from newest to oldest, returns kept messages in original order.
 */
export function fitMessagesWithinBudget(
  messages: Message[],
  budget: number,
  counter: TokenCounter
): { kept: Message[]; removed: Message[] } {
  const { systemMessages, otherMessages } = preserveSystemMessages(messages);

  const systemTokens = systemMessages.reduce(
    (sum, m) => sum + calculateMessageTokens(m, counter),
    0
  );

  // Sort non-system newest first (deterministic on same-ms ties)
  const sortedOthers = [...otherMessages].sort((a, b) => compareMessages(b, a));

  const kept: Message[] = [];
  let currentTokens = systemTokens;

  for (const message of sortedOthers) {
    const tokenCount = calculateMessageTokens(message, counter);
    if (currentTokens + tokenCount <= budget) {
      kept.unshift(message); // prepend to maintain chronological order
      currentTokens += tokenCount;
    } else {
      break;
    }
  }

  const keptSet = new Set([...systemMessages, ...kept]);
  const removed = messages.filter((m) => !keptSet.has(m));

  return { kept: [...systemMessages, ...kept], removed };
}
