# Static Review Progress Toast + Inline Expansion — Design Spec

**Date:** 2026-06-22
**Status:** Awaiting user review
**Author:** Brainstorming session with user

## Goal

Replace the existing static-review detail-page pattern with a global top-center toast that surfaces progress across the app. Project workspace pages show the same progress inline under the relevant session row. Eliminates three full detail screens. Also fixes three related bugs that block the static review flow end-to-end.

## Problem Statement

Today, starting a static review opens a separate detail page (`StaticSessionScreen`, `ReviewScreen`, or `ReviewSessionScreen` — three nearly-overlapping files totaling ~2,200 lines). Progress is invisible until the user navigates into the detail page. Worse, three bugs prevent the review from completing at all on any non-trivial project:

1. **Gap 1** — `callAiWithTools` sends a literal `'__placeholder__'` string as the API key. The provider returns 401.
2. **Gap 2** — The user-selected `reviewType` is dropped at the API boundary and the DB row is hardcoded to `'comprehensive'`. The user picks "Requirement Review" but the pipeline runs as comprehensive.
3. **Gap 3** — `StaticReviewForm` sends empty `artifactIds`. Two review types (`requirement_to_code_traceability`, `cross_artifact_consistency`) are meaningless without the ability to pick artifacts.

## Design Decisions (locked in brainstorming)

| Question | Decision |
|---|---|
| Existing detail pages | Delete all three (`StaticSessionScreen`, `ReviewScreen`, `ReviewSessionScreen`) |
| Where completed-review results show | Toast changes to "Review complete" state with finding count; click expands inline panel under the session row |
| Multiple concurrent sessions | One toast, latest active. Backend already prevents concurrent reviews on same project |
| Progress feed | Polling every 1s, no SSE/WebSocket |
| Click-to-expand on toast | Expands in place (no navigation) |
| Toast lifecycle | Sticky and persistent; 5-minute auto-dismiss after completion; manual X button |
| Architecture | Single polling hook in `App.tsx` + React context (Approach A) |

## Architecture

Three layers, top-down:

```
App.tsx
  └─ <ActiveReviewProvider>          ← single source of truth
       │  (owns the 1s polling)
       ├─ <ReviewToast>                ← fixed top-center, reads context
       └─ <Outlet>                     ← current screen
            └─ ProjectDetailScreen
                 └─ session row
                      └─ <ActiveSessionInline>  ← reads same context
```

### Layer 1 — Polling (`useActiveReview` hook)

Lives at the top of `App.tsx`, inside `<ActiveReviewProvider>`.

**Initial fetch:** On mount, call `GET /static-sessions/active`. If the response includes at least one `queued`/`running` session, store the most-recently-created one in context state and start a 1-second `setInterval`. If empty, set state to `null` and do not start the interval.

**Each tick (while interval is active):**
1. Refetch `GET /static-sessions/active`.
2. If a session is returned: update context state with the latest snapshot of that session.
3. If no session is returned (list empty) but the previous tick had one: the session has just transitioned to `success`/`failure`/`cancelled`. Fetch the single-session endpoint `GET /projects/:pid/static-sessions/:sid` one last time to capture `status`, `finalSummary`, `findings`. Set `completedAt = now`. Keep the interval running for the 5-minute auto-dismiss window.
4. After 5 minutes of "no active sessions" in a row: clear context state to `null`, `clearInterval`.

**Error handling:**
- Fetch failure: log to console, keep previous state, retry next tick.
- 3 consecutive failures: pause polling, mark context state with `connectionLost: true`. The toast renders a "Connection lost — Retry" button that resumes polling.
- 4xx (other than 404): stop polling, log error, clear state.

### Layer 2 — State (`ActiveReviewContext`)

Plain React context, no external library. Single value: `ActiveReviewState | null`.

```ts
type ActiveReviewState = {
  session: {
    id: string;
    projectId: string;
    projectName: string;
    name: string;
    reviewType: ReviewType;
    status: StaticSessionStatus;
    progressJson: string;       // parsed → ReviewProgress on read
    findings: Finding[];        // populated on success
    finalSummary: string;
    failureReason: string;
    createdAt: string;
  };
  expanded: boolean;             // user toggle for toast panel
  completedAt: string | null;    // when status transitioned out of running
  dismissedAt: string | null;    // user clicked X; toast hides until next session
  connectionLost: boolean;
};
```

`dismissedAt` is cleared automatically when a new session starts (different `session.id`).

### Layer 3 — UI

