# Skill: Project Setup

## Purpose

Initialize the session-continuity-kit monorepo structure, configuration files, and workspace setup so that subsequent development can begin.

## When to Use

- Starting the project from scratch
- Re-creating the repository structure
- Setting up CI/CD or build tooling

## Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0

## Step-by-Step Instructions

### 1. Create Root Configuration Files

Create the following files in the project root:

- `package.json` — root workspace config with `private: true`, `workspaces` reference (or rely on pnpm-workspace.yaml), dev scripts (`build`, `test`, `lint`, `type-check`)
- `pnpm-workspace.yaml` — defines `packages/*` and `examples/*` as workspace members
- `tsconfig.base.json` — shared TypeScript configuration with `strict: true`, `esModuleInterop: true`, `target: ES2022`, `moduleResolution: node`
- `turbo.json` — optional Turborepo pipeline for `build`, `test`, `lint` with caching rules
- `.editorconfig` — consistent editor settings
- `.gitignore` — ignore `node_modules`, `dist`, `.turbo`, coverage reports
- `.npmrc` — `strict-peer-dependencies=false`, `auto-install-peers=true`

### 2. Create Package Directories

Create the following directory structure under `packages/`:

```
packages/
  core/
    src/
      types/
      session/
      compression/
      repository/
      events/
      errors/
      utils/
    package.json
    tsconfig.json
  storage-firestore/src/
  storage-dynamodb/src/
  storage-redis/src/
  storage-memory/src/
  tokenizers/src/
```

Each package must have:

- `package.json` with correct `name` (`@reaatech/session-continuity[-suffix]`)
- `tsconfig.json` extending `../../tsconfig.base.json`
- `src/index.ts` (can be empty initially)

### 3. Configure Build Tooling

Each package should use `tsup` for bundling:

- Entry: `src/index.ts`
- Formats: `cjs`, `esm`
- `dts: true` for declaration files
- `sourcemap: true`
- `clean: true`

Add `tsup` as a root dev dependency.

### 4. Configure Testing

Set up Vitest at the root with:

- `vitest.workspace.ts` that discovers `packages/*/vitest.config.ts`
- Coverage provider: `v8`
- Target: 100% coverage for `packages/core`

### 5. Configure Linting & Formatting

- ESLint with `@typescript-eslint` recommended configs
- Prettier with default config
- Add `lint`, `format`, `format:check` scripts to root `package.json`

### 6. CI/CD Setup

Create `.github/workflows/ci.yml`:

- Run on Node 18, 20
- Steps: checkout, pnpm install, type-check, lint, build, test

## Validation

After setup, verify:

- [ ] `pnpm install` completes with no errors
- [ ] `pnpm build` compiles all packages
- [ ] `pnpm test` runs the test runner (even if zero tests exist)
- [ ] `pnpm type-check` passes
- [ ] `pnpm lint` passes

## Common Pitfalls

- **Do NOT** add `node_modules` or lockfiles to git — ensure `.gitignore` is correct
- **Do NOT** use `npm` or `yarn` — this project uses `pnpm` exclusively
- **Do NOT** forget `strict: true` in `tsconfig.base.json` — type safety is non-negotiable
- **Do NOT** set `private: false` in root `package.json` — the root is not publishable
