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
│     "fetch_file"        → fs.readFileSync(resolvePath(path))         │
│     "fetch_files"       → map paths, return per-entry result map     │
│     "get_symbol_body"   → repoIndex.getSymbolBody(path, name)        │
│     "search_symbols"    → repoIndex.searchSymbols(projectId, q)      │
│                                                                      │
│   All tools operate on FILE PATHS (the AI navigates by path from      │
│   index.json). tools.ts resolves paths against the workspace root    │
│   and normalizes for cross-platform differences.                     │
│   All tools are pure sidecar functions (no HTTP round trip)          │
└──────────────────────────────────────────────────────────────────────┘
```

### Key decisions

- **Hybrid with dispatch** (not full replacement): small projects keep the
  pre-fetch path so we don't add round-trip latency for cases that work fine.
- **Tools are sidecar-local** (not exposed over HTTP): avoids serializing
  every file twice and gives us a clean unit-test surface.
- **Tools operate on file paths, not artifact IDs.** The `index.json` that
  the AI navigates by lists file paths; the model emits paths back via
  tool calls; tools resolve and read the path directly. This keeps the
  index → tool flow consistent and lets the tool executor be path-agnostic
  (it doesn't need the artifact table at all).
- **Same `Finding[]` output**: the new path returns the same shape as the old
  one, so the database writes, progress streaming, and report export need no
  changes.

## Components & data flow

### File changes

| File | Change | Purpose |
|---|---|---|
| `sidecar/src/tools.ts` | **NEW** | Tool schemas (per provider format) + `executeTool(name, args)` dispatch. Uses the same `getDb()` singleton pattern as the rest of the sidecar. |
| `sidecar/src/aiClient.ts` | **modified** | Add `callAiWithTools(messages, tools, opts)` — multi-round, returns `{ content, toolCalls, stopReason }`. Reads `STATIC_REVIEW_MAX_ROUNDS` from `process.env` (default 3) |
| `sidecar/src/repoIndex.ts` | **modified** | Add `searchSymbols(projectId, query)` and `getSymbolBody(projectId, filePath, symbolName)` — see "New repoIndex functions" below |
| `sidecar/src/staticReview.ts` | **modified** | Extract the current `runStaticReview` body into a new function `runStaticReviewPrefetch`; replace the top of `runStaticReview` with a size-based dispatcher that routes to either `runStaticReviewPrefetch` or the new `runStaticReviewWithTools` |
| `sidecar/__tests__/unit/tools.test.ts` | **NEW** | Tool executor unit tests |
| `sidecar/__tests__/unit/aiClient.test.ts` | **modified** | Add tool-loop tests with mocked fetch |
| `sidecar/__tests__/integration/staticReviewToolPath.test.ts` | **NEW** | End-to-end tool path with mocked provider |

> **Note on env-var loading:** `sidecar/src/settings.ts` reads from the SQLite
> `ai_provider_settings` table, not from process env. The new env vars
> (`STATIC_REVIEW_MAX_ROUNDS`, `STATIC_REVIEW_SMALL_PROJECT_BYTES`) are read
> directly from `process.env` at the top of `callAiWithTools` and the
> dispatcher respectively. No changes to `settings.ts` are needed.

### New `repoIndex` functions

```ts
// Returns up to `limit` symbols matching `query` (case-insensitive substring
// of name) for the given project, joined with their parent file path. Used
// by the `search_symbols` tool.
export async function searchSymbols(
  projectId: string,
  query: string,
  limit: number = 50
): Promise<{
  matches: Array<{
    symbolId: string;
    name: string;
    symbolType: string;
    filePath: string;
    signature: string;
    startLine: number;
    endLine: number;
  }>;
  totalMatches: number;
}>;

