# @session-continuity-kit/storage-firestore

Firestore storage adapter with TTL support.

## Installation

```bash
npm install @session-continuity-kit/storage-firestore @google-cloud/firestore
```

## Usage

```typescript
import { FirestoreAdapter } from '@session-continuity-kit/storage-firestore';
import { Firestore } from '@google-cloud/firestore';

const firestore = new Firestore({ projectId: 'my-project' });
const adapter = new FirestoreAdapter({ firestore });
```
