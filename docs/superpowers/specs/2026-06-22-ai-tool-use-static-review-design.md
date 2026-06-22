# Design: AI Tool-Use for Static Review Pipeline

**Status:** Draft
**Date:** 2026-06-22
**Owner:** Centinel Static module

## Problem

The static review pipeline in `sidecar/src/staticReview.ts` reads every artifact's
content upfront and concatenates it into the prompt for each of the four stages
(`understanding_context`, `code_review`, `requirement_validation`, `summarizing`).
A blunt `MAX_PROMPT_CHARS = 100_000` cap truncates the prompt when the project is
larger than that, and the recent commit `b0b5721` ("cap user-content size to
prevent HTTP 400 context-window errors") shows this has already started failing
on real projects.

This produces three problems simultaneously:

1. **Context window errors** — projects over ~100K characters of source hit
   provider 400s and the review fails entirely.
2. **Cost & latency waste** — every stage pays the full input-token cost even
   when only a small fraction of the codebase is relevant to the question.
3. **Review quality** — forcing the model to digest the entire codebase in one
   shot dilutes attention; smaller, focused reviews tend to produce
   higher-signal findings.

## Goal

Make the AI itself decide which files to read. Pre-send the project index
(`index.json`) and dependency graph (`graph.json`) as navigation context, and
expose tool calls so the model can fetch the specific files it wants to inspect.

The fix must:

- Apply to all four supported providers (`openai-compatible`,
  `anthropic-compatible`, `google-native`, `mimo`).
- Produce the same `Finding[]` output shape as today, so `staticSessions.ts`,
  `reportExport.ts`, and the React UI need zero changes.
- Be backward-compatible: small projects keep the existing pre-fetch path with
  identical behavior, so the change is gated on project size and easy to roll
  back via env var.

## Non-goals

- Restructuring the 4-stage pipeline.
- Changing the `Finding` schema or how findings are persisted.
- Adding tool use to the dynamic testing module (separate pipeline, separate
  spec if/when needed).
- Caching tool results across stages.
- Streaming in-progress tool outputs to the UI.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ runStaticReview() — dispatcher                                       │
│                                                                      │
│   1. indexProject()  ──▶ writes .centinel/index.json + graph.json   │
│   2. Decide path:                                                    │
│        if totalArtifactSize < STATIC_REVIEW_SMALL_PROJECT_BYTES      │
│            → runStaticReviewPrefetch()  (today's behavior)           │
│        else                                                          │
│            → runStaticReviewWithTools() (new)                        │
│   3. Both paths produce the same Finding[] shape consumed downstream │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ runStaticReviewWithTools() — new code path                           │
│                                                                      │
│   • System: index.json + graph.json + per-stage instructions        │
│   • Tools available:  fetch_file, fetch_files,                       │
│                       get_symbol_body, search_symbols                │
│   • Loop (per stage, max STATIC_REVIEW_MAX_ROUNDS, default 3):       │
│        1. callAiWithTools(messages, tools)                           │
│        2. parse response → either tool_calls OR final answer         │
│        3. if tool_calls → executeToolBatch() → append tool_result    │
│           messages → goto 1                                          │
│        4. if final answer → break                                    │
│   • On loop-exit-without-final-answer: use last model output         │
│     and log a warning thought to the progress stream                 │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ tools.ts (new module) — sidecar-local tool executor                  │
│                                                                      │
│   executeTool(name, args) → result                                   │
│     "fetch_file"        → readArtifactContent(artifactId)            │
│     "fetch_files"       → Promise.all(map fetch_file)                │
│     "get_symbol_body"   → repoIndex.getSymbolBody(fileId, symbol)    │
│     "search_symbols"    → repoIndex.searchSymbols(projectId, q)      │
│                                                                      │
│   All tools are pure sidecar functions (no HTTP round trip)          │
└──────────────────────────────────────────────────────────────────────┘
```

### Key decisions

- **Hybrid with dispatch** (not full replacement): small projects keep the
  pre-fetch path so we don't add round-trip latency for cases that work fine.
- **Tools are sidecar-local** (not exposed over HTTP): avoids serializing
  every file twice and gives us a clean unit-test surface.
- **Same `Finding[]` output**: the new path returns the same shape as the old
  one, so the database writes, progress streaming, and report export need no
  changes.

## Components & data flow

### File changes

| File | Change | Purpose |
|---|---|---|
| `sidecar/src/tools.ts` | **NEW** | Tool schemas (per provider format) + `executeTool(name, args)` dispatch |
| `sidecar/src/aiClient.ts` | **modified** | Add `callAiWithTools(messages, tools, opts)` — multi-round, returns `{ content, toolCalls, stopReason }` |
| `sidecar/src/repoIndex.ts` | **modified** | Add `searchSymbols(projectId, query)` and `getSymbolBody(fileId, symbolName)` |
| `sidecar/src/staticReview.ts` | **modified** | Extract the current `runStaticReview` body into a new function `runStaticReviewPrefetch`; replace the top of `runStaticReview` with a size-based dispatcher that routes to either `runStaticReviewPrefetch` or the new `runStaticReviewWithTools` |
| `sidecar/src/settings.ts` | **modified** | Add `STATIC_REVIEW_MAX_ROUNDS` env var (default 3) |
| `sidecar/__tests__/unit/tools.test.ts` | **NEW** | Tool executor unit tests |
| `sidecar/__tests__/unit/aiClient.test.ts` | **modified** | Add tool-loop tests with mocked fetch |
| `sidecar/__tests__/integration/staticReviewToolPath.test.ts` | **NEW** | End-to-end tool path with mocked provider |

### Per-stage data flow (new path)

```
Stage N starts
    │
    ▼
messages = [
  { system: index.json + graph.json + stage instructions },
  { user:   user remarks + stage N task }
]
    │
    ▼
loop (round 1..MAX_ROUNDS):
    │
    ▼
  callAiWithTools(messages, toolSchemas)
    │
    ├── stopReason = "end_turn"   → break, return content
    ├── stopReason = "tool_use"   → executeToolBatch(toolCalls)
    │       │
    │       ▼
    │   for each toolCall:
    │       result = executeTool(name, args)
    │       append { role:"tool", name, content: result } to messages
    │       (or provider-equivalent: Anthropic uses tool_result blocks,
    │        OpenAI uses role:"tool" with tool_call_id)
    │       │
    │       └── on error: append { role:"tool", content: "ERROR: ..." }
    │           (let the model retry or move on)
    │
    └── stopReason = "max_rounds" → log warning, use last content
```

### Tool schemas (Anthropic format; equivalent for OpenAI/Google)

```ts
const TOOL_SCHEMAS = [
  {
    name: "fetch_file",
    description: "Read the full content of a single file by its path. Use when you need to inspect a file's complete source.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root, e.g. 'src/auth/login.ts'" }
      },
      required: ["path"]
    }
  },
  {
    name: "fetch_files",
    description: "Read multiple files in one batch. More efficient than calling fetch_file repeatedly.",
    input_schema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } }
      },
      required: ["paths"]
    }
  },
  {
    name: "get_symbol_body",
    description: "Return only one symbol (function/class/interface) by name, not the whole file. Cheaper than fetch_file when you know the symbol name.",
    input_schema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path" },
        name: { type: "string", description: "Symbol name" }
      },
      required: ["file", "name"]
    }
  },
  {
    name: "search_symbols",
    description: "Search the symbol index by name. Returns matching symbols with their file paths and signatures. Use to locate candidates before fetching.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring to match against symbol names" }
      },
      required: ["query"]
    }
  }
];
```

### Tool result size cap

Each tool result is capped at **50,000 chars** before being appended to
`messages`. If `fetch_file` returns more, it's truncated with a marker:

```
[... truncated at 50,000 chars; call fetch_file with a more specific path or use get_symbol_body ...]
```

This prevents tool results themselves from blowing the context window — the
very problem we're solving.

## `callAiWithTools` per-provider implementation

### Caller-agnostic shape

```ts
type ToolCall = { id: string; name: string; input: Record<string, unknown> };
type ToolResult = { toolCallId: string; name: string; content: string; isError?: boolean };

