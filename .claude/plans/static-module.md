# Static Module Implementation Plan

## Overview
Build the complete Centinel Static testing module — artifact management, 4 review workflows (requirement review, code inspection, traceability, cross-artifact consistency), findings UI, and report export. Users can upload artifacts via file picker or import from a GitHub repo path.

---

## 1. Database Schema Extensions

**File:** `sidecar/src/db.ts`

Add tables to `initSchema()`:

```sql
-- Artifacts uploaded/imported for static review
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'requirement' | 'design' | 'source_code' | 'coding_standard' | 'other'
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,      -- path in workspace/artifacts/
  original_path TEXT,           -- original file path (for repo imports)
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
)

-- Static review sessions
CREATE TABLE IF NOT EXISTS static_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  review_type TEXT NOT NULL,    -- 'requirement_review' | 'code_review' | 'requirement_to_code_traceability' | 'cross_artifact_consistency'
  status TEXT NOT NULL,         -- 'queued' | 'running' | 'success' | 'failure' | 'cancelled'
  config_json TEXT NOT NULL DEFAULT '{}',  -- selected artifact IDs, options
  final_summary TEXT NOT NULL DEFAULT '',
  failure_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
)

-- Link findings to specific artifact sections (for traceability)
ALTER TABLE findings ADD COLUMN artifact_id TEXT;
ALTER TABLE findings ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE findings ADD COLUMN evidence_text TEXT NOT NULL DEFAULT '';
ALTER TABLE findings ADD COLUMN recommendation TEXT NOT NULL DEFAULT '';
ALTER TABLE findings ADD COLUMN confidence TEXT NOT NULL DEFAULT '';
```

Also update `deleteProject` in `projects.ts` to cascade-delete artifacts and static sessions.

---

## 2. Artifact Management (Sidecar)

**New file:** `sidecar/src/artifacts.ts`

Functions:
- `listArtifacts(projectId)` — list all artifacts for a project
- `getArtifact(id)` — get single artifact
- `createArtifact(projectId, type, fileName, filePath, contentHash)` — record an artifact
- `deleteArtifact(id)` — delete artifact and its file
- `importArtifactsFromPath(projectId, repoPath)` — scan a directory recursively for supported file types (.txt, .md, .js, .ts, .py, .java, .cs, .json, .yaml, .yml), copy to workspace, create DB records
- `computeContentHash(filePath)` — SHA-256 hash for dedup
- `readArtifactContent(artifactId)` — read file content for AI prompt

Supported types auto-detection:
- `.txt`, `.md` → `requirement` or `design` (user selects)
- `.js`, `.ts`, `.py`, `.java`, `.cs` → `source_code`
- Other → `other`

**New file:** `sidecar/src/staticReview.ts`

Core review engine:
- `runStaticReview(session, artifacts)` — orchestrates the review
- `buildReviewPrompt(reviewType, artifacts)` — builds the MiniMax prompt
- `parseReviewResponse(raw)` — parses structured JSON from AI
- `saveFindings(projectId, sessionId, findings)` — writes findings to DB

Review prompt design per workflow:
1. **requirement_review** — Analyze requirement doc for unclear, incomplete, ambiguous, unverifiable requirements
2. **code_review** — Analyze source code for defects, maintainability issues, missing validation, risky logic
3. **requirement_to_code_traceability** — Map requirements to code implementations, identify gaps
4. **cross_artifact_consistency** — Compare requirement vs design/code for terminology mismatches, missing entities, conflicting behavior

Expected AI output format (JSON array):
```json
[{
  "title": "string",
  "severity": "critical|high|medium|low|info",
  "category": "string",
  "artifactReference": "string",
  "description": "string",
  "evidence": "string",
  "recommendation": "string",
  "confidence": "high|medium|low"
}]
```

---

## 3. Static Session Management (Sidecar)

**New file:** `sidecar/src/staticSessions.ts`

