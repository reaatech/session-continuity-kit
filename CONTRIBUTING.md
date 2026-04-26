# Contributing to Session Continuity Kit

Thank you for your interest in contributing! We welcome contributions from the community.

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- Git

### Setting Up Development Environment

```bash
# Fork the repository
git clone https://github.com/your-username/session-continuity-kit.git
cd session-continuity-kit

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Development Workflow

### 1. Create a Branch

```bash
# Create a feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/bug-description
```

### 2. Make Changes

Follow these guidelines when making changes:

- **Type Safety**: No `any` types in public API
- **Testing**: Write tests for all new functionality
- **Documentation**: Add JSDoc comments to all public APIs
- **Code Style**: Follow existing code patterns
- **Error Handling**: Use custom error classes

### 3. Run Tests

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run specific test file
pnpm test packages/core/src/session/SessionManager.test.ts
```

### 4. Check Code Quality

```bash
# Type check
pnpm type-check

# Lint
pnpm lint

# Format check
pnpm format:check

# Format code
pnpm format
```

### 5. Commit Changes

We use [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# Feature
git commit -m "feat: add new compression strategy"

# Bug fix
git commit -m "fix: resolve memory leak in Redis adapter"

# Documentation
git commit -m "docs: update API reference"

# Refactor
git commit -m "refactor: simplify token counting logic"

# Tests
git commit -m "test: add edge case tests for sliding window"
```

### 6. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub.

## Pull Request Guidelines

### PR Title

Use conventional commit format:

- `feat: description` for new features
- `fix: description` for bug fixes
- `docs: description` for documentation
- `refactor: description` for refactoring
- `test: description` for test additions
- `chore: description` for maintenance

### PR Description

Include:

- **What** changed and **why**
- **How** to test the changes
- **Related issues** (e.g., "Closes #123")
- **Breaking changes** (if any)

### PR Checklist

Before submitting, ensure:

- [ ] Tests pass (`pnpm test`)
- [ ] Type check passes (`pnpm type-check`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Format is correct (`pnpm format:check`)
- [ ] Test coverage meets requirements (100% for core logic)
- [ ] Documentation is updated
- [ ] No `any` types in public API
- [ ] All public APIs have JSDoc
- [ ] Changes follow existing patterns

## Code Review Process

1. **Automated Checks**: CI runs tests, type checking, and linting
2. **Code Review**: At least one maintainer reviews the code
3. **Feedback**: Address review comments
4. **Approval**: Once approved, the PR is merged

## Areas We Welcome Contributions

### Core Features

- New compression strategies
- Additional token counter implementations
- Performance optimizations
- New storage adapters

### Documentation

- Tutorials and guides
- API documentation
- Example applications
- Translation of docs

### Testing

- Unit tests
- Integration tests
- E2E tests
- Test utilities

### Developer Experience

- Build tooling improvements
- CI/CD enhancements
- Development scripts
- Error messages

## Reporting Issues

### Bug Reports

Include:

- **Description**: Clear description of the bug
- **Steps to Reproduce**: Exact steps to reproduce
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Environment**: Node.js version, OS, package version
- **Code Example**: Minimal reproducible example

### Feature Requests

Include:

- **Use Case**: Why you need this feature
- **Proposed Solution**: How it should work
- **Alternatives**: Other solutions you've considered

## Coding Standards

### TypeScript

```typescript
// ✅ Good: Explicit types
export interface User {
  id: string;
  name: string;
  email?: string;
}

// ❌ Bad: any type
export interface User {
  id: any; // Never use any
}
```

### Error Handling

```typescript
// ✅ Good: Custom error class
if (!session) {
  throw new SessionNotFoundError(sessionId);
}

// ❌ Bad: Generic error
if (!session) {
  throw new Error('Session not found');
}
```

### JSDoc

````typescript
/**
 * Create a new session.
 *
 * @param options - Session creation options
 * @returns The created session
 *
 * @example
 * ```typescript
 * const session = await sessionManager.createSession({
 *   userId: 'user-123',
 *   metadata: { title: 'My Session' }
 * });
 * ```
 */
async createSession(options?: CreateSessionOptions): Promise<Session> {
  // implementation
}
````

### Testing

```typescript
describe('SessionManager', () => {
  describe('createSession', () => {
    it('should create a session with given options', async () => {
      // Arrange
      const options = { userId: 'user-123' };

      // Act
      const session = await sessionManager.createSession(options);

      // Assert
      expect(session.userId).toBe('user-123');
      expect(session.status).toBe('active');
      expect(session.createdAt).toBeInstanceOf(Date);
    });

    it('should emit session:created event', async () => {
      // Test event emission
    });

    it('should handle storage errors', async () => {
      // Test error handling
    });
  });
});
```

## Architecture Guidelines

### Layered Design

Maintain separation between layers:

- **API Layer**: Public interfaces and types
- **Service Layer**: Business logic
- **Repository Layer**: Data access
- **Adapter Layer**: Storage implementations

### Dependency Inversion

Depend on abstractions:

```typescript
// ✅ Good: Depends on interface
export class SessionManager {
  constructor(private storage: IStorageAdapter) {}
}

// ❌ Bad: Depends on concrete class
export class SessionManager {
  constructor(private storage: RedisAdapter) {}
}
```

### Single Responsibility

Each class should have one clear purpose:

```typescript
// ✅ Good: Focused classes
class TokenBudget {
  /* token budget logic */
}
class MessageWindow {
  /* message window logic */
}
class SessionManager {
  /* session orchestration */
}

// ❌ Bad: God class
class SessionManager {
  // 1000 lines doing everything
}
```

## Questions?

If you have questions, please:

- Check existing [documentation](./DEV_PLAN.md)
- Search [existing issues](https://github.com/reaatech/session-continuity-kit/issues)
- Start a [discussion](https://github.com/reaatech/session-continuity-kit/discussions)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

## Code of Conduct

Please be respectful and constructive in all interactions. We are committed to providing a welcoming and inclusive community.

---

Thank you for contributing to session-continuity-kit! 🎉
