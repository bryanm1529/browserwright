# Error Enrichment for Execute Tool

Status: implemented in `0.1.3`.

## Goal

Make `execute` failures easier to recover from on the next retry without writing sensitive browser state to disk.

## Shipped Design

When `execute` throws, Browserwright now:

1. Normalizes the thrown value into an `Error`
2. Classifies it into a small set of categories
3. Captures page context on a best-effort basis
4. Appends that context inline to the MCP error response

The final response format starts with a category prefix such as `[timeout]` and may include:

- Current page URL and title
- Recent console logs
- A compact interactive accessibility snapshot filtered to `interactive: true`, `compact: true`, `maxDepth: 3`

## Guardrails

- No screenshots or disk writes
- Snapshot capture is skipped for `sandbox`, `api-misuse`, `connection`, and `target-closed` errors
- Context capture is capped and best-effort so it never masks the original failure
- Snapshot and HTML text are normalized through a shared well-formed-string helper so malformed Unicode does not depend on the Node runtime version

## Implemented Files

- `browserwright/src/error-classification.ts`
- `browserwright/src/error-context.ts`
- `browserwright/src/to-well-formed-string.ts`
- `browserwright/src/mcp.ts`
- `browserwright/test/unit/error-classification.test.ts`
- `browserwright/test/unit/error-context.test.ts`
- `browserwright/test/unit/error-enrichment.test.ts`
