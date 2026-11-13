# Full-release implementation plan

Scope update — Clark has replaced exhaustive Acrobat first-release parity with a practical best free PDF viewer/editor. AI and Studio are excluded. Prioritize reliable core editing, reading, OCR, exports, forms, signing and polished light/dark UI. The historical steps below serve as a capability inventory and do not all block this revised release.

Authority is Clark's 2026-11-12 instruction requiring every feature in the first release. This plan supersedes any milestone language that suggests shipping partial Acrobat coverage. The baseline is feature-inventory.md. All acceptance statuses remain unverified until execution evidence exists.

1. Reconcile the official desktop, web, mobile and Express catalogs against the inventory. Preserve URLs and retrieval dates. Confirm entitlement marks visually where page text omits them. Expand grouped checks into fixture-level cases and close the discovery gaps listed in the inventory.
2. Establish reproducible open-source builds, dependency/license manifests and a document fixture corpus. Include rotated/cropped pages, embedded subset fonts, scripts, forms, transparency, scans, malformed files and signed documents. Record hashes and redistribution permissions.
3. Implement the document engine boundary. Provide cancellable rendering, extraction, geometry transforms, transactional edits, undo/redo and safe export. Verify content changes using a second PDF implementation.
4. Implement editing, page operations, annotations, file attachments and document metadata. Finish E, P and A checks through normal UI flows. Preserve unaffected content and detect failed operations before presenting saved state.
5. Add isolated native conversion/OCR/optimization workers with browser and desktop clients. Finish C checks for every supported format and language. Ensure each free workflow has a usable deployment route.
6. Implement AcroForms, form data, script isolation, batch actions and indexed search. Finish F checks, including calculation dependencies and interrupted batch recovery.
7. Implement redaction, sanitization, encryption and certificate operations. Finish S01-S08 with independent extraction, cryptographic verification and revision/tamper fixtures. Review security-sensitive code independently.
8. Implement agreement delivery, signer roles, reminders, web forms and audit evidence. Finish S09-S12 with multiple real test accounts, failed delivery, expiry and retry scenarios. Establish hosting/mail and operational ownership.
9. Implement accessibility structure editing, standards validation, color management and print production. Finish X checks against independent validators and actual screen-reader/print workflows.
10. Implement portfolio, measurement, multimedia and 3D support. Finish D checks with mixed attachments and cross-viewer exports. Confirm format licensing and sandbox runtime behavior.
11. Implement collaborative spaces, cloud connectors, history and offline reconciliation. Implement grounded AI tools using open models, including speech, reports and presentation generation. Finish I checks with citation fidelity and concurrent-edit tests.
12. Implement the design editor and bundled Express equivalents. Finish B checks with original or redistributable templates/assets. Resolve content-catalog coverage and publishing service dependencies explicitly.
13. Apply one consistent minimalist UI across all workflows. Document-first layout, contextual controls, accessible names, coherent keyboard shortcuts, usable mobile controls and donation placement. Test the longest feature workflows so complexity stays manageable.
14. Perform whole-product integration, interoperability, performance, accessibility and security review. Publish feature evidence and unresolved defects. Release only when all required inventory checks pass and discovery gaps are resolved with the user.

## Evidence format

For each inventory ID record fixture paths, exact steps, expected result, output hash, independent validator result and verification date. Track unavailable dependencies as open work. Completion of one subsystem never implies full-release completion.

## Architecture decisions still requiring evidence

Browser-only processing may be insufficient for full conversion, native printing, scanners, OS integrations and computationally heavy models. Evaluate an open desktop companion and self-hostable service while retaining the same UI. Select engines by tested feature coverage and license compatibility. Verify the availability of complete source for any bundled binary or model. Document operational costs and deployment requirements for free hosted functionality.
