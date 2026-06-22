# Static Review Progress Toast + Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace static-review detail pages with a global top-center progress toast (plus inline expansion under the project workspace session row), and fix three pre-existing bugs that block the static review flow end-to-end.

**Architecture:** A single polling hook in `App.tsx` writes a snapshot of the latest active static-review session into a React context. Two consumers — `<ReviewToast>` (fixed top-center) and `<ActiveSessionInline>` (under the session row in `ProjectDetailScreen`) — read from the same context and stay in sync automatically. Three sidecar bug fixes (real API key, reviewType wire-up, artifact selector) restore end-to-end review completion.

**Tech Stack:** Tauri v2 (React + TypeScript + Vite frontend; Rust shell), Node.js sidecar (TypeScript + Vitest), sql.js (WASM), MiMo via Anthropic-compatible endpoint, lucide-react icons.

## Global Constraints

- Repo root: `C:\Cstan\Projects\centinel`. Monorepo with `centinel/` (frontend) and `sidecar/` (Node.js).
- Package manager: `pnpm`. Install with `pnpm install` at repo root.
- Test commands:
  - Sidecar: `pnpm --filter @centinel/sidecar test`
  - Frontend: `cd centinel && pnpm test`
- Build command (whole app): `cd centinel && pnpm build`
- Type-check the whole app: `cd centinel && pnpm tsc --noEmit` (run from `centinel/`)
- Sidecar type-check: `cd sidecar && pnpm tsc --noEmit`
- All commits in this plan end with the literal Co-Authored-By trailer:

  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

- Frontend design authority: `DESIGN.md` at repo root. Match existing class names (`form-card`, `form-field`, `form-hint`, `form-error`, `form-actions`, `btn-primary`, `btn-secondary`, `panel-header`, `session-row`, `session-info-compact`, `session-meta`, `card-empty`). Use `lucide-react` icons already imported elsewhere.
- Vitest config files: sidecar uses defaults (`vitest run`), frontend uses `vitest run`. No jsdom unless already configured — check before adding.
- Every `useEffect` cleanup must clear intervals/timeouts/listeners (no leaks).
- Never use `__placeholder__` or other sentinel strings in production code.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `centinel/src/context/ActiveReviewContext.tsx` | React context, `ActiveReviewProvider`, `useActiveReviewState()` |
| `centinel/src/hooks/useActiveReview.ts` | Polling hook — owns the 1s interval, manages connection-lost state; also exports `ActiveReviewProvider` |
| `centinel/src/components/ReviewToast.tsx` | Top-center container, expanded toggle, dismiss X |
| `centinel/src/components/ReviewToastCollapsed.tsx` | Compact "●──●──●──○  Code Review · …" view |
| `centinel/src/components/ReviewToastExpanded.tsx` | Full stage history with thoughts + cancel |
| `centinel/src/components/ReviewToastComplete.tsx` | "Review complete — N findings" with severity counts |
| `centinel/src/components/ActiveSessionInline.tsx` | Inline progress under session row, live stage + cancel |
| `centinel/src/components/ActiveSessionComplete.tsx` | Inline completed state: finding summary + collapsible list |

### Modified files
| File | Change |
|---|---|
| `sidecar/src/aiClient.ts` | Gap 1 — add `apiKey` to `CallAiWithToolsOpts`, replace `'__placeholder__'` |
| `sidecar/src/staticReview.ts` | Pass `apiKey` into `callAiWithTools` (single site, line ~413) |
| `sidecar/src/staticSessions.ts` | Gap 2 — change `createStaticSession` signature; add `listActiveStaticSessions()` |
| `sidecar/src/index.ts` | Gap 2 — extract `reviewType` + `artifactIds` from request body, validate, filter artifacts; add `GET /static-sessions/active` route |
| `centinel/src/types.ts` | Remove `'static-session'`, `'review'`, `'review-session'` from `Screen` union |
| `centinel/src/App.tsx` | Wrap routes in `<ActiveReviewProvider>`, mount `<ReviewToast>` outside `<Outlet>`, remove the three deleted screen branches |
| `centinel/src/screens/ProjectDetailScreen.tsx` | Pass `artifacts` into `ReviewModal`; render `<ActiveSessionInline>` / `<ActiveSessionComplete>` for matching session row |
| `centinel/src/components/ReviewModal.tsx` | Accept `artifacts` prop, pass through to `StaticReviewForm` |
| `centinel/src/components/StaticReviewForm.tsx` | Gap 3 — artifact selector UI |
| `centinel/src/api/client.ts` | Add `listActiveStaticSessions()`; update `createStaticSession` payload to include `reviewType` + `artifactIds` |

### Deleted files
| File | Why |
|---|---|
| `centinel/src/screens/StaticSessionScreen.tsx` | Replaced by toast + inline |
| `centinel/src/screens/ReviewScreen.tsx` | Replaced by toast + inline |
| `centinel/src/screens/ReviewSessionScreen.tsx` | Replaced by toast + inline |
| `centinel/src/components/ReviewProgressView.tsx` | Only consumer (`StaticSessionScreen`) is being deleted; logic moves into `ReviewToastExpanded` |

---

## Task 1: Gap 1 — Fix `callAiWithTools` API Key (sidecar)

**Files:**
- Modify: `sidecar/src/aiClient.ts:319-352`
- Modify: `sidecar/src/staticReview.ts:413-423`
- Modify: `sidecar/__tests__/unit/aiClient.test.ts` (3 calls to `callAiWithTools` at lines ~407, 431, 447)

**Interfaces:**
- Consumes: `setting.apiKey` (already available on `SettingWithCreds`)
- Produces: `CallAiWithToolsOpts.apiKey: string`

- [ ] **Step 1: Write a failing test for apiKey in headers**

Add to `sidecar/__tests__/unit/aiClient.test.ts`, immediately after the existing `'returns end_turn after one tool call …'` test:

```ts
it('passes apiKey to x-api-key header on Anthropic-compatible calls', async () => {
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] }),
  } as Response);

  await callAiWithTools({
    apiKey: 'sk-real-key-abc123',
    apiFormat: 'anthropic-compatible',
    model: 'm',
    baseUrl: 'https://example.test/v1/messages',
    provider: 'mimo',
    systemPrompt: 'sys',
    messages: [],
    tools: [],
    maxRounds: 1,
  });

  const headers = fetchSpy.mock.calls[0][1].headers as Record<string, string>;
  expect(headers['x-api-key']).toBe('sk-real-key-abc123');
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `pnpm --filter @centinel/sidecar test -- --run aiClient.test.ts -t "passes apiKey"`
Expected: FAIL with `expected 'sk-real-key-abc123' to be '__placeholder__'` (or undefined — current behavior).

- [ ] **Step 3: Add `apiKey` to `CallAiWithToolsOpts` and remove placeholder**

In `sidecar/src/aiClient.ts`, replace the `CallAiWithToolsOpts` type (lines 319-332) with:

```ts
export type CallAiWithToolsOpts = {
  apiKey: string;
  apiFormat: ApiFormat;
  model: string;
  baseUrl: string;
  provider: 'mimo' | 'gemini' | 'custom';
  systemPrompt: string;
  messages: AppendableMessage[];
  tools: ToolSchema[];
  maxRounds?: number;
  signal?: AbortSignal;
  /** Called once per model-emitted tool call (per round). Useful for surfacing
   *  what the model is investigating in the progress stream. */
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
};
```

In `sidecar/src/aiClient.ts`, replace line 352:

```ts
const headers = getAuthHeaders({ apiKey: opts.apiKey, baseUrl, model, provider, apiFormat } as SettingLike);
```

- [ ] **Step 4: Update existing tests to pass `apiKey`**

In `sidecar/__tests__/unit/aiClient.test.ts`, edit all three existing `callAiWithTools({...})` call sites (lines ~407, ~431, ~447) to add `apiKey: 'test-key'` as the first property. Example for line 407:

```ts
const turn = await callAiWithTools({
  apiKey: 'test-key',
  apiFormat: 'anthropic-compatible',
  model: 'm',
  baseUrl: 'https://example.test/v1/messages',
  provider: 'mimo',
  systemPrompt: 'sys',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'review a.ts' }] }],
  tools: [{ name: 'fetch_file', description: 'd', input_schema: { type: 'object', properties: {} } }],
});
```

Apply the same one-line addition to the two other call sites (preserving their existing `maxRounds` overrides).

- [ ] **Step 5: Update `staticReview.ts` caller to pass `apiKey`**

In `sidecar/src/staticReview.ts` (line ~413), replace the `callAiWithTools({...})` call:

```ts
const turn = await callAiWithTools({
  apiKey: setting.apiKey,
  apiFormat: setting.apiFormat,
  model: setting.model,
  baseUrl: setting.baseUrl,
  provider: setting.provider,
  systemPrompt,
  messages,
  tools: [...TOOL_SCHEMAS],
  onToolCall: (name, args) =>
    emitThinking(`🔧 ${name}: ${JSON.stringify(args).substring(0, 200)}`),
});
```

- [ ] **Step 6: Run all aiClient tests and verify they pass**

Run: `pnpm --filter @centinel/sidecar test -- --run aiClient.test.ts`
Expected: All 5 tests pass (3 existing + 1 new + 1 stub).

- [ ] **Step 7: Run the whole sidecar test suite to confirm no regression**

Run: `pnpm --filter @centinel/sidecar test`
Expected: same pass/fail counts as before this task (24 fail in `staticSessions.test.ts` — those are fixed by Task 2).

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/aiClient.ts sidecar/src/staticReview.ts sidecar/__tests__/unit/aiClient.test.ts
git commit -m "fix(sidecar): pass real apiKey to callAiWithTools (Gap 1)

Previously callAiWithTools sent '__placeholder__' as the x-api-key
header value, causing every tool-use turn to return HTTP 401.
Thread setting.apiKey through from runStageWithTools.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Gap 2 — Wire `reviewType` and `artifactIds` end-to-end (sidecar)

**Files:**
- Modify: `sidecar/src/staticSessions.ts:105-126` (signature change + remove hardcoded `'comprehensive'`)
- Modify: `sidecar/src/staticSessions.ts` (append: `listActiveStaticSessions` function)
- Modify: `sidecar/src/index.ts:1-50` (import list — add `listArtifacts`)
- Modify: `sidecar/src/index.ts:115-145` (add `matchStaticActive` URL matcher)
- Modify: `sidecar/src/index.ts:455-487` (POST handler — validate + filter)
- Modify: `sidecar/src/index.ts` (append: `GET /static-sessions/active` route)

**Interfaces:**
- Consumes: request body `{ name, reviewType, artifactIds, remarks }`
- Produces: `createStaticSession(projectId, name, configJson, reviewType, remarks?)` and `listActiveStaticSessions(): StaticSession[]`

- [ ] **Step 1: Change `createStaticSession` signature in `staticSessions.ts`**

In `sidecar/src/staticSessions.ts`, replace the `createStaticSession` function (lines 105-126) with:

```ts
export type ReviewType =
  | 'requirement_review'
  | 'code_review'
  | 'requirement_to_code_traceability'
  | 'cross_artifact_consistency';

