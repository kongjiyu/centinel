# Centinel Static Module — Test Cases

> **Module:** Centinel Static (Static Testing Module)
> **Framework:** Vitest 4.x
> **Last Updated:** 2026-06-02
> **Total Tests:** 85 (all passing)

---

## 1. Test Infrastructure

### 1.1 Framework

- **Test Runner:** Vitest 4.1.8
- **Environment:** Node.js (in-memory SQLite via sql.js)
- **Mocking:** Vitest built-in `vi.mock()` and `vi.spyOn()`
- **Config:** `sidecar/vitest.config.ts`

### 1.2 Directory Structure

```
sidecar/
├── __tests__/
│   ├── helpers/
│   │   └── testHelpers.ts          # Shared test utilities
│   ├── unit/
│   │   ├── artifacts.test.ts       # Artifact management tests
│   │   ├── staticSessions.test.ts  # Static session & finding tests
│   │   ├── staticReview.test.ts    # AI review engine tests
│   │   └── reportExport.test.ts    # Report generation tests
│   └── integration/
│       └── api.test.ts             # HTTP API route tests
└── vitest.config.ts
```

### 1.3 Running Tests

```bash
cd sidecar
pnpm test          # Run all tests once
pnpm test:watch    # Run in watch mode
npx vitest run __tests__/unit/artifacts.test.ts   # Run specific file
```

### 1.4 Test Helper Utilities

**File:** `__tests__/helpers/testHelpers.ts`

| Helper | Purpose |
|---|---|
| `createTestDb()` | Creates an in-memory SQLite database with full schema |
| `getTestDb()` | Returns the current test database instance |
| `closeTestDb()` | Closes and disposes the test database |
| `insertTestProject(db, id, workspacePath)` | Seeds a project record |
| `insertTestArtifact(db, id, projectId, type, fileName, filePath)` | Seeds an artifact record |
| `insertTestStaticSession(db, id, projectId, status)` | Seeds a static session record |
| `insertTestFinding(db, id, projectId, sessionId)` | Seeds a finding record |

The test database is injected into the application via `setTestDb(db)` from `src/db.ts`, which bypasses file I/O and disables `saveDb()` during tests.

---

## 2. Unit Tests — Artifacts (`artifacts.test.ts`)

**Module:** `src/artifacts.ts`
**Test Count:** 14

### 2.1 `computeContentHash`

| ID | Test Case | Input | Expected Result |
|---|---|---|---|
| ART-01 | Should return consistent SHA-256 hash for same file | File with content "hello world" | Same hash on repeated calls, matches `/^[a-f0-9]{64}$/` |
| ART-02 | Should return different hash for different content | Two files with "hello" and "world" | Different hashes |
| ART-03 | Should hash empty file correctly | Empty file | SHA-256 of empty string: `e3b0c44298fc1c...` |

### 2.2 `detectArtifactType`

| ID | Test Case | Input | Expected Type |
|---|---|---|---|
| ART-04 | Detect requirement types | `requirements.txt`, `spec.md` | `requirement` |
| ART-05 | Detect source code types | `.js`, `.ts`, `.py`, `.java`, `.cs`, `.tsx`, `.jsx`, `.css`, `.html`, `.go`, `.rb`, `.rs`, `.cpp`, `.c`, `.h` | `source_code` |
| ART-06 | Detect other types for data files | `.json`, `.yaml`, `.yml` | `other` |
| ART-07 | Return other for unknown extensions | `.png`, `.rst`, `.xml` | `other` |
| ART-08 | Handle case insensitivity | `README.MD`, `APP.JS` | Correct types |

### 2.3 `listArtifacts`

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| ART-09 | Return empty array when no artifacts | No artifacts in DB | `[]` |
| ART-10 | Return artifacts ordered by created_at DESC | Two artifacts with different timestamps | Later artifact first |
| ART-11 | Not return artifacts from other projects | Artifacts in proj-1 and proj-2 | Only proj-1 artifacts returned |
| ART-12 | Map all fields correctly | Artifact with all fields set | All fields match input |

### 2.4 `getArtifact`