type ToolTurn = {
  content: string | null;          // model's text reply (may be null when only tool calls)
  toolCalls: ToolCall[];          // [] if the model returned end_turn
  stopReason: 'end_turn' | 'tool_use' | 'max_rounds' | 'error';
  raw?: unknown;                  // raw provider response, for debugging
};

async function callAiWithTools(
  apiFormat: 'openai-compatible' | 'anthropic-compatible' | 'google-native',
  model: string,
  systemPrompt: string,
  messages: Message[],            // provider-shaped messages (caller passes the right shape)
  tools: ToolSchema[],
  opts: { maxRounds?: number; signal?: AbortSignal }
): Promise<ToolTurn>;
```

The caller is responsible for shaping `messages` to match the provider. This
keeps `callAiWithTools` focused on the tool-loop mechanics rather than
message-shape translation (which already lives in `buildMessages()`).

### Per-format request body assembly

```ts
// Anthropic-compatible (+ MiMo, which uses the same shape)
{
  model, max_tokens: 8192, system: systemPrompt,
  tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
  messages  // includes prior tool_use + tool_result turns
}

// OpenAI-compatible
{
  model,
  messages: [
    { role: "system", content: systemPrompt },
    ...messages
  ],
  tools: tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })),
  max_completion_tokens: 8192,
  thinking: { type: "disabled" }   // same as today
}