`<ReviewToast>` (fixed top-center, ~440px wide) and `<ActiveSessionInline>` (under session row) are pure consumers of the context. Both render nothing when state is `null` or when `dismissedAt` is set.

## Component Inventory

### New files

| File | Purpose |
|---|---|
| `centinel/src/hooks/useActiveReview.ts` | Polling hook, owns the 1s interval, manages connection-lost state |
| `centinel/src/context/ActiveReviewContext.tsx` | `ActiveReviewProvider`, `useActiveReviewState()` hook |
| `centinel/src/components/ReviewToast.tsx` | Top-center container, lifecycle, dismiss button |
| `centinel/src/components/ReviewToastCollapsed.tsx` | Compact progress bar view |
| `centinel/src/components/ReviewToastExpanded.tsx` | Full stage history with thoughts + cancel button |
| `centinel/src/components/ReviewToastComplete.tsx` | "Review complete — N findings" state with severity counts |
| `centinel/src/components/ActiveSessionInline.tsx` | Inline progress under session row, shows live stage + cancel |
| `centinel/src/components/ActiveSessionComplete.tsx` | Inline completed state: findings summary + collapsible finding list |

### Modified files

| File | Change |
|---|---|
| `centinel/src/App.tsx` | Wrap routes in `<ActiveReviewProvider>`, mount `<ReviewToast>` outside `<Outlet>`, remove `'static-session'` / `'review'` / `'review-session'` route branches |
| `centinel/src/screens/ProjectDetailScreen.tsx` | Replace session-row navigation with inline `<ActiveSessionInline>` / `<ActiveSessionComplete>` based on session status |
| `centinel/src/components/ReviewModal.tsx` | Accept and pass `artifacts` prop down to form |
| `centinel/src/components/StaticReviewForm.tsx` | Add artifact selector (Gap 3) |
| `centinel/src/types.ts` | Remove `'static-session'`, `'review'`, `'review-session'` from `Screen` union |
| `sidecar/src/aiClient.ts` | Gap 1: add `apiKey` to `CallAiWithToolsOpts`, remove placeholder |
| `sidecar/src/index.ts` | Add `GET /static-sessions/active` route; Gap 2: pass `reviewType` + `artifactIds` through |
| `sidecar/src/staticSessions.ts` | Add `listActiveStaticSessions()`; Gap 2: accept and validate `reviewType`, filter by `artifactIds` |

### Deleted files

| File | Lines | Reason |
|---|---|---|
| `centinel/src/screens/StaticSessionScreen.tsx` | 918 | Replaced by toast + inline |
| `centinel/src/screens/ReviewScreen.tsx` | 395 | Replaced by toast + inline |
| `centinel/src/screens/ReviewSessionScreen.tsx` | 921 | Replaced by toast + inline |
| `centinel/src/components/ReviewProgressView.tsx` | ~66 | Logic moves into `ReviewToastExpanded`; only consumer (`StaticSessionScreen`) is being deleted |

## Data Flow Detail

### Server-side: `listActiveStaticSessions`

