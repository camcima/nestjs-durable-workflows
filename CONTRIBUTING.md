# Contributing to nestjs-durable-workflows

Thank you for your interest in contributing. This document covers everything you need to get started.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Running Tests](#running-tests)
- [Code Style](#code-style)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Adding a New Database Adapter](#adding-a-new-database-adapter)

## Development Setup

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **Docker** (for E2E tests only)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/camcima/nestjs-durable-workflows.git
cd nestjs-durable-workflows

# Install dependencies
npm install

# Verify everything works
npm test
```

### Building

```bash
npm run build
```

This runs the TypeScript compiler (`tsc`) and outputs to `dist/`.

### Type Checking

```bash
npx tsc --noEmit
```

Runs type checking without emitting output files. Useful for a quick validation pass.

## Project Structure

```
src/
├── index.ts                              # Public API barrel export
├── workflow.module.ts                    # NestJS dynamic module (forRoot/forRootAsync)
├── workflow.constants.ts                 # Injection tokens and defaults
├── interfaces/
│   ├── workflow-db-adapter.interface.ts  # Database adapter contract
│   ├── workflow-module-options.interface.ts
│   └── workflow-records.interface.ts     # WorkflowRecord, HistoryRecord, WorkflowResult
├── services/
│   ├── workflow-manager.service.ts       # Core engine (send events, persist state)
│   ├── workflow-registry.service.ts      # Auto-discovers @WorkflowEntity providers
│   └── timeout-cron.service.ts           # Periodic expiration check
├── adapters/
│   └── drizzle-workflow.adapter.ts       # Drizzle ORM adapter implementation
├── decorators/
│   └── workflow-entity.decorator.ts      # @WorkflowEntity decorator
├── errors/
│   ├── recursive-transition.error.ts
│   ├── workflow-not-registered.error.ts
│   └── duplicate-registration.error.ts
├── events/
│   ├── workflow-event-type.enum.ts       # Event type string constants
│   └── workflow-events.ts                # Event payload interfaces
├── utils/
│   ├── flatten-state-value.ts            # XState StateValue -> dot-notation string
│   ├── derive-table-name.ts              # PascalCase -> snake_case pluralized
│   └── get-timeout-minutes.ts            # Extract timeoutMinutes from state meta
└── cli/
    └── generate-migration.ts             # CLI + generateMigration() function

tests/
├── helpers.ts                            # Shared mock factories
├── unit/                                 # Fast, no external dependencies
│   ├── flatten-state-value.spec.ts
│   ├── derive-table-name.spec.ts
│   ├── get-timeout-minutes.spec.ts
│   ├── workflow-registry.spec.ts
│   ├── workflow-entity-decorator.spec.ts
│   └── generate-migration.spec.ts
├── integration/                          # Mock database adapter, real XState
│   ├── workflow-manager.spec.ts
│   ├── always-transitions.spec.ts
│   ├── workflow-module.spec.ts
│   ├── drizzle-adapter.spec.ts
│   └── timeout-cron.spec.ts
└── e2e/                                  # Real PostgreSQL via Docker
    ├── docker-compose.yml
    ├── persistence-loop.spec.ts
    └── concurrency.spec.ts
```

### Key Conventions

- **One class per file.** Services, adapters, decorators, and error classes each live in their own file.
- **Barrel export.** `src/index.ts` re-exports everything that is part of the public API. Internal implementation details should not be exported here.
- **Shared test helpers.** `tests/helpers.ts` contains `createMockRegistry()` and `createMockAdapter()`. Use these instead of duplicating mock setup across test files.

## Running Tests

### Test Tiers

The test suite is split into three tiers with increasing scope:

| Tier        | Command                    | Dependencies           | Speed |
| ----------- | -------------------------- | ---------------------- | ----- |
| Unit        | `npm run test:unit`        | None                   | ~3s   |
| Integration | `npm run test:integration` | None (mock DB)         | ~13s  |
| E2E         | `npm run test:e2e`         | Docker (PostgreSQL 18) | ~30s  |

### Everyday Development

```bash
# Run all unit + integration tests (no Docker needed)
npm test

# Run a specific test file
npx jest tests/unit/flatten-state-value.spec.ts

# Run tests in watch mode
npx jest --watch
```

### E2E Tests

E2E tests require a running PostgreSQL 18 instance:

```bash
# Start the database
docker compose -f tests/e2e/docker-compose.yml up -d

# Wait for it to be ready
docker compose -f tests/e2e/docker-compose.yml exec postgres pg_isready -U test

# Run E2E tests
npm run test:e2e

# Tear down when done
docker compose -f tests/e2e/docker-compose.yml down
```

The PostgreSQL instance runs on port **5499** to avoid conflicts with any local PostgreSQL installation.

### Coverage

```bash
npm run test:coverage
```

The project targets **90%+ code coverage** on statements and lines. Coverage is collected from `src/**/*.ts`, excluding `src/index.ts` (barrel) and `src/cli/**/*.ts` (CLI entry point).

When adding new source files, check that coverage doesn't drop below the threshold.

## Code Style

### TypeScript

- **Strict mode is enabled.** All `strict` flags are on in `tsconfig.json`, including `noUnusedLocals`, `noUnusedParameters`, and `noImplicitReturns`.
- **Target ES2021.** Use modern JavaScript features available in Node.js 18+.
- **Use `type` imports** for types that are only used in type positions: `import type { AnyStateMachine } from 'xstate'`.
- **Prefer `interface` over `type`** for object shapes.
- **No `any` unless absolutely necessary.** When interfacing with loosely-typed external APIs (like Drizzle's `execute` result), use `any` with a comment explaining why.

### Naming

| Thing      | Convention                                         | Example                        |
| ---------- | -------------------------------------------------- | ------------------------------ |
| Files      | kebab-case with suffix                             | `workflow-manager.service.ts`  |
| Classes    | PascalCase                                         | `WorkflowManager`              |
| Interfaces | PascalCase, `I` prefix for contracts               | `IWorkflowDbAdapter`           |
| Functions  | camelCase                                          | `flattenStateValue`            |
| Constants  | UPPER_SNAKE_CASE                                   | `DEFAULT_MAX_DEPTH`            |
| Enums      | PascalCase (enum name), UPPER_SNAKE_CASE (members) | `WorkflowEventType.TRANSITION` |
| Test files | Same name as source + `.spec.ts`                   | `flatten-state-value.spec.ts`  |

### NestJS Conventions

- Use `@Injectable()` on all services.
- Use `@Inject(TOKEN)` for custom injection tokens.
- Use `Logger` from `@nestjs/common` (not `console.log`).
- Implement `OnModuleInit` for startup logic (not constructor side effects).

### Error Handling

- Custom error classes extend `Error` and set `this.name` in the constructor.
- Include relevant context as public readonly properties (e.g., `workflowId`, `tableName`).
- The constructor message should be human-readable and actionable.

### Tests

- Use `describe` blocks to group related tests. Nest them for sub-categories.
- Test names start with `should` and describe the expected behavior.
- Use `jest.Mocked<T>` for typed mocks.
- Use the shared helpers in `tests/helpers.ts` for registry and adapter mocks.
- Keep unit tests focused on a single function/class. Keep integration tests focused on a single interaction flow.

## Making Changes

### Before You Start

1. Check [existing issues](https://github.com/camcima/nestjs-durable-workflows/issues) to see if someone is already working on it.
2. For non-trivial changes, open an issue first to discuss the approach.

### Workflow

1. Fork the repository and create a branch from `main`:

   ```bash
   git checkout -b your-feature-name
   ```

2. Make your changes. Follow the [code style](#code-style) guidelines.

3. **Write tests first** (TDD). Add unit tests for pure functions and integration tests for service interactions. The test should fail before you write the implementation.

4. Run the full test suite:

   ```bash
   npm test
   ```

5. Check type safety:

   ```bash
   npx tsc --noEmit
   ```

6. Check coverage hasn't dropped:

   ```bash
   npm run test:coverage
   ```

7. If you've changed the public API, update `src/index.ts` and the relevant docs under `docs/`.

8. Commit with a clear message (see [commit messages](#commit-messages)).

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>: <description>

[optional body]
```

Types:

| Type       | When to Use                                             |
| ---------- | ------------------------------------------------------- |
| `feat`     | New feature or capability                               |
| `fix`      | Bug fix                                                 |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test`     | Adding or updating tests                                |
| `docs`     | Documentation changes                                   |
| `chore`    | Build process, dependencies, CI changes                 |

Examples:

```
feat: add Prisma adapter implementation
fix: prevent duplicate history rows on concurrent sends
test: add integration tests for timeout edge cases
docs: update adapter guide with Prisma example
```

### What to Include in a PR

- The code change itself.
- Tests covering the new/changed behavior.
- Documentation updates if the public API changed.
- An updated `src/index.ts` if new classes/interfaces/functions were added to the public API.

## Pull Request Process

1. Ensure all tests pass and coverage is >= 90%.
2. Update documentation if you changed behavior or public API.
3. Fill in the PR template with a summary and test plan.
4. Request a review.
5. Address review feedback with new commits (don't force-push during review).
6. Once approved, the maintainer will squash-merge.

## Adding a New Database Adapter

If you're contributing a new adapter (e.g., Prisma, Knex, MikroORM):

1. **Create the adapter** in `src/adapters/{orm}-workflow.adapter.ts`.
2. **Implement `IWorkflowDbAdapter`** -- all 6 methods.
3. **Validate table names** in the constructor and/or methods to prevent SQL injection.
4. **Handle transactions** -- `transaction()` must provide a new adapter instance bound to the transaction context.
5. **Write integration tests** in `tests/integration/{orm}-adapter.spec.ts` with a mock database object (follow the pattern in `drizzle-adapter.spec.ts`).
6. **Export the adapter** from `src/index.ts`.
7. **Add documentation** -- update `docs/database-adapters.md` with setup instructions and a usage example.
8. **Add the ORM to `peerDependencies`** (not `dependencies`) since users should only install the ORM they use.

See `src/adapters/drizzle-workflow.adapter.ts` and `tests/integration/drizzle-adapter.spec.ts` as the reference implementation.
