import type { MessageContent } from '@reaatech/session-continuity';

/**
 * Extract text-only content from a MessageContent value.
 * For multi-modal arrays, only text blocks are included.
 */
export function extractTextFromContent(content: MessageContent): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }

  return JSON.stringify(content);
}