export async function createStaticSession(
  projectId: string,
  name: string,
  reviewType: ReviewType,
  configJson: Record<string, unknown> = {},
  remarks: string = ''
): Promise<StaticSession> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.run(
    'INSERT INTO static_sessions (id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, name, reviewType, 'queued', JSON.stringify(configJson), '{}', remarks, '', '', now, now]
  );
  saveDb();

  return {
    id, projectId, name, reviewType, status: 'queued',
    configJson: JSON.stringify(configJson), progressJson: '{}', remarks, finalSummary: '', failureReason: '',
    createdAt: now, updatedAt: now,
  };
}
```

The `StaticSession` returned needs `reviewType` in its shape — add the field to the literal return object above. (Per `staticSessions.test.ts:38`, `session.reviewType` is expected, so the test relies on the returned object having the field.)

- [ ] **Step 2: Run the existing `staticSessions.test.ts` tests and verify the previously-failing 24 pass**

Run: `pnpm --filter @centinel/sidecar test -- --run staticSessions.test.ts`
Expected: All 26 tests pass. (The tests at lines 33, 48, 59, 72, 74, 84, 85, 95, etc., already use the new 4-arg-with-reviewType signature.)

- [ ] **Step 3: Add `listActiveStaticSessions` to `staticSessions.ts`**

Append to the bottom of `sidecar/src/staticSessions.ts`:

```ts
export async function listActiveStaticSessions(): Promise<StaticSession[]> {
  const db = await getDb();
  const stmt = db.prepare(
    "SELECT id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at FROM static_sessions WHERE status IN ('queued', 'running') ORDER BY created_at DESC"
  );
  const rows: StaticSession[] = [];
  while (stmt.step()) {
    rows.push(mapSession(stmt.get() as unknown[]));
  }
  stmt.free();
  return rows;
}
```

- [ ] **Step 4: Write a failing test for `listActiveStaticSessions`**

Add to `sidecar/__tests__/unit/staticSessions.test.ts`, inside the existing `describe('staticSessions', ...)` block but outside the nested `describe('createStaticSession', ...)`:

```ts
// Extend the existing import block at the top of file:
import { listActiveStaticSessions } from '../../src/staticSessions';

describe('listActiveStaticSessions', () => {
  it('returns only queued and running sessions across all projects', async () => {
    await createStaticSession('proj-1', 'A', 'requirement_review', {});
    await createStaticSession('proj-2', 'B', 'code_review', {});
    await createStaticSession('proj-1', 'Done', 'requirement_review', {});
    const doneId = (await listStaticSessions('proj-1')).find(s => s.name === 'Done')!.id;
    await updateStaticSessionStatus(doneId, 'success', '', '');

    const active = await listActiveStaticSessions();
    expect(active.map(s => s.name).sort()).toEqual(['A', 'B']);
  });

  it('orders active sessions by created_at DESC (newest first)', async () => {
    await createStaticSession('proj-1', 'Older', 'requirement_review', {});
    await new Promise(resolve => setTimeout(resolve, 10));
    await createStaticSession('proj-1', 'Newer', 'requirement_review', {});

    const active = await listActiveStaticSessions();
    expect(active[0].name).toBe('Newer');
    expect(active[1].name).toBe('Older');
  });
});
```

- [ ] **Step 5: Run the new test and verify it passes (already implemented in Step 3)**

Run: `pnpm --filter @centinel/sidecar test -- --run staticSessions.test.ts -t "listActiveStaticSessions"`
Expected: 2 tests pass.

- [ ] **Step 6: Update `sidecar/src/index.ts` — add matcher + handler**

In `sidecar/src/index.ts`, add `listArtifacts` to the imports block (line ~31-40 — add next to other `artifacts.ts` imports):

```ts
import { listArtifacts } from './artifacts';
```

Add `listActiveStaticSessions` to the imports from `staticSessions`:

```ts
import {
  createStaticSession,
  listStaticSessions,
  getStaticSession,
  getActiveStaticSession,
  listActiveStaticSessions,
  updateStaticSessionStatus,
  ...
} from './staticSessions';
```

Add a URL matcher after `matchStaticCancel` (line ~139):

```ts
function matchStaticActive(url: string): boolean {
  return url === '/static-sessions/active';
}
```

- [ ] **Step 7: Add the `GET /static-sessions/active` route**

In `sidecar/src/index.ts`, immediately before the existing static-sessions POST block (line ~459), insert:

```ts
// List active static sessions across all projects (for toast polling)
if (req.method === 'GET' && matchStaticActive(url)) {
  return json(res, 200, await listActiveStaticSessions());
}
```

- [ ] **Step 8: Update the POST handler to extract and validate `reviewType` + `artifactIds`**

Replace lines 459-487 of `sidecar/src/index.ts`:

```ts
if (ssMatch && req.method === 'POST') {
  const body = await parseJsonBody(req);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const reviewType = body.reviewType;
  const artifactIds = Array.isArray(body.artifactIds) ? body.artifactIds.filter((x): x is string => typeof x === 'string') : [];
  const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';

  if (!name) return json(res, 400, { error: 'name is required' });

  const VALID_REVIEW_TYPES = ['requirement_review', 'code_review', 'requirement_to_code_traceability', 'cross_artifact_consistency'];
  if (typeof reviewType !== 'string' || !VALID_REVIEW_TYPES.includes(reviewType)) {
    return json(res, 400, { error: `reviewType must be one of: ${VALID_REVIEW_TYPES.join(', ')}` });
  }

  const activeSession = await getActiveStaticSession(ssMatch.projectId);
  if (activeSession) return json(res, 409, { error: 'A static review session is already running' });

  const allArtifacts = await listArtifacts(ssMatch.projectId);
  if (allArtifacts.length === 0) {
    return json(res, 400, { error: 'No artifacts found. Upload or import files first.' });
  }

  // Filter artifacts if user picked specific IDs; empty array = use all.
  const filteredArtifacts = artifactIds.length > 0
    ? allArtifacts.filter(a => artifactIds.includes(a.id))
    : allArtifacts;

  if (artifactIds.length > 0 && filteredArtifacts.length === 0) {
    return json(res, 400, { error: 'artifactIds contains no valid IDs' });
  }

  const session = await createStaticSession(ssMatch.projectId, name, reviewType, { artifactIds }, remarks);

  runStaticReview(session, filteredArtifacts, async (progress) => {
    await updateStaticSessionProgress(session.id, progress);
  }).catch(err => {
    console.error('[static-review] error:', err);
  });

  return json(res, 201, session);
}
```

- [ ] **Step 9: Run the whole sidecar test suite**

Run: `pnpm --filter @centinel/sidecar test`
Expected: All previously-passing tests still pass; `staticSessions.test.ts` 26/26; no new failures.

- [ ] **Step 10: Commit**

```bash
git add sidecar/src/staticSessions.ts sidecar/src/index.ts sidecar/__tests__/unit/staticSessions.test.ts
git commit -m "fix(sidecar): honor reviewType + artifactIds in session creation (Gap 2)

