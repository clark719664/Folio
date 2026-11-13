# Review and accessibility frontend increment

Owned files are src/ReviewTools.tsx, src/AccessibilityTools.tsx, their routing entries in AdvancedTools.tsx, associated CSS and tests/browser-review.cjs, tests/browser-accessibility.cjs. Existing frontend preserved. Root handles elevated browser commands and service restarts.

ReviewTools exposes native comment add/reply/edit/resolve/reopen/delete, filtering, jump-to-page, summary/JSON export and quoted reply context. Parent deletion is disabled while replies exist. Mutations create document revisions and retain app undo. Measurements accept explicit unrotated PDF coordinate pairs, scale/unit/label, distance/perimeter/area, persisted list and CSV export. Area units already contain the square symbol from the backend. Blank coordinates are rejected locally.

AccessibilityTools exposes partial automated inspection and explicit manual-review needs, document title/language edits, recursive structure selection, role/Alt/ActualText/language edits, sibling reorder and JSON report download. It does not claim conformance or create structure tags for untagged documents. Reordering mixed content references remains restricted by backend validation.

Compare view displays pageMoves and mode-appropriate empty results. Signature browser test now waits for app readiness and reports startup failures; browser closes in finally. Root confirmed signature test passed. Initial missing default export was a transient development-server module state during writes; current source exports default and production build passes.

Root confirmed browser-review and browser-accessibility passed after server restart. Both verify persisted data through normal UI and API reload. Production builds passed throughout.

Second increment adds PrintTools.tsx and ProductionTools.tsx. Print offers original PDF inline preview plus n-up/booklet output preparation, page ranges, paper/orientation, margins/gutters, borders, annotation inclusion, output thumbnail and save/preview links. Native printer settings remain in the browser PDF viewer. Main More actions menu also links inline preview. Production offers font/image inspection, configurable preflight rules with JSON import/export, page-box changes and ICC output intent embedding. It explicitly distinguishes partial checks from conformance and embedding an ICC profile from color conversion. Configurable rule defaults are sent explicitly so the UI and backend agree.

tests/browser-print.cjs awaits root's elevated execution after latest server restart. Checks main-menu preview path, inline PDF headers, n-up page selection/order, booklet blank padding and preflight findings through UI. README reflects current setup/capabilities and known gaps. Full product remains incomplete and no release claim is warranted.

Root confirmed print browser regression passed and backend reached 33 tests. Third increment adds LibraryPanel.tsx and session.ts. Sidebar Library and menu Library open the modal. It lists actual backend documents, filters search/folder/favorites, edits canonical names/folders, opens or restores immutable versions, and shows timestamps converted from Unix seconds. LocalStorage stores last UUID/page/zoom/fit, validates state, clamps page to document count and handles missing documents. Request generation guards prevent a delayed restore replacing a newly opened document. Export filenames are sanitized and use canonical backend names. Failed library opens remain actionable within the modal.

tests/browser-library.cjs awaits root elevated execution against latest library backend. It opens a real two-page fixture, persists viewing state across reload, edits PDF content, assigns folder/favorite/filename, restores original content through actual version history, and checks downloaded filename. Build passed. README updated. Root owns all approvals; worker never invokes escalation.

## Appearance
Implemented src/appearance.ts storage-safe Light/Dark/System preference, immediate initial theme and live media query listener. More actions has compact Appearance radios. Styles use interface color variables with explicit white PDF/thumbnail paper and signature canvas; PDF imagery has no filter. Build passes. tests/browser-theme.cjs covers toggles, persistence/reload, system emulation, PDF paper and both screenshots; root execution requested.
