import type { Message } from './session.js';
import type { TokenCounter } from './token.js';

/** Compression strategy type */
export type CompressionStrategyType = 'sliding_window' | 'summarization' | 'hybrid';

/** Service that summarizes a list of messages into a condensed string */
export interface SummarizerService {
  summarize(messages: Message[], prompt?: string): Promise<string>;
}

/** Configuration for sliding window compression */
export interface SlidingWindowCompressionConfig {
  strategy: 'sliding_window';
  /** Target token count after compression (should be ≤ maxTokens - reserveTokens) */
  targetTokens: number;
  /** Minimum messages to keep even if over budget */
  minMessages?: number;
  /** Maximum messages to keep */
  maxMessages?: number;
}

/** Configuration for summarization compression */
export interface SummarizationCompressionConfig {
  strategy: 'summarization';
  /** Target token count after compression */
  targetTokens: number;
  /** Service that performs LLM summarization */
  summarizer: SummarizerService;
  /** Optional custom prompt for the summarizer */
  summarizationPrompt?: string;
  /** Token reserve for summary message formatting overhead (default: 50) */
  summaryOverhead?: number;
}

/** Configuration for hybrid compression */
export interface HybridCompressionConfig {
  strategy: 'hybrid';
  /** Target token count after compression */
  targetTokens: number;
  /** Number of recent messages to preserve as-is */
  maxMessages?: number;
  /** Service that performs LLM summarization */
  summarizer: SummarizerService;
  /** Optional custom prompt for the summarizer */
  summarizationPrompt?: string;
  /** Token reserve for summary message formatting overhead (default: 50) */
  summaryOverhead?: number;
}

/** Discriminated union of all compression configurations */
export type CompressionConfig =
  | SlidingWindowCompressionConfig
  | SummarizationCompressionConfig
  | HybridCompressionConfig;

/** Result of a compression operation */
export interface CompressionResult {
  originalMessages: Message[];
  compressedMessages: Message[];
  originalTokenCount: number;
  compressedTokenCount: number;
  strategy: CompressionStrategyType;
  /** Summary text if summarization was used */
  summary?: string;
  /** Messages that were removed/compressed */
  removedMessages: Message[];
}

/** Interface for compression strategies */
export interface ICompressionStrategy {
  /**
   * Compress messages to fit within token budget
   */
  compress(
    messages: Message[],
    config: CompressionConfig,
    tokenCounter: TokenCounter
  ): Promise<CompressionResult>;

  /**
   * Get the type of this strategy
   */
  readonly type: CompressionStrategyType;
}