| ID | Test Case | Input | Expected Result |
|---|---|---|---|
| ART-13 | Return artifact by id | Existing artifact | Full artifact object |
| ART-14 | Return null for non-existent artifact | Non-existent id | `null` |

### 2.5 `deleteArtifact`

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| ART-15 | Delete artifact and remove file from disk | Artifact with file on disk | `true`, file removed, DB record gone |
| ART-16 | Return false for non-existent artifact | Non-existent id | `false` |
| ART-17 | Succeed even if file does not exist on disk | Artifact in DB but no file | `true` |

### 2.6 `readArtifactContent`

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| ART-18 | Read file content as utf-8 | File with "Hello, World!" | `"Hello, World!"` |
| ART-19 | Throw for non-existent artifact | Non-existent id | Throws "Artifact not found" |
| ART-20 | Read multi-line content preserving formatting | Markdown file with headers and lists | Exact content preserved |

---

## 3. Unit Tests — Static Sessions (`staticSessions.test.ts`)

**Module:** `src/staticSessions.ts`
**Test Count:** 26

### 3.1 `createStaticSession`

| ID | Test Case | Input | Expected Result |
|---|---|---|---|
| SS-01 | Create session with correct fields | Name, reviewType, configJson | All fields match, status = `queued` |
| SS-02 | Persist to database | Create then retrieve | Retrieved session matches |
| SS-03 | Support all review types | All 4 review types | Each created successfully |

### 3.2 `listStaticSessions`

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| SS-04 | Return empty array when none exist | No sessions | `[]` |
| SS-05 | Return sessions ordered by created_at DESC | Two sessions | Later session first |
| SS-06 | Not return sessions from other projects | Sessions in proj-1 and proj-2 | Only proj-1 returned |

### 3.3 `getStaticSession`

| ID | Test Case | Input | Expected Result |
|---|---|---|---|
| SS-07 | Return session by project and session id | Valid ids | Full session object |
| SS-08 | Return null for non-existent session | Non-existent id | `null` |
| SS-09 | Return null for wrong project | Session exists but under different project | `null` |

### 3.4 `getActiveStaticSession`

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| SS-10 | Return queued session | Session with status `queued` | Session returned |
| SS-11 | Return running session | Session with status `running` | Session returned |
| SS-12 | Return null when no active session | Session with status `success` | `null` |
| SS-13 | Return null for cancelled sessions | Session with status `cancelled` | `null` |

### 3.5 `updateStaticSessionStatus`

| ID | Test Case | Input | Expected Result |
|---|---|---|---|
| SS-14 | Update to success with summary | Status `success`, summary "All done" | Status and summary updated |
| SS-15 | Update to failure with reason | Status `failure`, reason "API error" | Status and failureReason updated |
| SS-16 | Update the updated_at timestamp | Any status change | `updatedAt` changes |

### 3.6 `createFinding`

| ID | Test Case | Input | Expected Result |
|---|---|---|---|
| SS-17 | Create finding with all fields | All finding fields | All fields match, status = `new`, source = `static` |
| SS-18 | Create finding with optional artifactId | Finding with artifactId | `artifactId` set correctly |
| SS-19 | Persist to database | Create then list | Finding appears in list |

### 3.7 `listStaticFindings`

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| SS-20 | Return findings for specific session | Findings in two sessions | Only matching session's findings |
| SS-21 | Return empty array when none exist | No findings | `[]` |

### 3.8 `listAllFindings`

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| SS-22 | Return all findings across sessions | Findings in two sessions | Both returned |
| SS-23 | Not return findings from other projects | Findings in proj-1 and proj-2 | Only proj-1 returned |

### 3.9 `updateFindingStatus`

| ID | Test Case | Input | Expected Result |
|---|---|---|---|
| SS-24 | Update to accepted | Status `accepted` | Finding status updated |
| SS-25 | Update to dismissed | Status `dismissed` | Finding status updated |
| SS-26 | Update to fixed | Status `fixed` | Finding status updated |

---

## 4. Unit Tests — Static Review Engine (`staticReview.test.ts`)

**Module:** `src/staticReview.ts`
**Test Count:** 11
**Mocking:** `fetch`, `getRawAiSetting`, `readArtifactContent`, `updateStaticSessionStatus`, `createFinding`