// Google-native
{
  systemInstruction: { parts: [{ text: systemPrompt }] },
  contents: messages.map(toGoogleParts),    // text + functionCall + functionResponse parts
  tools: [{ functionDeclarations: tools.map(toGoogleDecl) }],
  generationConfig: { maxOutputTokens: 8192 }
}
```

### Per-format response parsing

```ts
function parseAnthropicToolTurn(json: any): ToolTurn {
  const blocks = Array.isArray(json.content) ? json.content : [];
  const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  const toolCalls: ToolCall[] = blocks
    .filter((b: any) => b.type === "tool_use")
    .map((b: any) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
  const stopReason = json.stop_reason === "tool_use" ? "tool_use" : "end_turn";
  return { content: text || null, toolCalls, stopReason, raw: json };
}

function parseOpenAIToolTurn(json: any): ToolTurn {
  const msg = json.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c: any) => ({
    id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || "{}")
  }));
  const stopReason = toolCalls.length > 0 ? "tool_use" : "end_turn";
  return { content: msg.content ?? null, toolCalls, stopReason, raw: json };
}

function parseGoogleToolTurn(json: any): ToolTurn {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join("\n");
  const toolCalls: ToolCall[] = parts
    .filter((p: any) => p.functionCall)
    .map((p: any, i: number) => ({
      id: `google-${Date.now()}-${i}`,   // Google doesn't return IDs; synthesize stable ones
      name: p.functionCall.name,
      input: p.functionCall.args ?? {}
    }));
  const stopReason = toolCalls.length > 0 ? "tool_use" : "end_turn";
  return { content: text || null, toolCalls, stopReason, raw: json };
}
```

### Shared loop

```ts
async function callAiWithTools(...) {
  const maxRounds = opts.maxRounds ?? 3;
  let lastTurn: ToolTurn | null = null;

  for (let round = 0; round < maxRounds; round++) {
    const turn = await singleToolCall(apiFormat, model, systemPrompt, messages, tools);
    lastTurn = turn;

    if (turn.stopReason === "end_turn") return turn;
    if (turn.stopReason === "error") return turn;
    if (turn.toolCalls.length === 0) return turn;  // safety

    // Execute tools (in parallel within a round, sequentially across rounds)
    const results = await Promise.all(turn.toolCalls.map(executeToolCall));
    // Append tool results to messages in the provider's shape
    messages = appendToolResults(messages, turn.toolCalls, results, apiFormat);
  }

  // Exhausted rounds without end_turn — return last turn with a flag
  if (lastTurn) return { ...lastTurn, stopReason: "max_rounds" };
  // Degenerate case: maxRounds was 0 — return a stub so the caller can degrade gracefully
  return { content: null, toolCalls: [], stopReason: "max_rounds" };
}
```

### `executeToolCall` (single point of contact with `tools.ts`)

```ts
async function executeToolCall(call: ToolCall): Promise<ToolResult> {
  try {
    const content = await executeTool(call.name, call.input);  // from tools.ts
    return { toolCallId: call.id, name: call.name, content };
  } catch (err) {
    return {
      toolCallId: call.id, name: call.name,
      content: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
      isError: true
    };
  }
}
```

### `appendToolResults` (per-provider shapes)

- **Anthropic:** appends `{ role: "user", content: [{ type: "tool_result", tool_use_id, content }] }`
- **OpenAI:** appends one `{ role: "tool", tool_call_id, content }` per result
- **Google:** appends a single user turn with one `{ functionResponse: { name, response } }` part per result

## Error handling & dispatch

### The dispatcher (top of `runStaticReview`)

```ts
export async function runStaticReview(session, artifacts, onProgress) {
  // ... existing session status updates ...
  await indexProject(session.projectId, artifacts);
  const staticFindings = await runStaticAnalysis(...);

  // Size check
  const totalBytes = artifacts.reduce((s, a) => s + (a.size ?? 0), 0);
  const SMALL_PROJECT_BYTES = Number(process.env.STATIC_REVIEW_SMALL_PROJECT_BYTES) || 200_000;  // ~200KB
  const maxArtifactBytes = Math.max(0, ...artifacts.map(a => a.size ?? 0));

  // Force tool path if total size is large OR if any single file is huge
  // (the index/graph won't help if the only relevant file is itself over the cap)
  const useToolPath = totalBytes >= SMALL_PROJECT_BYTES || maxArtifactBytes > 100_000;

  if (useToolPath) {
    return runStaticReviewWithTools(session, artifacts, onProgress, staticFindings);
  }
  return runStaticReviewPrefetch(session, artifacts, onProgress, staticFindings);  // today's body, renamed
}
```

### Failure modes and responses

| Failure | Detection | Response |
|---|---|---|
| Provider returns 400 / 401 / network error | Caught in `singleToolCall`, re-thrown | Bubbles up to the existing `try/catch` at the bottom of `runStaticReview`; session status is set to `failure` and the error is surfaced. The user can recover by setting `STATIC_REVIEW_SMALL_PROJECT_BYTES=0` (forces pre-fetch path) and re-running |
| Provider returns 200 but `stop_reason` is something unexpected (`refusal`, `max_tokens`) | `parseXxxToolTurn` sees unknown reason | Return `stopReason: "end_turn"` with whatever `content` we got; let the stage's existing JSON parser handle a possibly-truncated answer |
| `callAiWithTools` exhausts `maxRounds` without `end_turn` | Loop counter hits limit | Return `stopReason: "max_rounds"`; caller uses `lastTurn.content` and emits a "Model used all tool rounds without converging" warning thought |
| Tool execution throws (file missing, parse error, etc.) | Caught in `executeToolCall` | Append `{ content: "ERROR: ...", isError: true }` as the tool result; the model sees the error and can retry or move on. We do **not** abort the stage. |
| Tool returns a result larger than 50,000 chars | Truncated in `tools.ts` before return | Append truncated result with `[... truncated, call fetch_file with line range ...]` marker |
| `search_symbols` returns 0 hits | Normal empty result | Return `{"matches": []}`; model handles gracefully |
| Index or graph file is missing / unreadable | `fs.access` fails in tool path startup | Fall back to pre-fetch path with an error thought emitted to progress |
| `google-native` tool call missing an ID | Detected in `parseGoogleToolTurn` | Synthesize `google-${ts}-${i}` — we keep IDs stable within a single turn so the result can be matched back |
| Model hallucinates a tool name we don't expose | `executeTool` returns "Unknown tool" error | Model sees error, can self-correct on next round |

**Graceful degradation — the key invariant:** every failure above preserves the
same `Finding[]` output shape. The session never gets stuck in a half-state; the
report export never sees a new schema.

### Progress thoughts emitted by the new path

Each tool call emits a thought so the user sees what the AI is investigating:

```
Stage 2: Code Review
  ↳ Inspecting 3 source file(s) for code-quality issues...
  ↳ 🔧 fetch_file: src/auth/login.ts
  ↳ 🔧 search_symbols: "validatePassword"
  ↳ 🔧 get_symbol_body: src/auth/login.ts → validatePassword
  ↳ Found 4 code issue(s)
