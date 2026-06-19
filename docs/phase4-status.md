# Phase 4 Status Document

**Last Updated:** 2026-06-19  
**Current State:** Partially Complete (60%)

---

## Overview

Phase 4 focuses on unified reporting and evidence management across both Static and Dynamic testing modules. The work is split into two tracks:

1. **Independent Track** (Done) - Work that doesn't depend on Phase 2
2. **Dependent Track** (Pending) - Work waiting for Phase 2 (Static Testing MVP)

---

## Completed Work ✅

### 1. Unified Report Shell

**File:** `sidecar/src/reportExport.ts`

**Changes:**
- `exportProjectReport()` now returns `{ reportPath: markdown }` instead of just `reportPath`
- Added empty state handling: "No dynamic/static sessions available"
- Both project-level and dynamic session reports return markdown for in-app preview

**API Response:**
```typescript
{
  reportPath: string;  // e.g., "/workspace/reports/centinel-report-2026-06-19T12-00-00.md"
  markdown: string;    // Full markdown content
}
```

**Files Changed:**
- `sidecar/src/reportExport.ts` - Updated `exportProjectReport` return type
- `sidecar/src/index.ts` - Updated API endpoint to return both fields
- `centinel/src/api/client.ts` - Updated TypeScript type

### 2. Evidence Browser

**File:** `centinel/src/screens/EvidenceBrowser.tsx`

**Features:**
- Session list sidebar (left panel)
- Evidence grid with filtering (right panel)
- Filter by type: screenshot, action_trace, ai_request, ai_response, console_log, debug_log, session_summary
- Reuse screenshot modal from dynamic session page
- Safe file reference display

**UI Structure:**
```
┌─────────────────────────────────────────────────┐
│ Evidence Browser                                │
├──────────────┬──────────────────────────────────┤
│ Sessions     │ Session Name    Status           │
│              │ Target: http://...               │
│ ┌──────────┐ │ Summary: ...                     │
│ │ Session1 │ │                                  │
│ │ ✅ done  │ │ [All] [Screenshots] [AI] [Logs]  │
│ ├──────────┤ │                                  │
│ │ Session2 │ │ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│ │ ⏳ run   │ │ │img │ │icon│ │icon│ │icon│    │
│ └──────────┘ │ └────┘ └────┘ └────┘ └────┘    │
│              │ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│              │ │img │ │icon│ │icon│ │icon│    │
│              │ └────┘ └────┘ └────┘ └────┘    │
└──────────────┴──────────────────────────────────┘
```

**Files Created/Modified:**
- `centinel/src/screens/EvidenceBrowser.tsx` - New component
- `centinel/src/App.css` - Added `.evidence-browser-layout`, `.session-list`, `.evidence-grid`, etc.
- `centinel/src/types.ts` - Added `evidence-browser` screen type
- `centinel/src/App.tsx` - Added routing
- `centinel/src/screens/ProjectDetailScreen.tsx` - Added "Evidence Browser" button

### 3. Navigation Integration

**Screen Type:**
```typescript
export type Screen =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'project-detail'; projectId: string }
  | { name: 'dynamic-session'; projectId: string; sessionId: string }
  | { name: 'static-session'; projectId: string; sessionId: string }
  | { name: 'evidence-browser'; projectId: string }  // NEW
  | { name: 'requirements'; projectId: string }
  | { name: 'settings' };
```

**Access Points:**
- Project Detail page → "Evidence Browser" button
- Direct navigation via `onNavigate({ name: 'evidence-browser', projectId })`

---

## Pending Work (Waiting for Phase 2) ⏳

### 1. Static Finding Merge

**Status:** Blocked  
**Depends on:** Phase 2 static review completion

**What needs to happen:**
- Merge static findings into unified findings list
- Ensure `Finding` type is consistent across modules
- Update `listAllFindings()` to include both static and dynamic findings

**Current Finding Type:**
```typescript
export type Finding = {
  id: string;
  projectId: string;
  sessionId: string | null;
  source: 'static' | 'dynamic';
  severity: string;
  title: string;
  description: string;
  status: 'new' | 'accepted' | 'dismissed' | 'fixed';
  createdAt: string;
  artifactId: string | null;
  category: string;
  evidenceText: string;
  recommendation: string;
  confidence: string;
  fromRemarks: boolean;
};
```

### 2. Static Evidence Linking

**Status:** Blocked  
**Depends on:** Phase 2 evidence storage

