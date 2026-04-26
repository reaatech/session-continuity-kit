# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-22

### Added

- Initial release of session-continuity-kit
- **Core session management**: `SessionManager` with create, read, update, delete, and lifecycle operations
- **Token budget management**: `TokenBudget` with configurable overflow strategies (`error`, `truncate`, `compress`)
- **Message windowing**: `MessageWindow` for fitting messages within token constraints
- **Compression strategies**:
  - `SlidingWindowStrategy` — keeps most recent messages within budget
  - `SummarizationStrategy` — summarizes older messages via LLM
  - `HybridStrategy` — combines sliding window for recent + summarization for older context
- **Storage adapters**:
  - `MemoryAdapter` — in-memory adapter for development and testing
  - `FirestoreAdapter` — Google Cloud Firestore integration with TTL support
  - `DynamoDBAdapter` — AWS DynamoDB single-table design with GSIs
  - `RedisAdapter` — Redis adapter with hashes, sorted sets, and native TTL
- **Tokenizers**:
  - `TiktokenTokenizer` — OpenAI tiktoken-based counting
  - `AnthropicTokenizer` — Anthropic Claude tokenizer support
  - `EstimateTokenizer` — fast character-ratio estimation
  - `TokenizerFactory` — create tokenizers by model name
- **Event system**: `SessionEventEmitter` with typed session lifecycle events
- **Agent handoff**: transfer session ownership between agents mid-conversation
- **Session repository**: repository pattern abstraction over storage adapters
- **Custom error hierarchy**: `SessionError`, `SessionNotFoundError`, `TokenBudgetExceededError`, `StorageError`, `CompressionError`, `ValidationError`, `HandoffError`

### Known limitations

- No optimistic concurrency control — concurrent `updateSession` calls last-write-wins across all adapters. The `Session.version` field is reserved for future enforcement.

[0.1.0]: https://github.com/reaatech/session-continuity-kit/releases/tag/v0.1.0