```ts
// sidecar/src/staticSessions.ts
export async function listActiveStaticSessions(): Promise<StaticSession[]> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT ... FROM static_sessions
     WHERE status IN ('queued', 'running')
     ORDER BY created_at DESC`
  );
  // ...
}
```

Returns all active sessions across all projects. Polling hook picks the most-recently-created one for display.

### Server-side: artifact filtering

When `createStaticSession` receives `artifactIds: string[]` (non-empty), filter `listArtifacts(projectId)` by that set before passing into `runStaticReview`. Empty array = use all artifacts (current behavior preserved).

### Client-side: initial poll + retry

`useActiveReview` runs:
```ts
useEffect(() => {
  let cancelled = false;
  let intervalId: number | null = null;
  let consecutiveFailures = 0;

  const tick = async () => {
    try {
      const active = await api.listActiveStaticSessions();
      if (cancelled) return;
      consecutiveFailures = 0;
      // ... update context state ...
    } catch (err) {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) setConnectionLost(true);
    }
  };

  void tick();
  intervalId = window.setInterval(tick, 1000);

  return () => {
    cancelled = true;
    if (intervalId !== null) clearInterval(intervalId);
  };
}, []);
```

The interval runs forever; per-tick logic decides whether to update state. Polling is cheap (1s × ~30s review = ~30 requests, single small payload). The 5-minute auto-dismiss clears state.

## Visual Spec

### Toast — running, collapsed (default)

```
┌──────────────────────────────────────────────┐
│ ◐  Sprint 3 Requirement Review     [X]      │
│ ●──●──●──○                                    │
│ Context Code Req Sum.                         │
│                                              │
│ Code Review · Inspecting 12 source files...   │
└──────────────────────────────────────────────┘
```

~440px wide, fixed `top: 16px; left: 50%; transform: translateX(-50%);`, z-index above main content.

### Toast — running, expanded (after click)

```
┌──────────────────────────────────────────────┐
│ ◐  Sprint 3 Requirement Review     [X]      │
│ ●──●──●──○                                    │
│                                              │
│ ▼ Understanding Context        (done)        │
│   › Reading 8 artifact(s)...                 │
│                                              │
│ ▼ Code Review                  (done)        │
│   › Inspecting 12 source file(s)...          │
│   ▾ 2 earlier thoughts                       │
│     › Checked SQL injection paths            │
│     › Verified input sanitation              │
│                                              │
│ ▼ Requirement Validation       (active) ⏳    │
│   › Tracing 5 requirement docs...            │
│                                              │
│ ▷ Summarizing                  (pending)     │
│                                              │
│                  [Cancel Review]             │
└──────────────────────────────────────────────┘
```

### Toast — completed

```
┌──────────────────────────────────────────────┐
│ ✓  Sprint 3 Requirement Review     [X]      │
│ ●──●──●──●                                    │
│                                              │
│ 12 findings · 3 critical · 4 high · 5 medium  │
│                                              │
│       [Click to view findings]               │
└──────────────────────────────────────────────┘
```

5-minute auto-dismiss from `completedAt`.

### Inline — project workspace, session row expanded

Under the relevant session row in `ProjectDetailScreen`:

```
┌──────────────────────────────────────────────────────┐
│ Sprint 3 Requirement Review           Running       │
│ Requirement Review                    2 min ago      │
│                                                      │
│ ●──●──●──○                                            │
│ Code Review · Inspecting 12 source files...          │
│                                        [Cancel]      │
└──────────────────────────────────────────────────────┘
```

For completed sessions, replaces the above with finding counts and a collapsible list:

```
┌──────────────────────────────────────────────────────┐
│ Sprint 3 Requirement Review           ✓ Success      │
│ 12 findings · 3 critical · 4 high · 5 medium          │
│                                                      │
│ ▼ Critical findings                                  │
│   ⚠ SQL injection in src/auth.ts:42  [Accept][Dismiss]│
│   ⚠ XSS in src/comments.tsx:18       [Accept][Dismiss]│
│   ⚠ Hardcoded secret in .env.example  [Accept][Dismiss]│
│ ▶ High (4)                                           │
│ ▶ Medium (5)                                         │
└──────────────────────────────────────────────────────┘
```

## Behavior Spec

### Toast lifecycle

| Event | Behavior |
|---|---|
| Session enters `queued` or `running` | Toast appears, polling starts |
| User clicks X | `dismissedAt = now`, toast hides; clears when a NEW session starts (different `id`) |
| Session transitions to `success` | Toast switches to complete mode, 5-min auto-dismiss timer starts |
| Session transitions to `failure` | Toast shows "Review failed — [reason]" in red, 30s auto-dismiss |
| Session transitions to `cancelled` | Toast shows "Review cancelled", 30s auto-dismiss |
| 5 min after completion (success path) | State cleared, polling stops if no other active sessions |
| 3 consecutive polling failures | Connection-lost indicator in toast with manual Retry |

### Inline behavior

- Session row in `ProjectDetailScreen` toggles its inline panel on click (was: navigate to detail page).
- The inline panel always reflects the context state, not local state. If the toast updates progress elsewhere, the inline panel updates simultaneously.
- If user is on a different project than the active session, the inline panel does not render (only the toast does).
- Cancel button visible in inline panel during running state, hidden after completion.

### Form (Gap 3 fix)

`StaticReviewForm` gains an artifact selector:
- Renders a checkbox list of project artifacts, grouped by `type` (Requirement / Source Code / Design / Other)
- Default: all selected
- User can deselect any
- Submits `artifactIds: string[]` of selected IDs

## API Surface Changes

### New endpoint

```
GET /static-sessions/active
→ 200 [{StaticSession}, ...]   // only queued/running, all projects, newest first
```

### Modified endpoint

```
POST /projects/:projectId/static-sessions
Body: {
  name: string;
  reviewType: ReviewType;        // NEW — was being dropped
  artifactIds: string[];         // NEW — was always []
  remarks: string;
}
→ 201 StaticSession
→ 400 if reviewType not in enum or artifactIds contains unknown IDs
```

### Unchanged

```
GET  /projects/:projectId/static-sessions
GET  /projects/:projectId/static-sessions/:sessionId
POST /projects/:projectId/static-sessions/:sessionId/cancel
GET  /projects/:projectId/static-sessions/:sessionId/findings
GET  /projects/:projectId/static-sessions/:sessionId/artifacts
```

## Gap Fix Details

### Gap 1 — `callAiWithTools` apiKey

**File:** `sidecar/src/aiClient.ts`

Current (broken):
```ts
export type CallAiWithToolsOpts = {
  apiFormat: ApiFormat;
  model: string;
  baseUrl: string;
  provider: 'mimo' | 'gemini' | 'custom';
  systemPrompt: string;
  messages: AppendableMessage[];
  tools: ToolSchema[];
  maxRounds?: number;
  signal?: AbortSignal;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
};

