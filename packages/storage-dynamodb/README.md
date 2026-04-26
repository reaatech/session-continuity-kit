# @session-continuity-kit/storage-dynamodb

DynamoDB storage adapter with single-table design.

## Installation

```bash
npm install @session-continuity-kit/storage-dynamodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

## Usage

```typescript
import { DynamoDBAdapter } from '@session-continuity-kit/storage-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const adapter = new DynamoDBAdapter({ client, tableName: 'sessions' });
```