### 4.1 Review Execution Flow

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| SR-01 | Call updateStaticSessionStatus to running at start | Mock AI fails | `updateStaticSessionStatus` called with `'running'` |
| SR-02 | Fail when text AI provider not configured | `getRawAiSetting` returns `null` | Throws "Text AI provider not configured" |
| SR-03 | Fail when API key is missing | `apiKey` is empty string | Throws "API key not configured" |
| SR-04 | Fail when no artifacts can be read | All artifacts throw on read | Throws "No artifacts could be read" |

### 4.2 AI Response Processing

| ID | Test Case | AI Response | Expected Result |
|---|---|---|---|
| SR-05 | Process findings from AI response | 2 findings in JSON array | `createFinding` called twice, summary says "2 finding(s)" |
| SR-06 | Handle AI returning empty array | `[]` | `createFinding` not called, summary says "0 finding(s)" |
| SR-07 | Handle response wrapped in markdown code block | `` ```json\n[...]\n``` `` | Findings parsed correctly |

### 4.3 Input Validation

| ID | Test Case | Input | Expected Result |
|---|---|---|---|
| SR-08 | Validate and normalize invalid severity | severity=`"INVALID"`, confidence=`"INVALID"` | Normalized to `"medium"` |

### 4.4 Compatibility Modes

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| SR-09 | Handle OpenAI compatibility mode | `compatibilityMode: 'openai'` | Correct request format (system message in messages array) |

### 4.5 Error Handling

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| SR-10 | Handle AI API HTTP error | HTTP 429 response | Throws "AI API error", session marked as failure |
| SR-11 | Truncate very large artifact content | 60,000 character content | Content truncated with `[... truncated ...]` marker |

---

## 5. Unit Tests — Report Export (`reportExport.test.ts`)

**Module:** `src/reportExport.ts`
**Test Count:** 11
**Mocking:** `dynamicSessions` module (returns empty arrays)

### 5.1 `exportProjectReport`

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| RE-01 | Generate report file in workspace/reports/ | Empty project | File exists, ends with `.md`, contains header |
| RE-02 | Include summary table with zero findings | No sessions | Contains `| Total Findings | 0 |` |
| RE-03 | Include static session findings | 2 findings (critical + medium) | Severity counts, finding titles present |
| RE-04 | Include finding details with evidence | Finding with evidence + recommendation | Evidence block and recommendation text present |
| RE-05 | Handle project with no sessions | No sessions | Contains "No static review sessions completed" |
| RE-06 | Throw for non-existent project | Invalid project id | Throws "Project not found" |

### 5.2 `exportSessionReport`

| ID | Test Case | Setup | Expected Result |
|---|---|---|---|
| RE-07 | Generate session-level report | Session with 1 finding | File exists, contains session name, project name, finding |
| RE-08 | Handle session with no findings | Session, no findings | Contains "No findings generated" |
| RE-09 | Throw for non-existent session | Invalid session id | Throws "Session not found" |
| RE-10 | Throw for non-existent project | Invalid project id | Throws "Project not found" |
| RE-11 | Sort findings by severity | 3 findings (low, critical, medium) | Critical appears before medium, medium before low |

---

## 6. Integration Tests — API Routes (`api.test.ts`)

**Module:** `src/index.ts` (HTTP server)
**Test Count:** 23
**Setup:** In-memory test database, HTTP server on random port per test
**Mocking:** `aiClient`, `staticReview`, `dynamicRunner`, `dynamicSessions`

### 6.1 Health

| ID | Test Case | Request | Expected Result |
|---|---|---|---|
| API-01 | Health endpoint returns ok | `GET /health` | 200, `{ status: "ok" }` |

### 6.2 Projects

| ID | Test Case | Request | Expected Result |
|---|---|---|---|
| API-02 | List projects | `GET /projects` | 200, array with seeded project |
| API-03 | Create project | `POST /projects` | 201, project object returned |

### 6.3 Artifacts

