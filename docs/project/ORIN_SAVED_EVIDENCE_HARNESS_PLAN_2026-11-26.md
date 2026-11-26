# ORIN saved evidence harness plan

Agreed 26 November 2026. The [conversation UI plan](./ORIN_CONVERSATION_UI_IMPLEMENTATION_PLAN_2026-11-26.md) covers the rendered cards, tables, and project entry. This plan covers the evidence those views and ORIN answers consume.

## Reference and retrieval

1. Carry a Check ID and a one-line focus in ordinary recall. Retrieve the saved details when a follow-up needs them. If multiple Checks fit and the current or immediately preceding reference does not resolve the ambiguity, present choices with the latest match recommended.
2. Resolve an explicit `@` before the model call. Bind it to the authorized Check or Problem that the user selected. Load the saved record, current Problem status where applicable, and evidence relevant to the question. Reuse the same resolved identity for the card and the explanation. Load large artifacts such as full replays and long logs when the user opens them or the question needs them.
3. For a Problem, load the original saved occurrence and its frozen evidence. Load current status separately from the authoritative project record, including Resolved. Label unavailable evidence or status when a lookup cannot establish it. Keep the original evidence attached when showing current status.

## Evidence semantics

- Use the established result measurements for each saved Check mode. Keep Code problems, Browser-proven problems, and individual failed Browser assertions distinct. Show recorded objective and scope when available. Omit a missing objective on the card and answer **Objective unavailable** when asked. Distinguish planned from executed scope when the evidence differs.
- Use logical product areas for **Module**. Prefer documented names. If the supplied source clearly establishes an area, present it as **Inferred** and support it with the exact affected files. When the evidence identifies files only, show **Affected files**. Preserve relevant omissions when the evidence passed to the model covers only part of the Check.

## Acceptance checks

- Select an older Check via `@` after a newer Check exists. Confirm that the older record resolves before the model call, that the card and answer use the same identity, and that a large replay stays unloaded until needed.
- Explain an older Problem now marked Resolved. The original excerpt and recommendation stay visible alongside its current status. Missing original excerpts and unavailable current status get their own states.
- Verify Code, Browser, and combined measurements, including unavailable versus zero and a Check with no saved objective. Verify documented modules, clearly inferred modules, and file-only evidence with long paths.
- Confirm that an ordinary follow-up carries the lightweight reference, ambiguous references present choices, and failed or unauthorized reference resolution returns a safe unavailable state.

Durable conversation memory and compaction remain deferred. The system prompt guidance is in place. The retrieval and rendering work is pending.
