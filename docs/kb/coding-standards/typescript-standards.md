# TypeScript Coding Standards

## Type Safety
- `strict: true` in tsconfig — no implicit `any`, no unchecked index access
- Prefer `unknown` over `any`; narrow with type guards before use
- Never use non-null assertion (`!`) without a comment explaining why null is impossible
- Use `readonly` on all DTO and domain object properties
- Prefer discriminated unions over optional fields for state representation

## Naming Conventions
- Variables and functions: camelCase (`analysisJobId`, `handleWebhook`)
- Classes, interfaces, types, enums: PascalCase (`AnalysisJob`, `OrgId`)
- Constants and enum values: SCREAMING_SNAKE_CASE (`MAX_RETRY_COUNT`)
- Files: kebab-case matching export (`analysis-job.ts` exports `AnalysisJob`)
- Boolean variables: prefix with `is`, `has`, `can`, `should` (`isActive`, `hasPermission`)

## Function Design
- Functions should do one thing; max 30 lines as a guideline
- Prefer pure functions; isolate side effects at the boundary
- No function with more than 4 parameters — use an options object
- Always handle the error path explicitly; never swallow exceptions silently

## Error Handling
- Use typed error classes extending `Error` (`class ValidationError extends Error`)
- Lambda handlers: catch at the top level, log with context, return appropriate HTTP status
- Never `throw` inside a Promise chain without a `.catch()` handler
- SQS consumers: throw on unrecoverable errors so message goes to DLQ; return on skip

## Async Patterns
- Always `await` async calls — never fire-and-forget in Lambda (process freezes)
- Use `Promise.all()` for independent parallel operations
- Use `Promise.allSettled()` when partial failure is acceptable and must be handled
- Never use `setTimeout` in Lambda — it may not fire before the freeze

## Imports and Module Structure
- Use ES module imports (`import`, not `require`)
- Group imports: (1) Node builtins, (2) third-party, (3) internal packages, (4) local files
- Avoid circular dependencies — use dependency injection or event-based decoupling
- Barrel exports (`index.ts`) only for public API of a package; never for internal modules

## Code Quality
- No commented-out code in PRs — remove or create a ticket
- No TODO/FIXME without a linked issue number
- Prefer explicit `return` in all code paths over implicit `undefined` return
- String literals used more than once → named constant

## Testing Requirements
- Unit tests for all pure functions and business logic
- Integration tests for DynamoDB, SQS, and Secrets Manager interactions (use real AWS in test env)
- No mocking of AWS SDK in integration tests — mock at the boundary, not inside
- Test file colocated with source: `handler.test.ts` next to `handler.ts`
- Coverage target: 80% line coverage for Lambda handlers

## Common Code Review Findings
- `JSON.parse(body)` without try/catch → MEDIUM (unhandled parse error crashes handler)
- `process.env['KEY']` used without null check → MEDIUM
- `await` inside a `forEach` loop → MEDIUM (runs sequentially, not in parallel)
- `console.log` with sensitive data (tokens, secrets, emails) → HIGH
- Mutation of function parameter objects → MEDIUM (unexpected side effects)
- Missing `export type` for re-exported types (TypeScript 5 isolatedModules) → LOW