Functions (mirror `dynamicSessions.ts` pattern):
- `createStaticSession(projectId, name, reviewType, configJson)` — create session record
- `listStaticSessions(projectId)` — list sessions for a project
- `getStaticSession(projectId, sessionId)` — get single session
- `updateStaticSessionStatus(sessionId, status, summary, failureReason)` — update status
- `listStaticFindings(projectId, sessionId)` — get findings for a session
- `getActiveStaticSession(projectId)` — check for running session (prevent concurrent runs)

---

## 4. API Routes (Sidecar)

**File:** `sidecar/src/index.ts`

Add routes:

```
GET    /projects/:id/artifacts                    — list artifacts
POST   /projects/:id/artifacts                    — upload artifact (file content in body)
POST   /projects/:id/artifacts/import-repo        — import from repo path
DELETE /projects/:id/artifacts/:artifactId        — delete artifact

GET    /projects/:id/static-sessions              — list static sessions
POST   /projects/:id/static-sessions              — create & run static review
GET    /projects/:id/static-sessions/:sid         — get session detail
GET    /projects/:id/static-sessions/:sid/findings — get findings
POST   /projects/:id/static-sessions/:sid/cancel  — cancel running session

GET    /projects/:id/findings                     — all findings for project (static + dynamic)
```

Static session creation validates:
- At least one artifact selected
- Review type is valid
- No other static session is currently running
- Text AI provider is configured

---

## 5. Frontend Types

**File:** `centinel/src/types.ts`

Add:
```ts
export type ArtifactType = 'requirement' | 'design' | 'source_code' | 'coding_standard' | 'other';

export type Artifact = {
  id: string;
  projectId: string;
  type: ArtifactType;
  fileName: string;
  filePath: string;
  originalPath: string | null;
  contentHash: string;
  createdAt: string;
};

export type ReviewType = 'requirement_review' | 'code_review' | 'requirement_to_code_traceability' | 'cross_artifact_consistency';

export type StaticSessionStatus = 'queued' | 'running' | 'success' | 'failure' | 'cancelled';

export type StaticSession = {
  id: string;
  projectId: string;
  name: string;
  reviewType: ReviewType;
  status: StaticSessionStatus;
  configJson: string;
  finalSummary: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
};

export type Finding = {
  id: string;
  projectId: string;
  sessionId: string | null;
  source: 'static' | 'dynamic';
  severity: string;
  title: string;
  description: string;
  category: string;
  evidenceText: string;
  recommendation: string;
  confidence: string;
  status: 'new' | 'accepted' | 'dismissed' | 'fixed';
  artifactId: string | null;
  createdAt: string;
};

// Update Screen type to include static screens
export type Screen =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'project-detail'; projectId: string }
  | { name: 'dynamic-session'; projectId: string; sessionId: string }
  | { name: 'static-session'; projectId: string; sessionId: string }
  | { name: 'settings' };
```

---

## 6. Frontend API Client

**File:** `centinel/src/api/client.ts`

Add methods:
```ts
// Artifacts
listArtifacts: (projectId) => GET /projects/:id/artifacts
uploadArtifact: (projectId, type, fileName, content) => POST (multipart or base64)
importRepoArtifacts: (projectId, repoPath) => POST /projects/:id/artifacts/import-repo
deleteArtifact: (projectId, artifactId) => DELETE

// Static Sessions
listStaticSessions: (projectId) => GET
createStaticSession: (projectId, {name, reviewType, artifactIds}) => POST
getStaticSession: (projectId, sessionId) => GET
listStaticFindings: (projectId, sessionId) => GET
cancelStaticSession: (projectId, sessionId) => POST

// Unified findings
listFindings: (projectId) => GET /projects/:id/findings
updateFinding: (projectId, findingId, {status}) => PUT
```

---

## 7. Frontend Screens

### 7a. ArtifactsPanel (component in ProjectDetailScreen)
- List artifacts with type badge, file name, date
- "Upload File" button → Tauri file dialog (multi-select)
- "Import from Repo" button → text input for local path
- Delete button per artifact
- Type selector when uploading (auto-detected but user can change)