**What needs to happen:**
- Link static review artifacts to evidence records
- Allow Evidence Browser to show static evidence
- Filter static evidence by session

### 3. Static Session Export Polish

**Status:** Blocked  
**Depends on:** Phase 2 export functionality

**What needs to happen:**
- Ensure static session export returns `{ reportPath, markdown }`
- Add static findings to unified project report
- Preview static reports in-app

### 4. Static Acceptance/Dismiss Workflow

**Status:** Blocked  
**Depends on:** Phase 2 findings UI

**What needs to happen:**
- Verify accept/dismiss buttons work for static findings
- Ensure status changes persist
- Update unified findings list

### 5. Full Unified Report Acceptance Test

**Status:** Blocked  
**Depends on:** Phase 1 + Phase 2 completion

**What needs to happen:**
- Test project report with both static and dynamic sessions
- Verify all sections render correctly
- Confirm file exports work
- Test empty states gracefully

---

## File Inventory

### New Files Created (Phase 4)
| File | Purpose |
|------|---------|
| `centinel/src/screens/EvidenceBrowser.tsx` | Evidence browser component |
| `docs/phase4-status.md` | This document |

### Modified Files (Phase 4)
| File | Changes |
|------|---------|
| `sidecar/src/reportExport.ts` | `exportProjectReport` returns `{ reportPath, markdown }` |
| `sidecar/src/index.ts` | Updated project report endpoint |
| `centinel/src/api/client.ts` | Updated return type |
| `centinel/src/App.css` | Added evidence browser styles |
| `centinel/src/App.tsx` | Added routing and import |
| `centinel/src/types.ts` | Added `evidence-browser` screen type |
| `centinel/src/screens/ProjectDetailScreen.tsx` | Added "Evidence Browser" button |

---

## Testing Checklist

### Independent Track (Can test now)
- [ ] Export project report with only dynamic sessions
- [ ] Confirm report reads well when no static sessions exist
- [ ] Open Evidence Browser from Project Detail
- [ ] Filter evidence by type
- [ ] Click screenshot to open modal
- [ ] Verify modal closes with Escape key
- [ ] Confirm app doesn't crash when static sessions are empty

### Dependent Track (Test after Phase 2)
- [ ] Run one static review
- [ ] Accept/dismiss findings
- [ ] Export static report
- [ ] Export unified project report with both static and dynamic
- [ ] Verify all sections in unified report

---

## Known Issues / Notes

1. **Static sessions empty state** - Currently shows "No static sessions completed" in project report. After Phase 2, this should show actual static session data.

2. **Evidence Browser** - Only shows dynamic evidence. Static evidence integration awaits Phase 2.

3. **Unified findings** - `listAllFindings()` exists but static findings need to be properly linked after Phase 2.

4. **Report preview** - Works for dynamic sessions. Static session report preview needs Phase 2 export support.

---

## Next Steps

1. **Wait for Phase 2 completion** - Static testing MVP
2. **After Phase 2 lands:**
   - Run static review to generate data
   - Test static evidence linking
   - Update Evidence Browser to show static evidence
   - Complete unified report with both modules
   - Run full acceptance test

3. **Optional enhancements:**
   - Add evidence download functionality
   - Add evidence search/filter by date
   - Add batch evidence export

---

## Architecture Notes

### Evidence Flow
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Dynamic    │     │   Static    │     │  Evidence   │
│  Sessions   │     │  Sessions   │     │   Browser   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────┐
│                  Evidence Table                      │
│  (project_id, session_id, type, file_path, summary) │
└─────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────┐
│              /evidence-file endpoint                 │
│  (validates path exists in evidence table)           │
└─────────────────────────────────────────────────────┘
```

### Report Flow
```
┌─────────────┐     ┌─────────────┐
│  Dynamic    │     │   Static    │
│   Report    │     │   Report    │
└──────┬──────┘     └──────┬──────┘
       │                   │
       ▼                   ▼
┌─────────────────────────────────────────────────────┐
│              Project Report                          │
│  (combines both, handles empty states)              │
└─────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────┐
│              Frontend Preview                        │
│  (ReactMarkdown + remark-gfm)                       │
└─────────────────────────────────────────────────────┘
```

---

## Git History

| Commit | Message | Date |
|--------|---------|------|
| `11c19a6` | feat: add evidence browser and unified report shell (Phase 4 partial) | 2026-06-19 |
| `c020809` | feat: complete dynamic testing MVP (Phase 3) | 2026-06-19 |
