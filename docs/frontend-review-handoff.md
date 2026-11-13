# Review and accessibility frontend increment

Owned files are src/ReviewTools.tsx, src/AccessibilityTools.tsx, their routing entries in AdvancedTools.tsx, associated CSS and tests/browser-review.cjs, tests/browser-accessibility.cjs. Existing frontend preserved. Root handles elevated browser commands and service restarts.

ReviewTools exposes native comment add/reply/edit/resolve/reopen/delete, filtering, jump-to-page, summary/JSON export and quoted reply context. Parent deletion is disabled while replies exist. Mutations create document revisions and retain app undo. Measurements accept explicit unrotated PDF coordinate pairs, scale/unit/label, distance/perimeter/area, persisted list and CSV export. Area units already contain the square symbol from the backend. Blank coordinates are rejected locally.

AccessibilityTools exposes partial automated inspection and explicit manual-review needs, document title/language edits, recursive structure selection, role/Alt/ActualText/language edits, sibling reorder and JSON report download. It does not claim conformance or create structure tags for untagged documents. Reordering mixed content references remains restricted by backend validation.

Compare view displays pageMoves and mode-appropriate empty results. Signature browser test now waits for app readiness and reports startup failures; browser closes in finally. Root confirmed signature test passed. Initial missing default export was a transient development-server module state during writes; current source exports default and production build passes.

Latest npm run build passed after all above files. Browser-review and browser-accessibility require root's elevated test run against port 4320 and latest server at 8765. They check persisted data through normal UI and reload API. Full product remains incomplete and no release claim is warranted.