The POST /projects/:id/static-sessions handler dropped reviewType and
artifactIds from the request body, defaulting review_type to
'comprehensive' in the DB. Two review types
(requirement_to_code_traceability, cross_artifact_consistency) depend
on artifact selection to be meaningful.

- createStaticSession now takes reviewType as a required argument
- listActiveStaticSessions returns all queued/running sessions,
  newest-first, across all projects (for toast polling)
- POST handler validates reviewType and filters artifacts by ID

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Gap 3 — Artifact selector in `StaticReviewForm` (frontend)

**Files:**
- Modify: `centinel/src/components/StaticReviewForm.tsx:29-122` (props, state, UI)
- Modify: `centinel/src/components/ReviewModal.tsx:5-17` (props, pass-through)
- Modify: `centinel/src/screens/ProjectDetailScreen.tsx:117-119` (pass `artifacts`)

**Interfaces:**
- Consumes: `artifacts: Artifact[]` (prop, may be empty)
- Produces: `onSubmit({ name, reviewType, artifactIds, remarks })` where `artifactIds: string[]` reflects the user's selections

- [ ] **Step 1: Update `StaticReviewForm` props**

In `centinel/src/components/StaticReviewForm.tsx`, replace the existing imports (lines 1-2) and props block (lines 29-33):

```tsx
import { useState } from 'react';
import type { Artifact, ReviewType } from '../types';

const REVIEW_TYPES: { value: ReviewType; label: string; description: string }[] = [
  // ... unchanged ...
];

const MAX_REMARKS_CHARS = 300;
const TYPE_ORDER: Artifact['type'][] = ['requirement', 'source_code', 'design', 'coding_standard', 'other'];
const TYPE_LABELS: Record<Artifact['type'], string> = {
  requirement: 'Requirements',
  design: 'Design Documents',
  source_code: 'Source Code',
  coding_standard: 'Coding Standards',
  other: 'Other',
};

type Props = {
  projectId: string;
  artifacts: Artifact[];
  onSubmit: (data: { name: string; reviewType: ReviewType; artifactIds: string[]; remarks: string }) => Promise<void>;
  onCancel: () => void;
};
```

- [ ] **Step 2: Add artifact selector state**

In `centinel/src/components/StaticReviewForm.tsx`, replace the `useState` block (lines 36-40) with:

```tsx
export function StaticReviewForm({ projectId, artifacts, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('');
  const [reviewType, setReviewType] = useState<ReviewType>('requirement_review');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(artifacts.map(a => a.id)));
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(artifacts.map(a => a.id)));
  const selectNone = () => setSelectedIds(new Set());

  const currentConfig = REVIEW_TYPES.find(r => r.value === reviewType)!;
  // ... rest of component ...
```

- [ ] **Step 3: Update `handleSubmit` to send selected IDs**

In `centinel/src/components/StaticReviewForm.tsx`, replace the `handleSubmit` body (lines 47-71):

```tsx
const handleSubmit = async () => {
  setError(null);
  if (!name.trim()) {
    setError('Session name is required');
    return;
  }
  if (selectedIds.size === 0) {
    setError('Select at least one artifact to review');
    return;
  }
  if (overLimit) {
    setError(`Remarks must be ${MAX_REMARKS_CHARS} characters or fewer (currently ${charCount})`);
    return;
  }

  setSubmitting(true);
  try {
    await onSubmit({
      name: name.trim(),
      reviewType,
      artifactIds: Array.from(selectedIds),
      remarks: remarks.trim(),
    });
  } catch (e) {
    setError(String(e));
  } finally {
    setSubmitting(false);
  }
};
```

- [ ] **Step 4: Render the artifact selector between Review Type and Remarks**

In `centinel/src/components/StaticReviewForm.tsx`, insert this block immediately after the closing `</select>` + `<p className="form-hint">` of the Review Type field (after line 95, before the Remarks field):

```tsx
<div className="form-field">
  <div className="artifact-selector-header">
    <label>Artifacts to Review ({selectedIds.size}/{artifacts.length})</label>
    <div className="artifact-selector-actions">
      <button type="button" className="btn-link" onClick={selectAll}>Select all</button>
      <button type="button" className="btn-link" onClick={selectNone}>Clear</button>
    </div>
  </div>
  <div className="artifact-selector">
    {TYPE_ORDER.map(type => {
      const group = artifacts.filter(a => a.type === type);
      if (group.length === 0) return null;
      return (
        <fieldset key={type} className="artifact-group">
          <legend>{TYPE_LABELS[type]} ({group.length})</legend>
          {group.map(a => (
            <label key={a.id} className="artifact-checkbox">
              <input
                type="checkbox"
                checked={selectedIds.has(a.id)}
                onChange={() => toggle(a.id)}
              />
              <span className="artifact-filename">{a.fileName}</span>
            </label>
          ))}
        </fieldset>
      );
    })}
    {artifacts.length === 0 && <p className="form-hint">No artifacts uploaded yet.</p>}
  </div>
</div>
```

- [ ] **Step 5: Update `ReviewModal` to accept and pass `artifacts`**

In `centinel/src/components/ReviewModal.tsx`, replace the full file contents:

```tsx
import { Modal } from './Modal';
import { StaticReviewForm } from './StaticReviewForm';
import type { Artifact, ReviewType } from '../types';

type Props = {
  projectId: string;
  artifacts: Artifact[];
  onSubmit: (data: { name: string; reviewType: ReviewType; artifactIds: string[]; remarks: string }) => Promise<void>;
  onClose: () => void;
};

export function ReviewModal({ projectId, artifacts, onSubmit, onClose }: Props) {
  return (
    <Modal isOpen={true} onClose={onClose} title="New Static Review" width={520}>
      <StaticReviewForm
        projectId={projectId}
        artifacts={artifacts}
        onSubmit={onSubmit}
        onCancel={onClose}
      />
    </Modal>
  );
}
```

- [ ] **Step 6: Pass `artifacts` from `ProjectDetailScreen` to `ReviewModal`**

In `centinel/src/screens/ProjectDetailScreen.tsx`, hoist artifact state into the screen itself (avoiding a duplicate fetch). Add a new state declaration inside the function (near the other `useState` calls at line 22):

```tsx
const [artifacts, setArtifacts] = useState<Artifact[]>([]);
```

Extend the import on line 9:

```tsx
import type { Project, DynamicSession, StaticSession, Artifact, Screen, ReviewType } from '../types';
```

Add a loader (parallel to `loadDynamicSessions`, line 28):

```tsx
const loadArtifacts = useCallback(async () => {
  try { setArtifacts(await api.listArtifacts(project.id)); } catch {}
}, [project.id]);
```

Add it to the existing `useEffect` (line 36):

```tsx
useEffect(() => { loadDynamicSessions(); loadStaticSessions(); loadArtifacts(); }, [loadDynamicSessions, loadStaticSessions, loadArtifacts]);
```

Pass `artifacts` to `<ReviewModal>` (line 117):

```tsx
<ReviewModal projectId={project.id} artifacts={artifacts} onSubmit={handleCreateStatic}
  onClose={() => { setShowStaticForm(false); setError(null); }} />
```

- [ ] **Step 7: Frontend type-check**