| ID | Test Case | Request | Expected Result |
|---|---|---|---|
| API-04 | List artifacts | `GET /projects/:id/artifacts` | 200, empty array |
| API-05 | Upload artifact | `POST /projects/:id/artifacts` with base64 content | 201, artifact with correct type |
| API-06 | Auto-detect artifact type | Upload `.ts` file without explicit type | 201, type = `source_code` |
| API-07 | Delete artifact | `DELETE /projects/:id/artifacts/:aid` | 200, artifact removed from list |
| API-08 | Delete non-existent artifact | `DELETE` with invalid id | 404 |

### 6.4 Static Sessions

| ID | Test Case | Request | Expected Result |
|---|---|---|---|
| API-09 | List static sessions | `GET /projects/:id/static-sessions` | 200, empty array |
| API-10 | Create static session | `POST` with name, reviewType, artifactIds | 201, session with status `queued` |
| API-11 | Get static session | `GET /projects/:id/static-sessions/:sid` | 200, session object |
| API-12 | Get non-existent session | `GET` with invalid sid | 404 |
| API-13 | List session findings | `GET .../static-sessions/:sid/findings` | 200, empty array |

### 6.5 Findings

| ID | Test Case | Request | Expected Result |
|---|---|---|---|
| API-14 | List all findings | `GET /projects/:id/findings` | 200, array |
| API-15 | Update finding status | `PUT /projects/:id/findings/:fid` with `status: "accepted"` | 200, status updated in DB |
| API-16 | Reject invalid status | `PUT` with `status: "INVALID"` | 400, error message |

### 6.6 Reports

| ID | Test Case | Request | Expected Result |
|---|---|---|---|
| API-17 | Export project report | `POST /projects/:id/reports/export` | 200, `reportPath` exists on disk |

---

## 7. Test Coverage Summary

| Module | File | Tests | Functions Covered |
|---|---|---|---|
| Artifacts | `artifacts.ts` | 14 | `computeContentHash`, `detectArtifactType`, `listArtifacts`, `getArtifact`, `deleteArtifact`, `readArtifactContent` |
| Static Sessions | `staticSessions.ts` | 26 | `createStaticSession`, `listStaticSessions`, `getStaticSession`, `getActiveStaticSession`, `updateStaticSessionStatus`, `createFinding`, `listStaticFindings`, `listAllFindings`, `updateFindingStatus` |
| Review Engine | `staticReview.ts` | 11 | `runStaticReview` (covers AI call, prompt building, JSON parsing, validation, error handling) |
| Report Export | `reportExport.ts` | 11 | `exportProjectReport`, `exportSessionReport` |
| API Routes | `index.ts` | 23 | All 17 HTTP endpoints |
| **Total** | | **85** | |

---

## 8. Not Covered (Out of Scope)

The following are intentionally not covered by automated tests:

| Area | Reason |
|---|---|
| Frontend React components | Requires `@testing-library/react` + `jsdom` setup; components are thin UI wrappers over the API client |
| `importArtifactsFromRepo` | Requires filesystem mocking; covered by manual smoke test |
| `initSyncDb` | Sidecar startup initialization; tested implicitly via integration tests |
| Real AI API calls | Mocked in tests; integration with MiniMax/MiMo tested via smoke scripts |
| Tauri IPC layer | Requires Tauri runtime; tested via manual `tauri dev` |

---

## 9. Adding New Tests

### Pattern for Unit Tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, closeTestDb, insertTestProject } from '../helpers/testHelpers';
import { setTestDb, clearTestDb } from '../../src/db';
import { myFunction } from '../../src/myModule';

describe('myModule', () => {
  beforeEach(async () => {
    const db = await createTestDb();
    setTestDb(db);
    insertTestProject(db, 'proj-1');
  });

  afterEach(() => {
    clearTestDb();
    closeTestDb();
  });

  it('should do something', async () => {
    const result = await myFunction('proj-1');
    expect(result).toBeDefined();
  });
});
```

### Pattern for Mocking External Dependencies

```typescript
vi.mock('../../src/settings.js', () => ({
  getRawAiSetting: vi.fn(),
}));

import { getRawAiSetting } from '../../src/settings';

// In test:
vi.mocked(getRawAiSetting).mockResolvedValue({ apiKey: 'test', ... });
```
