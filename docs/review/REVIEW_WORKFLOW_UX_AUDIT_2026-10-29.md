# Review workflow: current experience assessment

Date: 29 October 2026. Read-only audit of the running Windows desktop app.
Evidence: current-run screenshots, inspected again from saved PNG files, and implementation inspection. Screenshot encoding was normalized from JPEG to PNG without cropping or changing the layout.
Related proposal: [workflow UX specification](REVIEW_WORKFLOW_UX_SPEC_2026-10-29.md).

## Outcome

The captured experience makes users scan source inventories and execution metadata before they can understand the next task. This conflicts with the user's action-first handover goal. The largest issue is structural: the amount of visible interface grows with the number of files.

The visual system has useful foundations: stable navigation, labelled controls, neutral surfaces, text statuses, named stages and saved evidence. The redesign should retain these and change the hierarchy and scale behavior.

## 1. Entry: needs substantial change

![Entry at its initial scroll position](../../evidence/review-ux-audit-2026-10-29/01-entry-verified.png)
![Entry source list](../../evidence/review-ux-audit-2026-10-29/02-entry-scope-verified.png)

Observed CargoChain scope: 287 selected items. The name/project section and large introductory panel occupy most of the initial viewport. Source selection precedes the objective. Individual repository files are mixed with attached documents in a long Artifacts list; duplicate basenames are distinguishable mainly through truncated technical paths.

- Developer impact: choosing a repository requires understanding hundreds of file rows rather than selecting the repository as a unit. Goal entry and submission are separated by the inventory.
- Handover impact: the setup does not foreground the intended decision or communicate scope at a useful product level.
- Act on: replace file-level entry selection with compact repository/document selection and the agreed defaults. Place the goal before detailed scope content. Contain large repository/document lists.
- Accessibility risk: hundreds of independently selectable items create a large navigation burden. Full keyboard traversal and screen-reader behavior were not tested. Visible field labels and textual selection states are strengths.

## 2. Activity: useful stages, insufficient recovery guidance

![Activity initial view](../../evidence/review-ux-audit-2026-10-29/04-activity-verified.png)
![Activity stages after scrolling](../../evidence/review-ux-audit-2026-10-29/05-activity-blocker-verified.png)

Observed a saved failed Review, not a live running assessment. Activity uses understandable stage names, durations and a linked business-requirement finding. It honestly labels later stages Not reached. However, users must read the narrative to understand what matters. The failed-stage explanation says the Review needs attention without a specific local recovery action. The accessibility text also exposes the technical terminal cause `assessment_paused`.

- Developer impact: the timeline records what happened but does not give a compact diagnosis and task to perform next.
- Handover impact: stage completion can be confused with completed product assessment unless overall insufficiency remains prominent.
- Act on: lead with a short execution outcome/current-task summary and a specific supported next action. Keep recorded stage detail expandable. Translate terminal causes into plain language without offering actions the service cannot execute.
- Accessibility risk: repetitive stage narrative increases reading/navigation effort. Live announcements, cancellation, focus behavior and real-time updates were not tested.

## 3. Overview: decision support is below metrics

![Overview initial view](../../evidence/review-ux-audit-2026-10-29/03-overview-verified.png)
![Overview summary below the initial viewport](../../evidence/review-ux-audit-2026-10-29/06-overview-sources-verified.png)

The first result screen shows Failed, Retry review, metrics and a Decision column. The next action appears after the objective and is generic: address the issue above and retry. The narrow summary column wraps heavily while the adjacent Decision column retains substantial blank space. The initial metrics show zero traceability attention, 285 sources in scope and one finding. Those numbers alone do not explain the failed assessment or the unverified scope described in the objective.

- Developer impact: opening the Review does not immediately answer which problem to address or what completion requires.
- Handover impact: zero traceability attention can be misread as assurance when the Review failed and important coverage is unverified. This is a presentation risk, not a claim that the persisted counts are incorrect.
- Act on: use the agreed report hierarchy: up to three specific actions, scoped recommendation/reasons, findings and feature/requirement coverage. Keep execution status, human approval and recommendation distinct. Reflow reading columns before they become this narrow.
- Accessibility risk: dense wrapping reduces readability at the captured width. No contrast measurements, zoom or assistive-technology compliance checks were performed.