// inside callAiWithTools loop:
const headers = getAuthHeaders({ apiKey: '__placeholder__', ... } as SettingLike);
```

Fixed:
```ts
export type CallAiWithToolsOpts = {
  apiKey: string;                // NEW
  apiFormat: ApiFormat;
  // ... rest unchanged
};

const headers = getAuthHeaders({ apiKey: opts.apiKey, baseUrl, model, provider, apiFormat } as SettingLike);
```

**Caller:** `sidecar/src/staticReview.ts:413` adds `apiKey: setting.apiKey` to the `callAiWithTools` call.

**Tests:** All 4 existing `callAiWithTools` tests in `sidecar/__tests__/unit/aiClient.test.ts` (lines ~407, 431, 447) must pass a real `apiKey` and assert that `fetchSpy` was called with that key in the headers. Currently they don't — they pass empty args and the placeholder isn't caught.

### Gap 2 — reviewType + artifactIds wire-up

**File:** `sidecar/src/index.ts:460-477`

```ts
// Add to the parseJsonBody destructure:
const reviewType = body.reviewType;
const artifactIds = Array.isArray(body.artifactIds) ? body.artifactIds : [];

const VALID_REVIEW_TYPES = ['requirement_review', 'code_review', 'requirement_to_code_traceability', 'cross_artifact_consistency'];
if (typeof reviewType !== 'string' || !VALID_REVIEW_TYPES.includes(reviewType)) {
  return json(res, 400, { error: `reviewType must be one of: ${VALID_REVIEW_TYPES.join(', ')}` });
}

// Validate artifactIds against existing artifacts
const allArtifacts = await listArtifacts(ssMatch.projectId);
const validIds = new Set(allArtifacts.map(a => a.id));
const filteredArtifacts = artifactIds.length > 0
  ? allArtifacts.filter(a => validIds.has(a.id))
  : allArtifacts;

const session = await createStaticSession(ssMatch.projectId, name, {}, reviewType, remarks);
runStaticReview(session, filteredArtifacts, /* ... */);
```

**File:** `sidecar/src/staticSessions.ts`

```ts
export async function createStaticSession(
  projectId: string,
  name: string,
  configJson: Record<string, unknown>,
  reviewType: ReviewType,           // NEW, replaces hardcoded 'comprehensive'
  remarks: string = ''
): Promise<StaticSession> {
  // ...
  db.run(
    'INSERT INTO static_sessions (..., review_type, ...) VALUES (?, ..., ?, ...)',
    [/* ... */, reviewType, /* ... */]
  );
  // ...
}
```

### Gap 3 — Artifact selector

**File:** `centinel/src/components/StaticReviewForm.tsx`

Add `artifacts: Artifact[]` prop. Render checkbox group:

```tsx
<div className="form-field">
  <label>Artifacts to Review ({selectedIds.size}/{artifacts.length})</label>
  {(['requirement', 'source_code', 'design', 'coding_standard', 'other'] as const).map(type => {
    const group = artifacts.filter(a => a.type === type);
    if (group.length === 0) return null;
    return (
      <fieldset key={type}>
        <legend>{TYPE_LABELS[type]} ({group.length})</legend>
        {group.map(a => (
          <label key={a.id}>
            <input
              type="checkbox"
              checked={selectedIds.has(a.id)}
              onChange={() => toggle(a.id)}
            />
            {a.fileName}
          </label>
        ))}
      </fieldset>
    );
  })}
