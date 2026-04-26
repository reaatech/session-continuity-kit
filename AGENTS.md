# Session Continuity Kit — AI Agent Development Guide

## Project Overview

**session-continuity-kit** is a TypeScript library for multi-turn session management in AI agent systems, extracted from real-world implementations (AskGM, REAA voice agent, voice-agent-kit).

- **GitHub**: [reaatech/session-continuity-kit](https://github.com/reaatech/session-continuity-kit)
- **License**: MIT
- **Package Manager**: pnpm
- **Language**: TypeScript 5.3+

## Development Principles

### 1. Code Quality

- **Type Safety**: No `any` types in public API; use proper TypeScript interfaces
- **Test Coverage**: 100% coverage for core logic; tests must pass before merge
- **Documentation**: All public APIs must have JSDoc comments with examples
- **Error Handling**: Use custom error classes; never swallow errors silently

### 2. Architecture Adherence

- **Layered Design**: Maintain separation between API, services, strategies, and adapters
- **Dependency Inversion**: Depend on abstractions (`IStorageAdapter`, `ICompressionStrategy`)
- **Single Responsibility**: Each class/module has one clear purpose
- **Extensibility**: New features should not require modifying existing code (Open/Closed Principle)

### 3. Testing Strategy

- **Unit Tests**: Test each class in isolation with mocks
- **Integration Tests**: Test adapter implementations with real/simulated backends
- **E2E Tests**: Test complete workflows from session creation to cleanup
- **Test Isolation**: Tests must be independent and runnable in any order

### 4. Performance

- **Token Counting**: Cache token counts; avoid recalculation
- **Storage Queries**: Use proper indexes; avoid N+1 queries
- **Memory Usage**: Stream large datasets; avoid loading entire session history when possible
- **Latency**: Target < 10ms for session operations (excluding network)

## Project Structure

```
session-continuity-kit/
├── packages/
│   ├── core/                    # Core abstractions & session manager
│   ├── storage-firestore/       # Firestore adapter
│   ├── storage-dynamodb/        # DynamoDB adapter
│   ├── storage-redis/           # Redis adapter
│   ├── storage-memory/          # In-memory adapter (dev/testing)
│   └── tokenizers/              # Token counting utilities
├── examples/                    # Runnable examples
├── tests/                       # Integration & E2E tests
├── skills/                      # Agent skills for development
├── DEV_PLAN.md                  # Development plan
├── ARCHITECTURE.md              # Architecture deep dive
├── AGENTS.md                    # This file
├── package.json                 # Root workspace config
├── pnpm-workspace.yaml          # pnpm workspace definition
└── tsconfig.base.json           # Shared TypeScript config
```

## Agent Skills

This project includes AI agent skills in the `skills/` directory to assist with development:

### Available Skills

| Skill                              | Purpose                                        |
| ---------------------------------- | ---------------------------------------------- |
| `project-setup`                    | Initialize project structure and configuration |
| `implement-core-types`             | Create TypeScript type definitions             |
| `implement-session-manager`        | Build the SessionManager class                 |
| `implement-compression-strategies` | Create compression strategy implementations    |
| `implement-storage-adapter`        | Build storage adapter implementations          |
| `implement-tokenizers`             | Create token counting implementations          |
| `write-tests`                      | Generate comprehensive test suites             |
| `documentation`                    | Write documentation and examples               |
| `code-review`                      | Review code for quality and consistency        |
| `refactor`                         | Refactor code for improvements                 |

### Using Agent Skills

Skills are designed to be invoked by AI agents (like Cline) to perform specific development tasks. Each skill:

1. **Has a clear purpose**: One skill = one type of task
2. **Follows conventions**: Consistent structure and patterns
3. **Includes validation**: Checks for correctness before completion
4. **Provides examples**: Shows expected input/output

Example usage in a conversation:

```
I need to implement the SlidingWindowStrategy. Please use the implement-compression-strategies skill.
```

## Development Workflow

### 1. Setting Up

```bash
# Clone the repository
git clone https://github.com/reaatech/session-continuity-kit.git
cd session-continuity-kit

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### 2. Making Changes

1. **Create a branch**: `git checkout -b feature/your-feature`
2. **Implement changes**: Follow the architecture and coding standards
3. **Write tests**: Ensure all new code is tested
4. **Update documentation**: Update relevant docs and examples
5. **Run tests**: `pnpm test` must pass
6. **Build**: `pnpm build` must succeed
7. **Commit**: Use conventional commits (`feat:`, `fix:`, `docs:`, etc.)
8. **Push and PR**: Create a pull request

### 3. Code Review Checklist

- [ ] TypeScript types are strict and complete
- [ ] All public APIs have JSDoc documentation
- [ ] Tests cover all code paths
- [ ] Error handling is comprehensive
- [ ] No console.log in production code
- [ ] No `any` types in public API
- [ ] Follows existing code patterns
- [ ] Documentation is updated
- [ ] Examples are provided for new features

### 4. Release Process

1. **Version bump**: Update version in package.json files
2. **Changelog**: Update CHANGELOG.md with changes
3. **Build**: `pnpm build` passes
4. **Tests**: `pnpm test` passes
5. **Tag**: Create git tag `vX.Y.Z`
6. **Publish**: `pnpm -r publish` (requires npm access)
7. **Release**: Create GitHub release with changelog

## Implementation Phases

### Phase 1: Core Foundation (Current)

- [ ] Set up monorepo with pnpm workspaces
- [ ] Implement core types and interfaces
- [ ] Create in-memory adapter
- [ ] Implement SessionManager basic operations
- [ ] Add token counting with tiktoken
- [ ] Write unit tests for core

### Phase 2: Compression Strategies

- [ ] Implement SlidingWindowStrategy
- [ ] Implement SummarizationStrategy (with mock LLM)
- [ ] Implement HybridStrategy
- [ ] Add compression configuration
- [ ] Write compression tests

### Phase 3: Storage Adapters

- [ ] Firestore adapter with TTL support
- [ ] DynamoDB adapter with single-table design
- [ ] Redis adapter with native TTL
- [ ] Adapter health checks
- [ ] Integration tests for each adapter

### Phase 4: Advanced Features

- [ ] Agent handoff mechanism
- [ ] Event system with typed events
- [ ] Session cleanup job
- [ ] Observability hooks (logging, metrics)
- [ ] Error handling improvements

### Phase 5: Polish & Production

- [ ] Comprehensive documentation
- [ ] Example applications
- [ ] Performance optimization
- [ ] Security review
- [ ] CI/CD pipeline
- [ ] Package publishing

## Key Decisions & Rationale

### Why pnpm?

- **Workspace support**: Native monorepo support with symlinks
- **Disk space**: Shared dependencies across packages
- **Speed**: Faster installs with content-addressable storage
- **Compatibility**: Works with all Node.js projects

### Why tsup?

- **Speed**: Fast bundling with esbuild
- **Simplicity**: Zero config for most use cases
- **TypeScript**: Built-in TypeScript support
- **DTS**: Automatic declaration file generation

### Why Vitest?

- **Compatibility**: Drop-in replacement for Jest
- **Speed**: Parallel thread execution
- **TypeScript**: Native TypeScript support
- **Coverage**: Built-in coverage reporting

### Why Strategy Pattern for Compression?

- **Flexibility**: Easy to add new compression strategies
- **Testing**: Each strategy can be tested in isolation
- **Configuration**: Strategies can be swapped at runtime
- **Extensibility**: Users can implement custom strategies

## Common Tasks

### Adding a New Storage Adapter

1. Create package: `packages/storage-your-adapter/`
2. Implement `IStorageAdapter` interface
3. Handle serialization/deserialization
4. Implement TTL handling
5. Add health check
6. Write integration tests
7. Add to workspace
8. Document usage

### Adding a New Compression Strategy

1. Implement `ICompressionStrategy` interface
2. Add strategy type to `CompressionStrategyType`
3. Implement `compress()` method
4. Write unit tests with various message sets
5. Add configuration options if needed
6. Document when to use this strategy

### Adding Token Counter Support

1. Implement `TokenCounter` interface
2. Add tokenizer dependency if needed
3. Handle model-specific tokenization
4. Write accuracy tests
5. Add to TokenizerFactory
6. Document supported models

## Troubleshooting

### Build Failures

```bash
# Clean and rebuild
pnpm clean
pnpm build

# Check for TypeScript errors
pnpm type-check
```

### Test Failures

```bash
# Run tests with verbose output
pnpm test -- --reporter=verbose

# Run specific test file
pnpm test packages/core/src/session/SessionManager.test.ts
```

### Dependency Issues

```bash
# Reinstall dependencies
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Update dependencies
pnpm update
```

## Resources

- [DEV_PLAN.md](./DEV_PLAN.md) — Detailed development plan
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Architecture deep dive
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [pnpm Workspace](https://pnpm.io/workspaces)
- [Vitest Documentation](https://vitest.dev/)

## Getting Help

- **GitHub Issues**: Report bugs and request features
- **GitHub Discussions**: Ask questions and share ideas
- **Discord**: Join the reaa community (link TBD)

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch
3. Follow the development workflow
4. Submit a pull request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## License

MIT License — see [LICENSE](./LICENSE) for details.