## 4. Reviewed sources: severe scale and information-priority problem

![Overview source cards](../../evidence/review-ux-audit-2026-10-29/07-source-cards-verified.png)

The saved failed Review displays 285 reviewed artifacts as an unbounded sequence of individual cards. At this width, about two complete cards fit in the visible source area. Paths, UUIDs and hashes wrap into many lines. Developer tools and historical identifiers receive space comparable to the file name and preview action. The code maps the entire artifact inventory and its list CSS has no height bound or pagination.

- Developer impact: locating a file requires scanning repeated cards; repository hierarchy is absent from this presentation.
- Handover impact: the large inventory dominates the report, and “reviewed artifacts” risks implying semantic assessment of every scoped file despite the failed execution.
- Act on: default to a compact scope summary and open grouped, searchable directories in a bounded source browser. Describe scope as included/saved sources unless recorded evidence establishes assessment. Put hashes/version identifiers in optional details.
- Accessibility risk: wrapped hashes and paths generate long repetitive content. Repeated preview controls need reliable file context for assistive technology; no screen-reader test was performed.

## Coverage and limitations

| Feature | Acceptance criteria | Status | Risk flags |
| --- | --- | --- | --- |
| Entry | Actual large-source entry captured; scale and goal placement assessed. | Observed | One project, one window size; selection was not changed. |
| Activity | Saved stages and failed-state explanation captured. | Observed | No live Review started; running, paused and cancellation behavior unverified. |
| Overview | Initial hierarchy, summary and source inventory captured. | Observed | Failed execution only; ready/approval states not audited. |
| Sources | Current list layout and implementation inspected. | Observed | No saved file opened; preview authorization/integrity behavior not retested. |
| Accessibility/responsiveness | Keyboard, screen reader, zoom, contrast and required desktop sizes. | Not verified | Captures are 902x731 outer-window images; not release acceptance evidence. |

No Review was started, retried or resumed. No source selection, persisted finding decision, provider setting or application code was changed. Existing local changes were preserved.

## Next design decision

Resolved action order: confirmed handover blockers, remaining risks, then evidence gaps. Important evidence gaps still prevent an unsupported ready recommendation. Complete evidence capability assessment and reconcile exact layouts before confirming the specification for implementation.

## Added scope: Project Sources navigation

The user requested removal of the bottom Source updates panel, automatic minute-cadence connected-source checks and per-source manual Sync controls. These are recorded in the specification, not implemented. Source indexing holds remain separate and were not resumed.

Current-run observation followed CargoChain repository -> docs directory -> Architecture.md. The directory table is replaced by a file-tree/reader composition. At the captured narrow width, the file reader becomes much narrower and the new tree shows earlier expanded paths while the selected docs file is below its visible scroll region. The source path survives in breadcrumbs, but the visual navigation surface and content geometry change abruptly. This substantiates the user's loss-of-context report without claiming that all navigation state is absent.

![Project Sources nested directory](../../evidence/review-ux-audit-2026-10-29/09-project-directory-verified.png)
![Project Sources file-reader layout](../../evidence/review-ux-audit-2026-10-29/10-project-file-verified.png)

User-confirmed direction: retain a persistent source/repository navigation area before and after file selection, and update only the content area. Preserve project/source identity, folder expansion, selected file, search and independent scroll positions. Reveal the selected item in the tree when opening it from directory/search results without discarding unrelated remembered navigation state. Switching sources should preserve each source's own last location. Use an explicit drawer at narrow widths rather than an implicit unrelated page composition. This direction is recorded in the draft specification; it has not been implemented or verified.

Code inspection also found a five-minute GitHub reconciliation interval and fifteen-minute Slack interval; equivalent periodic Drive behavior was not established. Extending the automatic cadence requires provider-aware implementation, durable-worker deduplication and preservation of pause/capacity holds. Automatic import must not be presented as completed model-backed indexing or assessment.

Limits: the separate bottom updates panel was confirmed in code, not captured in this pass. This pass did not trigger Sync, test source switching/Back across sources, or test keyboard navigation. The saved file was opened read-only. Screenshot files were reopened after lossless PNG normalization for verification.