### 7b. StaticReviewForm (component)
- Review type dropdown (4 options)
- Artifact multi-select checkboxes (filtered by compatible types per workflow)
- Session name input
- "Run Review" button
- Shows which artifacts are required per review type:
  - requirement_review → needs requirement/design artifacts
  - code_review → needs source_code artifacts
  - requirement_to_code_traceability → needs requirement + source_code
  - cross_artifact_consistency → needs any 2+ artifacts of different types

### 7c. StaticSessionScreen (new screen)
- Session info (review type, status, timestamps)
- Summary section
- Findings table with severity badge, title, category, status
- Finding detail expandable row (description, evidence, recommendation, confidence)
- Accept/Dismiss buttons per finding
- Cancel button if running
- Polling while running (like DynamicSessionScreen)

### 7d. FindingsPanel (component in ProjectDetailScreen)
- Unified findings list (static + dynamic)
- Filter by source (static/dynamic), severity, status
- Click to expand detail
- Status update (accept/dismiss/fix)

### 7e. Update ProjectDetailScreen
- Replace "Static Review — No reviews yet" placeholder with:
  - ArtifactsPanel
  - StaticReviewForm
  - Static sessions list
- Replace "Findings — No findings yet" with FindingsPanel

---

## 8. Report Export

**New file:** `sidecar/src/reportExport.ts`

- `exportProjectReport(projectId)` — generates Markdown report
- `exportSessionReport(projectId, sessionId)` — session-level report

Report structure:
```
# Centinel QA Report — [Project Name]
## Project Info
## Static Review Sessions
  ### [Session Name] — [Status]
  #### Findings
  | # | Severity | Title | Category | Status |
  #### Finding Details
  [Each finding with description, evidence, recommendation]
## Dynamic Test Sessions
  [Summary]
## Unified Findings Summary
  [Table with all findings, counts by severity]
## Evidence References
```

Export to workspace/reports/ folder. User can open or download.

---

## 9. File Changes Summary

### New files (sidecar):
- `sidecar/src/artifacts.ts` — artifact CRUD + repo import
- `sidecar/src/staticSessions.ts` — static session CRUD
- `sidecar/src/staticReview.ts` — review engine + AI prompts
- `sidecar/src/reportExport.ts` — report generation

### Modified files (sidecar):
- `sidecar/src/db.ts` — add artifact, static_sessions tables; extend findings schema
- `sidecar/src/index.ts` — add artifact + static session + report routes
- `sidecar/src/projects.ts` — cascade delete artifacts/static sessions

### New files (frontend):
- `centinel/src/screens/StaticSessionScreen.tsx` — session detail + findings
- `centinel/src/components/ArtifactsPanel.tsx` — artifact upload/import/list
- `centinel/src/components/StaticReviewForm.tsx` — review config form
- `centinel/src/components/FindingsPanel.tsx` — unified findings list

### Modified files (frontend):
- `centinel/src/types.ts` — add Artifact, StaticSession, Finding, updated Screen
- `centinel/src/api/client.ts` — add static module API methods
- `centinel/src/App.tsx` — add static-session screen route
- `centinel/src/components/AppShell.tsx` — no change needed (project-detail already active)
- `centinel/src/screens/ProjectDetailScreen.tsx` — integrate ArtifactsPanel, StaticReviewForm, FindingsPanel, static sessions list
- `centinel/src/App.css` — add styles for new components

---

## 10. Implementation Order

1. **DB schema** — extend `db.ts` with new tables
2. **Artifacts backend** — `artifacts.ts` + routes in `index.ts`
3. **Static sessions backend** — `staticSessions.ts` + routes
4. **Review engine** — `staticReview.ts` with prompts + AI integration
5. **Report export** — `reportExport.ts` + route
6. **Frontend types** — update `types.ts`
7. **API client** — add methods to `client.ts`
8. **ArtifactsPanel** — upload, import, list, delete
9. **StaticReviewForm** — review configuration
10. **StaticSessionScreen** — session detail + findings
11. **FindingsPanel** — unified findings
12. **ProjectDetailScreen** — integrate all components
13. **CSS** — styles for new components
14. **Polish** — error handling, loading states, empty states
