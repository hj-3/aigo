# Python Coding Standards for AI Agents

## Type Hints
- All functions must have type annotations (parameters and return type)
- Use `from __future__ import annotations` for forward references
- Prefer `TypedDict` for structured dicts; avoid untyped `dict`
- Use `Optional[X]` (or `X | None`) explicitly — never leave nullable implicit
- `dataclass` or `pydantic.BaseModel` for domain objects

## Naming Conventions
- Variables and functions: snake_case (`analysis_job_id`, `handle_pr_event`)
- Classes: PascalCase (`OrchestratorAgent`, `CodeReviewResult`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_AGENT_RETRIES`)
- Private methods: single underscore prefix (`_validate_signature`)
- Agent tool functions: descriptive verb-noun (`get_pr_diff`, `save_finding`)

## Agent-Specific Patterns
- All Strands agent tools must have a docstring — the docstring is the tool description for Claude
- Tool functions should return structured types (TypedDict or dataclass), not raw strings
- Agent tools must not raise exceptions silently — return error state in the result dict
- Never call `bedrock-runtime` directly from agent tools — use the Strands framework
- Maximum tool function body: 50 lines; extract helpers for complex logic

## Error Handling
- Use custom exception classes (`class AgentToolError(Exception)`)
- Always log the exception with context before re-raising or returning error state
- Lambda handlers: catch at top level and return structured error response
- Never use bare `except:` — always catch specific exception types

## Logging
- Use structured logging (`structlog` or `python-json-logger`)
- Required fields in every log: `org_id`, `job_id`, `agent_type`, `timestamp`
- Log at `INFO` for state transitions; `DEBUG` for tool call inputs/outputs
- Never log full PR diff content — log only metadata (pr_number, file count, diff size)

## Security in Agent Code
- Never log or store in Memory: API keys, webhook secrets, user passwords, full JWT tokens
- Sanitize PR diff content before passing to agent — strip any `ANTHROPIC_API_KEY` matches
- Validate all tool inputs before AWS API calls
- Prompt injection defense: wrap untrusted content in XML tags, instruct model to treat as data

## Testing
- Pytest with fixtures for agent tool unit tests
- Mock AWS SDK calls at the client level (moto or manual mock)
- Integration tests must use real Bedrock endpoints (not mocked) to catch API contract changes
- Test cases must cover: success path, empty result, AWS throttling, malformed input

## Performance
- Cache Secrets Manager responses in Lambda memory for the duration of the invocation
- Batch DynamoDB writes with `batch_write_item` for bulk inserts (max 25 per call)
- Use `asyncio` for I/O-bound agent tool calls where framework supports it
- Avoid loading large S3 objects into Lambda memory — stream or use pre-signed URLs

## Common Findings
- `os.environ.get('KEY')` used without default or null check in agent tools → MEDIUM
- Tool function with no return type annotation → MEDIUM (Claude cannot parse output correctly)
- `print()` instead of structured logger → LOW
- Agent calling another agent's tool directly (bypassing Strands subagent pattern) → HIGH
- Missing input validation in MCP tool before calling external API → MEDIUM
