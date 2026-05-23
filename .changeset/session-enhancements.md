---
'@reaatech/session-continuity': minor
'@reaatech/session-continuity-storage-memory': minor
'@reaatech/session-continuity-storage-dynamodb': minor
'@reaatech/session-continuity-storage-firestore': minor
'@reaatech/session-continuity-storage-redis': minor
---

Production-hardening enhancements to core session management:

- **Cached compression summaries** — summarization/hybrid results are cached on
  `session.compressionState` and reused while the message set is unchanged, so
  the (LLM-backed) summarizer is no longer re-invoked on every context fetch.
- **Running token/message counts** — `Session.tokenCount`/`messageCount` are
  maintained incrementally, removing the O(n) re-sum on every `addMessage`.
- **Optimistic concurrency** — new `ConcurrencyError` and `expectedVersion`
  conditional writes, now enforced by every storage adapter: in-memory
  (version check), DynamoDB (`version` `ConditionExpression`), Firestore
  (`runTransaction` read-check-write), and Redis (`WATCH`/`MULTI`/`EXEC`).
  `SessionManager` read-modify-write paths retry on conflict.
- **Image token accounting** — `imageTokenCost` config so `image_url` blocks
  contribute to the budget instead of counting as zero.
- **New `SessionManager` methods** — `listSessions`, `updateMessage`,
  `deleteMessage`, and `getConversationContextWithStats` (returns budget and
  compression diagnostics).
- **Deterministic ordering** — messages carry a monotonic `sequence`; ordering
  breaks same-millisecond ties by `sequence` (else `id`) via the new exported
  `compareMessages` helper. Adapter coverage: in-memory and Redis assign a true
  per-session `sequence` (Redis via an atomic `INCR` counter scoring the sorted
  set); Firestore uses time-sortable, monotonic message document ids so its
  `(createdAt, __name__)` ordering yields insertion order without a
  hot-document counter; DynamoDB uses time-sortable, monotonic message ids in
  its `MSG#<createdAt>#<id>` sort key so same-millisecond messages also keep
  insertion order.
- **Consistency fixes** — `endSession`/`deleteSession` now throw
  `SessionNotFoundError` for missing sessions.