// Returns the source lines for one symbol, by file path + symbol name.
// Reads the file, slices by startLine..endLine, returns the slice as a
// string. Used by the `get_symbol_body` tool.
export async function getSymbolBody(
  projectId: string,
  filePath: string,
  symbolName: string
): Promise<{
  name: string;
  symbolType: string;
  filePath: string;
  startLine: number;
  endLine: number;
  body: string;           // exact lines from the file
  fileTotalLines: number;  // for context
}>;
```

**Implementation notes:**

- `searchSymbols` runs a single SQL query joining `code_symbols` with
  `repo_index` on `file_id`:
  ```sql
  SELECT cs.id, cs.symbol_type, cs.name, cs.signature,
         cs.start_line, cs.end_line, r.file_path
  FROM code_symbols cs
  JOIN repo_index r ON r.id = cs.file_id
  WHERE cs.project_id = ? AND cs.name LIKE ?
  ORDER BY cs.name
  LIMIT ?;
  ```
  The `LIKE` pattern is `%${query}%` (case-insensitive by default in SQLite
  for ASCII). The result is structurally different from
  `contextRetrieval.searchByKeyword` (which returns whole `RepoIndex[]`);
  `searchSymbols` returns symbol-level matches with line ranges. The two
  functions coexist — `searchByKeyword` remains available for callers that
  want file-level results, but the tool path uses `searchSymbols` to get
  symbol-level results the model can act on.

- `getSymbolBody` works the same way for any indexed symbol regardless of
  language. The `startLine`/`endLine` in `code_symbols` is set by the AST
  extractor for JS/TS, and by the per-language extractor (heading lines,
  selector lines, key lines) for markdown / JSON / CSS / YAML / HTML — all
  of which produce meaningful line ranges. The function:
  1. Looks up the symbol via `SELECT start_line, end_line FROM code_symbols
     JOIN repo_index ON file_id WHERE project_id = ? AND r.file_path = ?
     AND name = ?`.
  2. `fs.readFileSync(filePath, 'utf-8')` to get the full content.
  3. `content.split('\n').slice(startLine - 1, endLine).join('\n')` to get
     the symbol's body.
  4. Returns the body plus the total line count so the tool result includes
     a hint for `get_dependencies` / `search_symbols` follow-ups.

  Edge cases: if the file is missing on disk, the tool throws `ENOENT`. If
  the symbol isn't found, the tool throws `SymbolNotFound`. Both are caught
  by `executeToolCall` and returned as `isError: true` tool results so the
  model can self-correct.

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

### Tool result size cap & message-list bloat guard

Each tool result is capped at **25,000 chars** (lowered from 50K — see
calculation below) before being appended to `messages`. If `fetch_file`
returns more, it's truncated with a marker:

```
[... truncated at 25,000 chars; use get_symbol_body for a specific symbol, or split into smaller files ...]
```

In addition, `callAiWithTools` enforces a **total message-list cap of
200,000 chars** between rounds. Before each call, it serializes `messages`
and measures total length. If over the cap, it drops the **oldest tool
result** from the conversation history (i.e. the first tool result from the
earliest round) and replaces it with:

```
[earliest tool result dropped to stay within the 200,000-char message limit; re-fetch if needed]
```

This guarantees the loop never recreates the original 100K-prompt problem
even if the model calls `fetch_file` repeatedly on large files.

**Cap math:** worst case is `MAX_ROUNDS=3` × 25,000 chars/result = 75,000
chars of tool results, plus system prompt (~3,000 chars for index.json +
graph.json) and stage instructions (~2,000 chars) = ~80,000 chars total
content. The 200,000-char cap leaves ~2.5x headroom for any single oversized
result that slips past the per-result cap (e.g. a non-truncatable JSON
response), and matches the spirit of `MAX_PROMPT_CHARS = 100_000` in the
legacy path with room for the model's reply.

**Caps are configurable via env:**

```
STATIC_REVIEW_MAX_TOOL_RESULT_CHARS=25000   # default
STATIC_REVIEW_MAX_MESSAGE_CHARS=200000      # default
```

Both default to the values above. Lowering `STATIC_REVIEW_MAX_TOOL_RESULT_CHARS`
makes truncation happen sooner (and more often); raising it increases risk of
hitting the message-list cap and triggering the drop-oldest-result policy.

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

### Per-tool error model

`executeTool` has a **per-tool** error policy, spelled out explicitly so
the catch in `executeToolCall` is not the only line of defense:

| Tool | On success | On partial failure | On total failure |
|---|---|---|---|
| `fetch_file` | Returns file content | n/a (single file) | Throws `ENOENT` / `EACCES` / etc. |
| `fetch_files` | Returns a per-path result map | Returns map with both `<content>` and `{ "error": "..." }` entries for missing paths. The batch always succeeds as long as at least one path is valid; if **all** paths are missing, throws | Throws only if every path failed |
| `get_symbol_body` | Returns symbol body object | n/a (single symbol) | Throws `SymbolNotFound` / `ENOENT` |
| `search_symbols` | Returns `{ matches: [...], totalMatches }` | n/a (returns empty array on no matches) | Throws only on DB / SQL error |

**Rationale:** `fetch_files` is the one tool where the model naturally
expects "give me everything you can" — failing the whole batch because one
of five paths is mistyped would force a useless retry. For the other
three, partial success is not meaningful (one file / one symbol / one
query), so throwing is the right signal.

The `executeToolCall` wrapper catches all throws and converts them to
`isError: true` results, so the model always sees a structured result
back. A `fetch_files` partial-failure result is just a normal successful
return; only a `fetch_files` all-failed batch becomes an `isError: true`
result.

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

  // Size check. NOTE: the Artifact type (sidecar/src/artifacts.ts:9-19) does NOT
  // carry a `size` field — file size must be read from disk via fs.statSync.
  // The pattern matches the existing code in repoIndex.ts:766.
  const sizes = artifacts.map(a => {
    try { return fs.statSync(a.filePath).size; } catch { return 0; }
  });
  const totalBytes = sizes.reduce((s, n) => s + n, 0);
  const maxArtifactBytes = sizes.length > 0 ? Math.max(...sizes) : 0;
  const SMALL_PROJECT_BYTES = Number(process.env.STATIC_REVIEW_SMALL_PROJECT_BYTES) || 200_000;  // ~200KB

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
| Tool returns a result larger than 25,000 chars | Truncated in `tools.ts` before return | Append truncated result with `[... truncated, use get_symbol_body for a specific symbol ...]` marker |
| Model passes a path with a different separator (`./src/foo.ts` vs `src/foo.ts` vs `src\foo.ts` on Windows) | Path normalized in `tools.ts` via `path.resolve(workspacePath, normalizePath(input))` and a case-insensitive comparison on Windows | The model can hand the tool any path that appears in `index.json`; the tool handles the resolution |
| `search_symbols` returns 0 hits | Normal empty result | Return `{"matches": []}`; model handles gracefully |
| Index or graph file is missing / unreadable | `fs.access` fails in tool path startup | Fall back to pre-fetch path with an error thought emitted to progress |
| `google-native` tool call missing an ID | Detected in `parseGoogleToolTurn` | Synthesize `google-${ts}-${i}` — we keep IDs stable within a single turn so the result can be matched back |
| Model hallucinates a tool name we don't expose | `executeTool` returns "Unknown tool" error | Model sees error, can self-correct on next round |
| `STATIC_REVIEW_MAX_ROUNDS=0` (or any other value that results in zero loop iterations) | `callAiWithTools` returns `{ content: null, toolCalls: [], stopReason: "max_rounds" }` | **The caller MUST emit a warning thought** (e.g. `"Stage N ran with 0 tool rounds; no findings will be produced"`) via `emitThinking` BEFORE calling `parseStageResponse`, so the user sees something happened and the stage's empty result is not silently indistinguishable from a real "no issues found" |
| `callAiWithTools` exhausts rounds with empty `content` (model kept calling tools and never produced a text reply) | `lastTurn.content` is `null` or empty | **The caller MUST emit a warning thought** (`"Model used all N tool rounds without producing a final answer"`) before parsing. The stage parses whatever `content` we have (possibly `""`), which yields an empty findings list |

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

- [ ] **Precondition (must pass first):** for each provider that will be used
  in production (e.g. MiMo-v2.5-pro, Gemini-2.5-flash), run a one-shot
  probe: send a single `fetch_file` tool definition with a system prompt
  asking the model to call it. **The model MUST return a tool-call block
  (`tool_use` / `tool_calls` / `functionCall`).** If the model silently
  ignores the `tools` field and returns plain text, the tool path will
  appear to work (the model will "review" without ever reading any files)
  but produce empty stages. The probe lives in
  `sidecar/src/toolsProbe.ts` (a small CLI that prints the model's response
  shape so you can eyeball it) and is run via
  `pnpm --filter @centinel/sidecar tools:probe`.
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
- [ ] Send a `fetch_file("./path/that/does/not/exist")` — confirm the tool
  returns an `isError: true` result and the model recovers (calls a
  different path) instead of producing an empty review
- [ ] Send a `fetch_file` for a 100KB file — confirm the per-result cap
  truncates with the marker and the model can still complete the stage
- [ ] Send three rounds of `fetch_file` for large files — confirm the
  message-list cap kicks in on round 3 and drops the oldest result

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
- **Per-tool-result cap:** default 25,000 chars, env-overridable via
  `STATIC_REVIEW_MAX_TOOL_RESULT_CHARS`
- **Total message-list cap:** default 200,000 chars (oldest tool result
  dropped on overflow), env-overridable via `STATIC_REVIEW_MAX_MESSAGE_CHARS`
- **Tool input/output convention:** tools operate on file paths from
  `index.json`, not artifact IDs. `fs.readFileSync` directly; no
  `readArtifactContent(artifactId)` indirection
- **`fetch_files` error model:** per-entry partial results, throws only
  on all-failed; the other three tools throw on failure
- **Env-var loading:** all four env vars read from `process.env` directly
  (NOT through `settings.ts`, which reads from SQLite). Settings.ts is
  unchanged
- **Provider tool-use precondition:** must be verified by a probe run
  (`pnpm --filter @centinel/sidecar tools:probe`) before the tool path
  is enabled for any new provider/model combination
- **Scope:** static review pipeline only; dynamic module out of scope