Run: `cd centinel && pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add centinel/src/components/StaticReviewForm.tsx centinel/src/components/ReviewModal.tsx centinel/src/screens/ProjectDetailScreen.tsx
git commit -m "feat(static-review): add artifact selector to review form (Gap 3)

The form previously sent artifactIds:[] regardless of user intent,
making requirement_to_code_traceability and cross_artifact_consistency
review types impossible to scope.

Renders a checkbox group of project artifacts, grouped by type,
defaulting to all selected. Submits selectedIds as artifactIds.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Update frontend API client for new endpoint + payload

**Files:**
- Modify: `centinel/src/api/client.ts:101-110` (createStaticSession payload) + append `listActiveStaticSessions`

- [ ] **Step 1: Update `createStaticSession` payload shape**

In `centinel/src/api/client.ts`, replace lines 103-110:

```ts
createStaticSession: (projectId: string, data: {
  name: string;
  reviewType: 'requirement_review' | 'code_review' | 'requirement_to_code_traceability' | 'cross_artifact_consistency';
  artifactIds: string[];
  remarks?: string;
}) =>
  request<StaticSession>(`/projects/${projectId}/static-sessions`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
```

(Use the inline union literal to avoid creating a new exported type just for the API surface.)

- [ ] **Step 2: Add `listActiveStaticSessions`**

In `centinel/src/api/client.ts`, immediately after the existing `listStaticSessions` (line 102), insert:

```ts
listActiveStaticSessions: () =>
  request<StaticSession[]>('/static-sessions/active'),
```

- [ ] **Step 3: Verify call site still compiles**

In `centinel/src/screens/ProjectDetailScreen.tsx`, the `handleCreateStatic` function (line 55) already takes `{ name, reviewType, artifactIds, remarks }` and passes it as `data` to `api.createStaticSession`. After the API client change in Step 1, the call site automatically forwards all four fields.

- [ ] **Step 4: Frontend type-check**

Run: `cd centinel && pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add centinel/src/api/client.ts
git commit -m "feat(api): send reviewType + artifactIds, add listActiveStaticSessions

Aligns the frontend client with the sidecar POST contract and adds the
new GET /static-sessions/active endpoint used by the polling hook.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Active-review context + polling hook

**Files:**
- Create: `centinel/src/context/ActiveReviewContext.tsx`
- Create: `centinel/src/hooks/useActiveReview.ts`

**Interfaces:**
- Consumes: `api.listActiveStaticSessions()`, `api.getStaticSession(projectId, sessionId)`, `api.listStaticFindings(projectId, sessionId)`, `api.projects()`
- Produces:
  - `ActiveReviewState | null` + `ActiveReviewControls` via `useActiveReviewState()`
  - `ActiveReviewProvider` component (mounts the hook + wraps tree)

- [ ] **Step 1: Create `ActiveReviewContext.tsx`**

Create `centinel/src/context/ActiveReviewContext.tsx`:

```tsx
import { createContext, useContext } from 'react';
import type { Finding, ReviewProgress, ReviewType, StaticSessionStatus } from '../types';

export type ActiveReviewSnapshot = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  reviewType: ReviewType;
  status: StaticSessionStatus;
  progress: ReviewProgress;
  findings: Finding[];
  finalSummary: string;
  failureReason: string;
  createdAt: string;
};

export type ActiveReviewState = {
  session: ActiveReviewSnapshot;
  expanded: boolean;
  completedAt: string | null;
  dismissed: boolean;
  connectionLost: boolean;
};

export type ActiveReviewControls = {
  setExpanded: (expanded: boolean) => void;
  setDismissed: (dismissed: boolean) => void;
  retry: () => void;
};

export const ActiveReviewContext = createContext<{
  state: ActiveReviewState | null;
  controls: ActiveReviewControls;
} | null>(null);

export function useActiveReviewState() {
  const ctx = useContext(ActiveReviewContext);
  if (!ctx) throw new Error('useActiveReviewState must be used inside <ActiveReviewProvider>');
  return ctx;
}
```

- [ ] **Step 2: Create `useActiveReview.ts` (state machine + polling + Provider)**

Create `centinel/src/hooks/useActiveReview.ts`:

```ts
import { useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api/client';
import type { Finding, ReviewProgress, StaticSession } from '../types';
import {
  ActiveReviewContext,
  type ActiveReviewSnapshot,
  type ActiveReviewState,
  type ActiveReviewControls,
} from '../context/ActiveReviewContext';

const POLL_INTERVAL_MS = 1000;
const AUTO_DISMISS_MS = 5 * 60 * 1000; // 5 min after success
const FAILURE_DISMISS_MS = 30 * 1000;  // 30s after failure/cancelled
const MAX_CONSECUTIVE_FAILURES = 3;

function emptyProgress(): ReviewProgress {
  return {
    currentStage: 'understanding_context',
    stages: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function loadSnapshot(session: StaticSession, projectName: string): Promise<ActiveReviewSnapshot> {
  let progress: ReviewProgress = emptyProgress();
  try {
    if (session.progressJson && session.progressJson !== '{}') {
      progress = JSON.parse(session.progressJson);
    }
  } catch {
    progress = emptyProgress();
  }

  let findings: Finding[] = [];
  if (session.status === 'success') {
    try { findings = await api.listStaticFindings(session.projectId, session.id); } catch {}
  }

  return {
    id: session.id,
    projectId: session.projectId,
    projectName,
    name: session.name,
    reviewType: session.reviewType,
    status: session.status,
    progress,
    findings,
    finalSummary: session.finalSummary,
    failureReason: session.failureReason,
    createdAt: session.createdAt,
  };
}

export function useActiveReview() {
  const [state, setState] = useState<ActiveReviewState | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const completedAtRef = useRef<string | null>(null);
  const lastSessionIdRef = useRef<string | null>(null);
  const projectNamesRef = useRef<Map<string, string>>(new Map());
  const stateRef = useRef<ActiveReviewState | null>(null);
  stateRef.current = state;

  const controls: ActiveReviewControls = {
    setExpanded: (expanded) => setState(prev => prev ? { ...prev, expanded } : prev),
    setDismissed: (dismissed) => setState(prev => prev ? { ...prev, dismissed } : prev),
    retry: () => { setConnectionLost(false); setRetryTick(t => t + 1); },
  };

  const runOnce = useCallback(async (): Promise<{ ok: boolean; active: StaticSession[] }> => {
    try {
      const active = await api.listActiveStaticSessions();
      return { ok: true, active };
    } catch {
      return { ok: false, active: [] };
    }
  }, []);

  // Main polling effect — runs while mounted; per-tick logic decides state.
  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    let consecutiveFailures = 0;

    const handleResult = async (ok: boolean, active: StaticSession[]) => {
      if (cancelled) return;
      if (!ok) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) setConnectionLost(true);
        return;
      }
      consecutiveFailures = 0;
      setConnectionLost(false);

      if (active.length > 0) {
        const session = active[0]; // newest first per listActiveStaticSessions
        lastSessionIdRef.current = session.id;
        completedAtRef.current = null;

        let projectName = projectNamesRef.current.get(session.projectId) ?? '';
        if (!projectName) {
          try {
            const projects = await api.projects();
            for (const p of projects) projectNamesRef.current.set(p.id, p.name);
            projectName = projectNamesRef.current.get(session.projectId) ?? '';
          } catch {}
        }

        const snapshot = await loadSnapshot(session, projectName);
        if (cancelled) return;
        setState(prev => ({
          session: snapshot,
          expanded: prev?.session.id === session.id ? prev.expanded : false,
          completedAt: prev?.session.id === session.id ? prev.completedAt : null,
          dismissed: prev?.session.id === session.id ? prev.dismissed : false,
          connectionLost: false,
        }));
        return;
      }

      // No active sessions. Check whether we have a session that just transitioned terminal.
      const id = lastSessionIdRef.current;
      const current = stateRef.current;
      if (id && current && (current.session.id === id) && (current.session.status === 'running' || current.session.status === 'queued')) {
        // Try to fetch terminal snapshot one last time.
        let promoted: StaticSession | null = null;
        try {
          const projects = await api.projects();
          for (const p of projects) {
            try {
              const s = await api.getStaticSession(p.id, id);
              if (s) { promoted = s; break; }
            } catch {}
          }
        } catch {}

        if (promoted && (promoted.status === 'success' || promoted.status === 'failure' || promoted.status === 'cancelled')) {
          if (!completedAtRef.current) completedAtRef.current = new Date().toISOString();
          const projectName = projectNamesRef.current.get(promoted.projectId) ?? '';
          const snapshot = await loadSnapshot(promoted, projectName);
          if (cancelled) return;
          setState(prev => prev ? {
            ...prev,
            session: snapshot,
            completedAt: prev.completedAt ?? completedAtRef.current,
          } : null);
          return;
        }
      }

      // Auto-dismiss check
      if (current?.completedAt) {
        const elapsed = Date.now() - new Date(current.completedAt).getTime();
        const limit = current.session.status === 'success' ? AUTO_DISMISS_MS : FAILURE_DISMISS_MS;
        if (elapsed >= limit) {
          completedAtRef.current = null;
          lastSessionIdRef.current = null;
          setState(null);
        }
      }
    };

    void (async () => {
      const { ok, active } = await runOnce();
      await handleResult(ok, active);
    })();

    intervalId = window.setInterval(async () => {
      const { ok, active } = await runOnce();
      await handleResult(ok, active);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [retryTick, runOnce]);

  // Surface connectionLost at the state level too so UI consumers see it.
  const surfaced: ActiveReviewState | null = state && connectionLost
    ? { ...state, connectionLost: true }
    : state;

  return { state: surfaced, controls };
}

export function ActiveReviewProvider({ children }: { children: ReactNode }) {
  const { state, controls } = useActiveReview();
  return (
    <ActiveReviewContext.Provider value={{ state, controls }}>
      {children}
    </ActiveReviewContext.Provider>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd centinel && pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add centinel/src/context/ActiveReviewContext.tsx centinel/src/hooks/useActiveReview.ts
git commit -m "feat(review): add ActiveReviewContext + useActiveReview polling hook

Single source of truth for the toast + inline-progress UI. Owns the
1s polling interval, manages connection-lost state after 3 consecutive
failures, and surfaces expanded/dismissed UI toggles via a Provider.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: `<ReviewToast>` container + three state variants

**Files:**
- Create: `centinel/src/components/ReviewToast.tsx`
- Create: `centinel/src/components/ReviewToastCollapsed.tsx`
- Create: `centinel/src/components/ReviewToastExpanded.tsx`
- Create: `centinel/src/components/ReviewToastComplete.tsx`

**Interfaces:**
- Consumes: `useActiveReviewState()` → reads `state` and `controls`
- Produces: Renders nothing when `state === null` or `state.dismissed === true`; otherwise renders the appropriate variant.

- [ ] **Step 1: Create `ReviewToastCollapsed.tsx`**

Create `centinel/src/components/ReviewToastCollapsed.tsx`:

```tsx
import { ChevronRight, Loader } from 'lucide-react';
import type { ActiveReviewSnapshot } from '../context/ActiveReviewContext';

const STAGE_LABELS: Record<string, string> = {
  understanding_context: 'Context',
  code_review: 'Code',
  requirement_validation: 'Req',
  summarizing: 'Summary',
};

function stageLabel(stageId: string): string {
  return STAGE_LABELS[stageId] ?? stageId;
}

export function ReviewToastCollapsed({ snapshot, onClick }: {
  snapshot: ActiveReviewSnapshot;
  onClick: () => void;
}) {
  const stages = ['understanding_context', 'code_review', 'requirement_validation', 'summarizing'] as const;
  const active = snapshot.progress.stages.find(s => s.status === 'active');
  const currentStageId = active?.id ?? snapshot.progress.currentStage;

  return (
    <div className="review-toast-collapsed" onClick={onClick} role="button" tabIndex={0}>
      <div className="review-toast-header">
        <Loader size={14} className="spin" />
        <span className="review-toast-title">{snapshot.name}</span>
        <span className="review-toast-review-type">{snapshot.reviewType.replace(/_/g, ' ')}</span>
        <ChevronRight size={14} />
      </div>
      <div className="review-toast-progress">
        {stages.map(s => {
          const stage = snapshot.progress.stages.find(x => x.id === s);
          const status = stage?.status ?? (s === currentStageId ? 'active' : 'pending');
          return <span key={s} className={`stage-dot stage-${status}`} title={stageLabel(s)} />;
        })}
      </div>
      <div className="review-toast-current">
        {stageLabel(currentStageId)}
        {active && active.thoughts.length > 0 ? ` · ${active.thoughts[active.thoughts.length - 1]}` : '…'}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `ReviewToastExpanded.tsx`**

Create `centinel/src/components/ReviewToastExpanded.tsx`:

```tsx
import { ChevronDown, ChevronRight, Loader } from 'lucide-react';
import type { ActiveReviewSnapshot } from '../context/ActiveReviewContext';
import { api } from '../api/client';

const STAGE_LABELS: Record<string, string> = {
  understanding_context: 'Understanding Context',
  code_review: 'Code Review',
  requirement_validation: 'Requirement Validation',
  summarizing: 'Summarizing',
};

const ALL_STAGES = ['understanding_context', 'code_review', 'requirement_validation', 'summarizing'] as const;

export function ReviewToastExpanded({ snapshot, onCancel }: {
  snapshot: ActiveReviewSnapshot;
  onCancel: () => void;
}) {
  const handleCancel = async () => {
    try { await api.cancelStaticSession(snapshot.projectId, snapshot.id); } catch {}
  };

  return (
    <div className="review-toast-expanded">
      <div className="review-toast-stages">
        {ALL_STAGES.map(stageId => {
          const stage = snapshot.progress.stages.find(s => s.id === stageId);
          const status = stage?.status ?? 'pending';
          const label = STAGE_LABELS[stageId] ?? stageId;
          const Icon = status === 'done' ? ChevronDown : status === 'active' ? Loader : ChevronRight;
          return (
            <div key={stageId} className={`review-toast-stage stage-${status}`}>
              <div className="review-toast-stage-header">
                <Icon size={12} className={status === 'active' ? 'spin' : ''} />
                <span>{label}</span>
                <span className="review-toast-stage-status">({status})</span>
              </div>
              {stage && stage.thoughts.length > 0 && (
                <ul className="review-toast-thoughts">
                  {stage.thoughts.slice(-3).map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {(snapshot.status === 'running' || snapshot.status === 'queued') && (
        <div className="review-toast-actions">
          <button className="btn-secondary" onClick={handleCancel}>Cancel Review</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `ReviewToastComplete.tsx`**

Create `centinel/src/components/ReviewToastComplete.tsx`:

```tsx
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { ActiveReviewSnapshot } from '../context/ActiveReviewContext';

function countBySeverity(findings: ActiveReviewSnapshot['findings']) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    const s = f.severity.toLowerCase();
    if (s in counts) counts[s as keyof typeof counts]++;
  }
  return counts;
}

export function ReviewToastComplete({ snapshot }: { snapshot: ActiveReviewSnapshot }) {
  if (snapshot.status === 'failure') {
    return (
      <div className="review-toast-complete review-toast-failure">
        <XCircle size={14} />
        <span>Review failed — {snapshot.failureReason || 'Unknown error'}</span>
      </div>
    );
  }
  if (snapshot.status === 'cancelled') {
    return (
      <div className="review-toast-complete review-toast-cancelled">
        <span>Review cancelled</span>
      </div>
    );
  }
  const counts = countBySeverity(snapshot.findings);
  return (
    <div className="review-toast-complete">
      <div className="review-toast-header">
        <CheckCircle2 size={14} className="success" />
        <span className="review-toast-title">{snapshot.name}</span>
      </div>
      <div className="review-toast-severity-counts">
        <span className="severity-count critical"><AlertTriangle size={12} /> {counts.critical} critical</span>
        <span className="severity-count high">{counts.high} high</span>
        <span className="severity-count medium">{counts.medium} medium</span>
        <span className="severity-count low">{counts.low} low</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `ReviewToast.tsx` (the container)**

Create `centinel/src/components/ReviewToast.tsx`:

```tsx
import { X } from 'lucide-react';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { ReviewToastCollapsed } from './ReviewToastCollapsed';
import { ReviewToastExpanded } from './ReviewToastExpanded';
import { ReviewToastComplete } from './ReviewToastComplete';

export function ReviewToast() {
  const { state, controls } = useActiveReviewState();
  if (!state) return null;
  if (state.dismissed) return null;
  if (state.connectionLost) {
    return (
      <div className="review-toast review-toast-connection-lost">
        <span>Connection lost</span>
        <button className="btn-secondary" onClick={controls.retry}>Retry</button>
      </div>
    );
  }

  const { session, expanded } = state;
  const isTerminal = session.status === 'success' || session.status === 'failure' || session.status === 'cancelled';

  return (
    <div className={`review-toast ${expanded ? 'expanded' : 'collapsed'} status-${session.status}`}>
      <button
        className="review-toast-close"
        onClick={(e) => { e.stopPropagation(); controls.setDismissed(true); }}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>

      {isTerminal ? (
        <ReviewToastComplete snapshot={session} />
      ) : expanded ? (
        <ReviewToastExpanded snapshot={session} onCancel={() => controls.setExpanded(false)} />
      ) : (
        <ReviewToastCollapsed snapshot={session} onClick={() => controls.setExpanded(true)} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

Run: `cd centinel && pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add centinel/src/components/ReviewToast.tsx centinel/src/components/ReviewToastCollapsed.tsx centinel/src/components/ReviewToastExpanded.tsx centinel/src/components/ReviewToastComplete.tsx
git commit -m "feat(review): add ReviewToast with collapsed/expanded/complete variants

Top-center toast that surfaces live static-review progress across all
screens. Collapsed shows the four-stage progress bar + current thought;
expanded reveals the full stage history with thoughts; complete shows
severity counts.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: `<ActiveSessionInline>` and `<ActiveSessionComplete>`

**Files:**
- Create: `centinel/src/components/ActiveSessionInline.tsx`
- Create: `centinel/src/components/ActiveSessionComplete.tsx`

**Interfaces:**
- Consumes: `useActiveReviewState()`, `snapshot: ActiveReviewSnapshot`, `findings: Finding[]`
- Produces: inline panel under a session row matching `snapshot.projectId`; cancel button calls `api.cancelStaticSession`.

- [ ] **Step 1: Create `ActiveSessionInline.tsx`**

Create `centinel/src/components/ActiveSessionInline.tsx`:

```tsx
import { Loader, X } from 'lucide-react';
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { api } from '../api/client';

const STAGE_LABELS: Record<string, string> = {
  understanding_context: 'Understanding Context',
  code_review: 'Code Review',
  requirement_validation: 'Requirement Validation',
  summarizing: 'Summarizing',
};

const ALL_STAGES = ['understanding_context', 'code_review', 'requirement_validation', 'summarizing'] as const;

export function ActiveSessionInline({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const { state } = useActiveReviewState();
  if (!state) return null;
  const { session } = state;
  if (session.projectId !== projectId || session.id !== sessionId) return null;
  if (session.status !== 'running' && session.status !== 'queued') return null;

  const active = session.progress.stages.find(s => s.status === 'active');
  const currentStageId = active?.id ?? session.progress.currentStage;
  const lastThought = active?.thoughts[active.thoughts.length - 1];

  const handleCancel = async () => {
    try { await api.cancelStaticSession(session.projectId, session.id); } catch {}
  };

  return (
    <div className="active-session-inline">
      <div className="active-session-inline-stages">
        {ALL_STAGES.map(s => {
          const stage = session.progress.stages.find(x => x.id === s);
          const status = stage?.status ?? (s === currentStageId ? 'active' : 'pending');
          return <span key={s} className={`stage-dot stage-${status}`} title={STAGE_LABELS[s] ?? s} />;
        })}
      </div>
      <div className="active-session-inline-detail">
        <Loader size={12} className="spin" />
        <span>{STAGE_LABELS[currentStageId] ?? currentStageId}</span>
        {lastThought ? <span className="active-session-inline-thought">· {lastThought}</span> : null}
      </div>
      <button className="btn-link" onClick={handleCancel}>
        <X size={12} /> Cancel
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `ActiveSessionComplete.tsx`**

Create `centinel/src/components/ActiveSessionComplete.tsx`:

```tsx
import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { Finding } from '../types';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

export function ActiveSessionComplete({ projectId, sessionId, findings }: {
  projectId: string;
  sessionId: string;
  findings: Finding[];
}) {
  void projectId; void sessionId;
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['critical']));

  const grouped = SEVERITY_ORDER.map(severity => ({
    severity,
    items: findings.filter(f => f.severity.toLowerCase() === severity),
  }));

  const toggle = (severity: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  };

  return (
    <div className="active-session-complete">
      <div className="active-session-complete-summary">
        <CheckCircle2 size={12} className="success" />
        <span>{findings.length} finding{findings.length === 1 ? '' : 's'}</span>
        {SEVERITY_ORDER.map(sev => {
          const count = grouped.find(g => g.severity === sev)?.items.length ?? 0;
          if (count === 0) return null;
          return (
            <span key={sev} className={`severity-count ${sev}`}>
              {count} {sev}
            </span>
          );
        })}
      </div>
      <div className="active-session-complete-groups">
        {grouped.filter(g => g.items.length > 0).map(g => (
          <div key={g.severity} className="finding-group">
            <button
              className="finding-group-header"
              onClick={() => toggle(g.severity)}
            >
              {openGroups.has(g.severity) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className={`severity-label ${g.severity}`}>
                {g.severity} ({g.items.length})
              </span>
            </button>
            {openGroups.has(g.severity) && (
              <ul className="finding-list">
                {g.items.map(f => (
                  <li key={f.id} className="finding-item">
                    {g.severity === 'critical' && <AlertTriangle size={12} className="severity-icon critical" />}
                    <span className="finding-title">{f.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd centinel && pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add centinel/src/components/ActiveSessionInline.tsx centinel/src/components/ActiveSessionComplete.tsx
git commit -m "feat(review): add inline session progress + complete-summary panels

ActiveSessionInline renders a stage bar under the matching session row
in the project workspace, with a Cancel button. ActiveSessionComplete
replaces it after success/failure, showing severity-grouped findings.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Wire `ProjectDetailScreen` to new inline components

**Files:**
- Modify: `centinel/src/screens/ProjectDetailScreen.tsx`

**Interfaces:**
- Consumes: `<ActiveSessionInline>`, `<ActiveSessionComplete>`, `api.listStaticFindings(projectId, sessionId)`

- [ ] **Step 1: Add state for inline-panel open session + findings cache**

In `centinel/src/screens/ProjectDetailScreen.tsx`, add inside the component (near line 22):

```tsx
const [openSessionId, setOpenSessionId] = useState<string | null>(null);
const [findingsBySession, setFindingsBySession] = useState<Record<string, Finding[]>>({});
```

Extend the imports on line 9:

```tsx
import type { Project, DynamicSession, StaticSession, Artifact, Finding, Screen, ReviewType } from '../types';
```

- [ ] **Step 2: Replace the static-session row markup with click-to-expand**

In `centinel/src/screens/ProjectDetailScreen.tsx`, replace the `staticSessions.map(s => …)` block (lines 122-134):

```tsx
{staticSessions.map(s => {
  const isActive = s.status === 'running' || s.status === 'queued';
  const isOpen = openSessionId === s.id;
  const handleClick = async () => {
    if (isOpen) { setOpenSessionId(null); return; }
    setOpenSessionId(s.id);
    if (!isActive) await ensureFindingsLoaded(s.id);
  };
  return (
    <div key={s.id} className={`session-block ${isOpen ? 'open' : ''}`}>
      <div className="session-row" onClick={handleClick}>
        <div className="session-info-compact">
          <span className="session-name">{s.name}</span>
          <span className="session-type">{REVIEW_TYPE_LABELS[s.reviewType] || s.reviewType}</span>
        </div>
        <div className="session-meta">
          <StatusBadge label={s.status} />
          <span className="session-date">{new Date(s.createdAt).toLocaleString()}</span>
        </div>
      </div>
      {isOpen && (
        isActive ? (
          <ActiveSessionInline projectId={project.id} sessionId={s.id} />
        ) : (
          <ActiveSessionComplete
            projectId={project.id}
            sessionId={s.id}
            findings={findingsBySession[s.id] ?? []}
          />
        )
      )}
    </div>
  );
})}
```

- [ ] **Step 3: Load findings when opening a completed session**

Add a helper near the other loaders in `ProjectDetailScreen` (after line 36):

```tsx
const ensureFindingsLoaded = useCallback(async (sessionId: string) => {
  if (findingsBySession[sessionId]) return;
  try {
    const findings = await api.listStaticFindings(project.id, sessionId);
    setFindingsBySession(prev => ({ ...prev, [sessionId]: findings }));
  } catch {}
}, [findingsBySession, project.id]);
```

- [ ] **Step 4: Add imports for inline components**

At the top of `ProjectDetailScreen.tsx`, add:

```tsx
import { useActiveReviewState } from '../context/ActiveReviewContext';
import { ActiveSessionInline } from '../components/ActiveSessionInline';
import { ActiveSessionComplete } from '../components/ActiveSessionComplete';
```

Then add this hook call inside the component (right after the other `useState` declarations):

```tsx
useActiveReviewState(); // ensures context exists; actual reading happens in children
```

(Reading via this no-op hook guarantees the component re-renders when the toast poll updates the context.)

- [ ] **Step 5: Type-check**

Run: `cd centinel && pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add centinel/src/screens/ProjectDetailScreen.tsx
git commit -m "feat(review): inline progress under session row in project workspace

Replaces navigation to a deleted detail page with click-to-expand
panels. Active sessions show the inline progress bar with a Cancel
button; completed sessions show finding severity counts with
collapsible groups.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Delete obsolete screens + clean up routes

**Files:**
- Delete: `centinel/src/screens/StaticSessionScreen.tsx`
- Delete: `centinel/src/screens/ReviewScreen.tsx`
- Delete: `centinel/src/screens/ReviewSessionScreen.tsx`
- Delete: `centinel/src/components/ReviewProgressView.tsx`
- Modify: `centinel/src/App.tsx`
- Modify: `centinel/src/types.ts`

- [ ] **Step 1: Delete the four files**

```bash
rm centinel/src/screens/StaticSessionScreen.tsx \
   centinel/src/screens/ReviewScreen.tsx \
   centinel/src/screens/ReviewSessionScreen.tsx \
   centinel/src/components/ReviewProgressView.tsx
```

- [ ] **Step 2: Remove the three Screen variants from `types.ts`**

In `centinel/src/types.ts`, replace the `Screen` union (lines 151-162):

```ts
export type Screen =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'project-detail'; projectId: string }
  | { name: 'dynamic-testing'; projectId: string }
  | { name: 'dynamic-session'; projectId: string; sessionId: string }
  | { name: 'evidence-browser'; projectId: string }
  | { name: 'requirements'; projectId: string }
  | { name: 'settings' };
```

- [ ] **Step 3: Update `App.tsx` — remove imports for deleted screens + add toast/provider**

In `centinel/src/App.tsx`, replace the imports (lines 1-17):

```tsx
import { useState, useEffect, useCallback } from 'react';
import './App.css';
import './command.css';
import { AppShell } from './components/AppShell';
import { DashboardScreen } from './screens/DashboardScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { ProjectDetailScreen } from './screens/ProjectDetailScreen';
import { DynamicSessionScreen } from './screens/DynamicSessionScreen';
import { DynamicTestingScreen } from './screens/DynamicTestingScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { RequirementsScreen } from './screens/RequirementsScreen';
import { EvidenceBrowser } from './screens/EvidenceBrowser';
import { ReviewToast } from './components/ReviewToast';
import { ActiveReviewProvider } from './hooks/useActiveReview';
import { api } from './api/client';
import type { Project, AiProviderSetting, Screen } from './types';
```

- [ ] **Step 4: Update `currentProject` selector to remove `'review'`**

In `centinel/src/App.tsx` (line 83), replace:

```tsx
const currentProject = (screen.name === 'project-detail' || screen.name === 'dynamic-testing')
    ? projects.find(p => p.id === screen.projectId) ?? null
    : null;
```

- [ ] **Step 5: Wrap the App render tree with the provider + mount the toast + remove the three deleted branches**

In `centinel/src/App.tsx`, replace the `return` block (lines 87-165):

```tsx
  return (
    <ActiveReviewProvider>
      <AppShell
        screen={screen}
        onNavigate={setScreen}
        aiSettings={aiSettings}
        sidecarOnline={sidecarOnline}
      >
        {screen.name === 'dashboard' && (
          <DashboardScreen
            projects={projects}
            aiSettings={aiSettings}
            sidecarOnline={sidecarOnline}
            onNavigate={setScreen}
          />
        )}
        {screen.name === 'projects' && (
          <ProjectsScreen
            projects={projects}
            onNavigate={setScreen}
            onCreate={handleCreateProject}
            onDelete={handleDeleteProject}
          />
        )}
        {screen.name === 'project-detail' && currentProject && (
          <ProjectDetailScreen
            project={currentProject}
            onNavigate={setScreen}
          />
        )}
        {screen.name === 'dynamic-testing' && currentProject && (
          <DynamicTestingScreen
            project={currentProject}
            onNavigate={setScreen}
          />
        )}
        {screen.name === 'dynamic-session' && (
          <DynamicSessionScreen
            projectId={screen.projectId}
            sessionId={screen.sessionId}
            onNavigate={setScreen}
          />
        )}
        {screen.name === 'evidence-browser' && (
          <EvidenceBrowser
            projectId={screen.projectId}
            onNavigate={setScreen}
          />
        )}
        {screen.name === 'requirements' && (
          <RequirementsScreen
            projectId={screen.projectId}
            onNavigate={setScreen}
          />
        )}
        {screen.name === 'settings' && (
          <SettingsScreen settings={aiSettings} onRefresh={loadData} />
        )}
        <ReviewToast />
      </AppShell>
    </ActiveReviewProvider>
  );
```

- [ ] **Step 6: Type-check + build**

Run:
```bash
cd centinel && pnpm tsc --noEmit
cd centinel && pnpm build
```

Expected: 0 type errors; build succeeds.

- [ ] **Step 7: Run all tests**

Run:
```bash
pnpm --filter @centinel/sidecar test
cd centinel && pnpm test
```

Expected: all sidecar tests pass; frontend tests pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove static-review detail pages, mount global toast

Eliminates StaticSessionScreen, ReviewScreen, ReviewSessionScreen,
and ReviewProgressView (~2,300 lines). All three Screen union variants
deleted; routes cleaned from App.tsx. The global <ReviewToast /> now
mounts inside <ActiveReviewProvider /> at the App root.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Component tests for toast + inline + form

**Files:**
- Create: `centinel/src/components/ReviewToast.test.tsx`
- Create: `centinel/src/components/ActiveSessionInline.test.tsx`
- Create: `centinel/src/components/StaticReviewForm.test.tsx`
- Possibly modify: `centinel/vite.config.ts` (add jsdom env), `centinel/package.json` (add deps)

**Note:** Frontend tests use Vitest. If Vitest isn't already configured for jsdom, add it before writing component tests.

- [ ] **Step 1: Check existing Vitest config**

Run: `cat centinel/vite.config.ts`
Look for a `test` block. If absent, proceed to Step 2. If present, skip Step 2.

- [ ] **Step 2: Add jsdom environment if missing**

If Step 1 revealed no test block, replace `centinel/vite.config.ts` with:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
```

Also add `jsdom` and testing-library to `centinel/package.json` devDependencies:

```bash
cd centinel && pnpm add -D jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Write `ReviewToast.test.tsx`**

Create `centinel/src/components/ReviewToast.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ActiveReviewProvider } from '../hooks/useActiveReview';
import { ReviewToast } from './ReviewToast';

vi.mock('../api/client', () => ({
  api: {
    listActiveStaticSessions: vi.fn(),
    getStaticSession: vi.fn(),
    listStaticFindings: vi.fn(),
    projects: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Test Project' }]),
    cancelStaticSession: vi.fn(),
  },
}));

import { api } from '../api/client';
const mockedApi = vi.mocked(api, true);

function renderWithProvider() {
  return render(
    <ActiveReviewProvider>
      <ReviewToast />
    </ActiveReviewProvider>
  );
}

describe('<ReviewToast>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedApi.listActiveStaticSessions.mockReset();
    mockedApi.listStaticFindings.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when no active sessions', async () => {
    mockedApi.listActiveStaticSessions.mockResolvedValue([]);
    renderWithProvider();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('renders collapsed progress when session is running', async () => {
    mockedApi.listActiveStaticSessions.mockResolvedValue([{
      id: 's1', projectId: 'p1', name: 'My Review', reviewType: 'requirement_review',
      status: 'running', configJson: '{}',
      progressJson: '{"currentStage":"code_review","stages":[{"id":"code_review","label":"Code Review","status":"active","thoughts":[]}],"startedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}',
      remarks: '', finalSummary: '', failureReason: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }]);
    mockedApi.listStaticFindings.mockResolvedValue([]);

    renderWithProvider();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    expect(screen.getByText('My Review')).toBeInTheDocument();
    expect(screen.getByText(/requirement review/i)).toBeInTheDocument();
  });

  it('hides when X is clicked and returns when a new session starts', async () => {
    const session1 = { id: 's1', projectId: 'p1', name: 'First', reviewType: 'requirement_review' as const, status: 'running' as const, configJson: '{}', progressJson: '{"currentStage":"understanding_context","stages":[],"startedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}', remarks: '', finalSummary: '', failureReason: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const session2 = { ...session1, id: 's2', name: 'Second' };

    mockedApi.listActiveStaticSessions.mockResolvedValueOnce([session1]);
    renderWithProvider();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('First')).not.toBeInTheDocument();

    mockedApi.listActiveStaticSessions.mockResolvedValueOnce([session2]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Write `ActiveSessionInline.test.tsx`**

Create `centinel/src/components/ActiveSessionInline.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActiveReviewContext } from '../context/ActiveReviewContext';
import { ActiveSessionInline } from './ActiveSessionInline';
import type { ActiveReviewSnapshot, ActiveReviewState, ActiveReviewControls } from '../context/ActiveReviewContext';

vi.mock('../api/client', () => ({
  api: { cancelStaticSession: vi.fn() },
}));

const snapshot: ActiveReviewSnapshot = {
  id: 's1', projectId: 'p1', projectName: 'P1', name: 'My Review',
  reviewType: 'requirement_review', status: 'running',
  progress: { currentStage: 'code_review', stages: [{ id: 'code_review', label: 'Code Review', status: 'active', thoughts: ['Inspecting files'] }], startedAt: '', updatedAt: '' },
  findings: [], finalSummary: '', failureReason: '', createdAt: '',
};

const controls: ActiveReviewControls = { setExpanded: vi.fn(), setDismissed: vi.fn(), retry: vi.fn() };

function renderWithState(state: ActiveReviewState | null, sid = 's1', pid = 'p1') {
  return render(
    <ActiveReviewContext.Provider value={{ state, controls }}>
      <ActiveSessionInline projectId={pid} sessionId={sid} />
    </ActiveReviewContext.Provider>
  );
}

describe('<ActiveSessionInline>', () => {
  it('renders progress for matching session', () => {
    renderWithState({ session: snapshot, expanded: false, completedAt: null, dismissed: false, connectionLost: false });
    expect(screen.getByText('Code Review')).toBeInTheDocument();
    expect(screen.getByText(/Inspecting files/)).toBeInTheDocument();
  });

  it('does not render for a different project', () => {
    const { container } = render(
      <ActiveReviewContext.Provider value={{ state: { ...snapshot, projectId: 'p2' } as ActiveReviewSnapshot, controls } as { state: ActiveReviewState; controls: ActiveReviewControls }}>
        <ActiveSessionInline projectId="p1" sessionId="s1" />
      </ActiveReviewContext.Provider>
    );
    expect(container.querySelector('.active-session-inline')).toBeNull();
  });

  it('does not render when session is completed', () => {
    const { container } = render(
      <ActiveReviewContext.Provider value={{ state: { session: { ...snapshot, status: 'success' }, expanded: false, completedAt: null, dismissed: false, connectionLost: false }, controls }}>
        <ActiveSessionInline projectId="p1" sessionId="s1" />
      </ActiveReviewContext.Provider>
    );
    expect(container.querySelector('.active-session-inline')).toBeNull();
  });
});
```

- [ ] **Step 5: Write `StaticReviewForm.test.tsx`**

Create `centinel/src/components/StaticReviewForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StaticReviewForm } from './StaticReviewForm';
import type { Artifact } from '../types';

const artifacts: Artifact[] = [
  { id: 'a1', projectId: 'p1', type: 'requirement', source: 'documents', fileName: 'spec.md', filePath: '/spec.md', originalPath: null, contentHash: 'h1', createdAt: '' },
  { id: 'a2', projectId: 'p1', type: 'source_code', source: 'repository', fileName: 'app.ts', filePath: '/app.ts', originalPath: null, contentHash: 'h2', createdAt: '' },
];

describe('<StaticReviewForm>', () => {
  it('renders artifact selector with all artifacts checked by default', () => {
    render(<StaticReviewForm projectId="p1" artifacts={artifacts} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    for (const cb of checkboxes) expect(cb.checked).toBe(true);
    expect(screen.getByText(/Artifacts to Review \(2\/2\)/)).toBeInTheDocument();
  });

  it('Clear button deselects all artifacts', () => {
    render(<StaticReviewForm projectId="p1" artifacts={artifacts} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('Clear'));
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    for (const cb of checkboxes) expect(cb.checked).toBe(false);
  });

  it('groups artifacts by type', () => {
    render(<StaticReviewForm projectId="p1" artifacts={artifacts} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Requirements')).toBeInTheDocument();
    expect(screen.getByText('Source Code')).toBeInTheDocument();
  });

  it('blocks submission when no artifacts selected', () => {
    const onSubmit = vi.fn();
    render(<StaticReviewForm projectId="p1" artifacts={artifacts} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Sprint 3/i), { target: { value: 'My Review' } });
    fireEvent.click(screen.getByText('Clear'));
    fireEvent.click(screen.getByText('Run Review'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/at least one artifact/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run all frontend tests**

Run: `cd centinel && pnpm test`
Expected: all tests pass (existing SettingsScreen + new tests).

- [ ] **Step 7: Commit**

```bash
git add centinel/src/components/ReviewToast.test.tsx centinel/src/components/ActiveSessionInline.test.tsx centinel/src/components/StaticReviewForm.test.tsx centinel/vite.config.ts centinel/package.json
git commit -m "test(review): add component tests for toast, inline panel, and form

Covers toast rendering states (collapsed, dismissed, new session),
inline panel project-filtering, and the new artifact selector
behavior in StaticReviewForm.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Build + full test verification

**Files:** none modified

- [ ] **Step 1: Sidecar full test suite**

Run: `pnpm --filter @centinel/sidecar test`
Expected: 100% pass. All `staticSessions.test.ts` tests now pass after Gap 2 fix.

- [ ] **Step 2: Frontend full test suite**

Run: `cd centinel && pnpm test`
Expected: 100% pass.

- [ ] **Step 3: Frontend type-check + production build**

Run: `cd centinel && pnpm build`
Expected: builds successfully (produces `dist/` output).

- [ ] **Step 4: Tauri build (full app)**

Run: `cd centinel && pnpm tauri build`
Expected: builds MSI + NSIS bundles without errors. (Skip if no Rust toolchain installed locally — `pnpm build` from Step 3 is sufficient for confidence.)

- [ ] **Step 5: Smoke-check sidecar endpoints**

Start the sidecar:
```bash
pnpm --filter @centinel/sidecar start &
```

Wait ~3 seconds, then:
```bash
curl -s http://localhost:37701/health
curl -s http://localhost:37701/static-sessions/active
```

Expected: `{"status":"ok"}` and `[]` (empty array on fresh DB).

Stop the sidecar:
```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 6: Manual verification checklist**

Open the Tauri app and walk through each item in the spec's "Testing → Manual verification checklist" section (`docs/superpowers/specs/2026-06-22-static-review-toast-design.md`). All 10 items should pass.

- [ ] **Step 7: Final commit (if any small fixups were needed)**

```bash
git add -A
git commit -m "chore: build verification pass + manual smoke-test fixes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

(If no fixups were needed, skip this commit.)

---

## Self-Review

**1. Spec coverage:** All 12 implementation-order steps from the spec map to tasks in this plan:
- Gap 1 → Task 1
- Gap 2 → Task 2
- Gap 3 → Task 3
- Sidecar `listActiveStaticSessions` endpoint → Task 2 (Step 7)
- Frontend `useActiveReview` hook + `ActiveReviewContext` → Task 5
- `<ReviewToast>` + variants → Task 6
- `<ActiveSessionInline>` + complete → Task 7
- Wire `ProjectDetailScreen` → Task 8
- Delete 3 screens + `ReviewProgressView` → Task 9
- Clean up `App.tsx`, `types.ts` → Task 9
- Tests for all of the above → Tasks 2 (Step 4), 10
- Manual verification → Task 11

**2. Placeholder scan:** No "TBD"/"TODO"/"implement later" — every code block is complete. The `// ... unchanged ...` in Task 3 Step 1 is the only shorthand and refers to lines the implementer already has on screen from `StaticReviewForm.tsx` (the `REVIEW_TYPES` array).

**3. Type consistency:** `ActiveReviewSnapshot`, `ActiveReviewState`, `ActiveReviewControls` are defined in Task 5 (Step 1) and consumed unchanged in Tasks 6, 7, 8. The `useActiveReview` hook signature is `{ state, controls }` from Task 5 onward; both `ReviewToast` and `ActiveSessionInline` use `useActiveReviewState()` returning the same shape.

**4. Edge cases addressed:**
- Connection lost (3 consecutive failures) → Task 5 hook sets `connectionLost: true`; Task 6 toast renders Retry button.
- Dismiss + new session → Task 5 hook's per-id dismiss tracking; Task 10 test covers this exact scenario.
- `artifactIds` with all-unknown IDs → Task 2 returns 400 explicitly.
- `reviewType` not in enum → Task 2 returns 400 explicitly.
- Inline panel filters by projectId + sessionId → Task 7 (the `if (session.projectId !== projectId || session.id !== sessionId) return null` guard) and Task 10 (test "does not render for a different project").
- 5-min auto-dismiss after success / 30s after failure/cancelled → Task 5 constants and elapsed check.

**5. Out-of-scope:** Dynamic testing toasts, multiple toasts, toast history, SSE — all explicitly listed in the spec's "Out of Scope" section; not implemented here.
