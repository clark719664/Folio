# Folio design

## Revised release scope

Shared PDF collaboration is explicitly required. Multiple people can work on the same PDF with invited roles, visible presence, synchronized document edits and comments, durable history, and conflict handling. Enforce permissions on the server and test separate users, concurrent edits and revoked invitations. Local development verification uses separate browser sessions. Public service deployment requires an actual hosting destination and configured authentication/delivery infrastructure.

Clark subsequently authorized a practical, polished free PDF viewer and editor with everything reasonable to complete. This supersedes the earlier requirement for complete Acrobat parity in the first release. AI and Studio implementation are excluded. Focus on reliable reading, text and image edits, annotations, page organization, forms, signatures, OCR, useful exports, local library/history, and light/dark/system appearance. Existing enterprise, collaboration, proprietary compatibility and specialist production inventory entries are reference candidates, not automatic release gates. The application remains fully open source with optional Cash App donations. Verify supported workflows and disclose concrete compatibility limitations.

Folio is a working name for Clark's free, fully open-source PDF viewer and editor. The user approved a dedicated editor built on open-source engines. Every paid Acrobat workflow remains a product target, with implemented and verified functionality tracked honestly.

The interface takes its restraint from Apple Notes. The document is the primary content. Compact controls, readable typography, contextual tools and accessible labels serve a concrete action. A donation link in the menu points to https://cash.app/$ClarkLangloisII. Donations are optional and every implemented feature is available free.

The first release must contain the complete requested Acrobat feature coverage. Clark explicitly rejected a reduced first release on 2026-11-12 and authorized taking the time necessary. Intermediate builds are development checkpoints. Rendering, real text editing and export are foundational tasks within the full release. Viewing, search and editing must work on user files. Process locally wherever possible. Existing PDF content must be removed when replaced. Exports must retain unaffected page content. Unsupported cases must produce actionable feedback and remain open release requirements.

The chosen approach uses a dedicated React interface over open-source PDF engines. Adapting BentoPDF was also considered and offers broader existing tooling, but requires verification of source availability for bundled editor components. The dedicated approach gives direct control of UI behavior and dependencies.

The mandatory first-release scope includes text and image editing, annotations, OCR, forms, signatures, conversion, compression, page organization, redaction and sanitization, comparison, accessibility, print production, batch actions, collaboration and equivalent Studio workflows. Build an exhaustive source-backed inventory of Adobe paid workflows and verify each equivalent before release. Hosted collaboration and signature delivery require infrastructure implementation as part of this scope. Open dependencies and deployment costs must be accounted for while preserving free access to features. No feature can be silently moved to a later release.

Verification must exercise an actual PDF edit, export and reopen, confirm the replacement text and absence of removed text, preserve unrelated content, and inspect the browser interface visually.