</div>
```

Default: all selected. Submit `artifactIds: Array.from(selectedIds)`.

**File:** `centinel/src/components/ReviewModal.tsx`

Add `artifacts: Artifact[]` prop, pass through to `StaticReviewForm`.

**File:** `centinel/src/screens/ProjectDetailScreen.tsx`

The `ArtifactsPanel` already loads artifacts; pass them via `ReviewModal` → `StaticReviewForm`.

## Error Handling

| Scenario | Behavior |
|---|---|
| Polling tick network error | Log, keep previous state, retry next tick |
| 3 consecutive poll failures | Set `connectionLost: true`, toast shows "Connection lost — Retry" button |
| User clicks "Retry" on connection-lost | Resume polling immediately |
| Cancel returns 400 (session no longer active) | Inline button disappears, toast transitions to complete/cancelled |
| Start new review returns 409 (already running) | Form shows error, no new toast |
| `reviewType` invalid | API returns 400, frontend shows error in form |
| `artifactIds` contains unknown ID | Silently filtered server-side; if ALL are invalid, API returns 400 |

## Testing

### Unit tests (sidecar)

- `listActiveStaticSessions` returns only `queued`+`running` sessions, ordered by `created_at DESC`
- `createStaticSession` rejects `reviewType` not in the enum
- `createStaticSession` rejects empty `artifactIds` if all IDs are unknown
- `createStaticSession` accepts valid `reviewType` and persists it
- `callAiWithTools` sends the passed `apiKey` in `x-api-key` header
- `callAiWithTools` sends `anthropic-version` header for Anthropic-compatible

### Component tests (frontend)

- `ReviewToast` renders nothing when context is `null`
- `ReviewToast` shows collapsed progress view when session is `running`
- `ReviewToast` shows expanded panel after click
- `ReviewToast` shows complete state after status → `success`
- `ReviewToast` hides when X is clicked, returns when new session starts
- `ActiveSessionInline` renders under session row matching `session.projectId`
- `ActiveSessionInline` does not render for sessions of other projects
- `StaticReviewForm` shows artifact selector when `artifacts` prop is non-empty
- `StaticReviewForm` submits selected `artifactIds`

### Integration tests

- End-to-end: create session via API → poll shows progress → complete → toast shows finding count
- Static review on a project where artifacts are filtered by `artifactIds` only reviews those

### Manual verification checklist

- [ ] Start a review on Project A → toast appears within 1s
- [ ] Navigate to Settings → toast persists
- [ ] Navigate back to Project A workspace → inline progress shows under session row
- [ ] Toast and inline panel show identical progress at the same instant
- [ ] Wait for completion → toast shows "Review complete — N findings"
- [ ] Click toast → expands in place, no navigation
- [ ] Click X → toast hides
- [ ] Start a new review → toast reappears even if previously dismissed
- [ ] Cancel a running review from inline panel → session goes to `cancelled`, toast shows cancelled state
- [ ] Static review on a >100KB project no longer hits the 401 error (Gap 1 fix verified)

## Out of Scope

- Dynamic testing session toasts (future enhancement; same pattern would apply)
- Toast for non-static-review errors (e.g., settings save failure)
- Multiple toasts stacked
- Persistent toast history (only the latest active session is shown)
- WebSocket / SSE for progress (polling only)

## Open Risks

| Risk | Mitigation |
|---|---|
| Deleting 2,200+ lines of UI may lose features users relied on | Document the deletion in commit message; UI covers the same data via toast + inline |
| 1s polling may overwhelm sidecar under heavy use | Per-session polling is independent of sidecar load; payload is small (<2KB). Add a metric/log if it becomes an issue |
| Inline panel + toast both polling the same data could double-fetch | Single context, single polling hook, both surfaces read the same value |
| Race between toast complete and inline complete | Both update from the same context snapshot; no per-consumer state |

## Implementation Order

1. Gap 1 (apiKey) — small, isolated, unblocks the whole flow
2. Gap 2 (reviewType wire-up) — small, isolated
3. Gap 3 (artifact selector) — small frontend change
4. Sidecar `listActiveStaticSessions` endpoint
5. Frontend `useActiveReview` hook + `ActiveReviewContext`
6. Frontend `<ReviewToast>` + collapsed/expanded/complete variants
7. Frontend `<ActiveSessionInline>` + complete variant
8. Wire `ProjectDetailScreen` to new inline components
9. Delete `StaticSessionScreen.tsx`, `ReviewScreen.tsx`, `ReviewSessionScreen.tsx`, `ReviewProgressView.tsx`
10. Clean up `App.tsx` routing, `types.ts` Screen union
11. Add tests for all of the above
12. Manual verification

Each step ends with a passing build + tests.