```

The `emitThinking` helper in `staticReview.ts` already takes a string per turn;
we just need to call it once per tool call.

## Testing

### Unit tests

**`tools.test.ts` (NEW):**

- `fetch_file` returns content for a known artifact; throws on missing path
- `fetch_files` batches correctly; one missing file in batch returns error
  string for that entry, others succeed
- `search_symbols` matches by case-insensitive substring; returns empty on
  no hits
- `get_symbol_body` returns the exact lines from the AST (use a fixture TS
  file with a known function)
- All four tools cap output at 50,000 chars with a truncation marker

**`aiClient.test.ts` (EXTEND):**

- `parseAnthropicToolTurn` / `parseOpenAIToolTurn` / `parseGoogleToolTurn` —
  table-driven tests over fixture responses
- `callAiWithTools` happy path: model calls one tool, sees result, ends turn
  → returns `end_turn` after 2 rounds
- Loop terminates at `maxRounds=1` even if model keeps calling tools →
  `stopReason: "max_rounds"`
- Tool execution error is appended as `isError: true` result
- Provider error (HTTP 500) bubbles up as a thrown error from `singleToolCall`
- `appendToolResults` produces correct shapes for all three providers
  (snapshot tests)

**`staticReview.test.ts` (EXTEND):**

- `runStaticReview` with `STATIC_REVIEW_SMALL_PROJECT_BYTES=999999999` (large
  threshold) takes the new tool path
- `runStaticReview` with threshold 0 takes the legacy pre-fetch path
- Tool path failure (mocked provider 500) surfaces as a session-level
  failure (status `failure`); the user can recover by setting
  `STATIC_REVIEW_SMALL_PROJECT_BYTES=0` and re-running
- `STATIC_REVIEW_MAX_ROUNDS=0` produces a degraded but parseable result (not
  a crash) — `callAiWithTools` returns `{ content: null, toolCalls: [],
  stopReason: "max_rounds" }` and the stage's JSON parser sees an empty
  response, which it already handles gracefully

### Integration test (NEW)

`sidecar/__tests__/integration/staticReviewToolPath.test.ts`:

A small fixture project (~6 files) is created in a temp dir, registered as a
project, and run through `runStaticReview` with the tool path forced on. The
test:

1. Asserts `index.json` and `graph.json` are written
2. Asserts the AI's tool calls are observable in the progress stream (mocked)
3. Asserts the output `findings[]` schema matches the legacy path's output
4. Asserts the session ends in `success` status, not `failure`

This test uses a mocked `fetch` so no real API key is needed in CI.

### Manual verification checklist

Run before merge, document in PR description:

- [ ] Re-run the original failing case from `b0b5721` (a project large enough
  to hit the 100K cap) — should now succeed via the tool path
- [ ] Run a small project (3–4 files, <200KB total) — should still use the
  pre-fetch path, identical output to before
- [ ] Run with `STATIC_REVIEW_MAX_ROUNDS=1` — stage still produces a result,
  with a "max_rounds" thought
- [ ] Run with `ANTHROPIC_API_KEY` unset / invalid — tool path falls back,
  session still completes
- [ ] Run with `google-native` provider — confirm Google tool-call flow works
  end-to-end (synthesized IDs, `functionResponse` parts)
- [ ] Run with `mimo` provider — confirm Anthropic-compat tool flow works
- [ ] Inspect the progress stream UI — every tool call should appear as a
  `🔧 tool_name` thought

## Migration & rollout

This change is **backward-compatible by default**:

- The pre-fetch path is unchanged; small projects behave identically
- The tool path is gated on file size, not a feature flag — no env-var opt-in
  needed
- The same `Finding[]` output is produced, so `staticSessions.ts`,
  `reportExport.ts`, and the React UI need zero changes
- The new `STATIC_REVIEW_MAX_ROUNDS` env var defaults to 3, matching the
  brainstorming choice; no `.env` change required to roll out
- `STATIC_REVIEW_SMALL_PROJECT_BYTES` defaults to 200,000 — can be tuned
  later via env without code changes

**Rollback plan:** if the tool path causes regressions, set
`STATIC_REVIEW_SMALL_PROJECT_BYTES=0` in `.env` to force all projects to the
legacy path. The new code stays in the binary but is never executed.

## Open questions

None at design time. Decisions made:

- **Tool set:** all four (fetch_file, fetch_files, get_symbol_body,
  search_symbols)
- **Round budget:** default 3, env-overridable via
  `STATIC_REVIEW_MAX_ROUNDS`
- **Dispatch threshold:** default 200,000 bytes total OR any single file
  over 100,000 bytes, env-overridable via `STATIC_REVIEW_SMALL_PROJECT_BYTES`
- **Tool cap:** 50,000 chars per result
- **Scope:** static review pipeline only; dynamic module out of scope
