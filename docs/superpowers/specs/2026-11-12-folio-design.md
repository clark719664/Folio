# Folio design

Folio is a working name for Clark's free, fully open-source PDF viewer and editor. The user approved a dedicated editor built on open-source engines. Every paid Acrobat workflow remains a product target, with implemented and verified functionality tracked honestly.

The interface takes its restraint from Apple Notes. The document is the primary content. Compact controls, readable typography, contextual tools and accessible labels serve a concrete action. A donation link in the menu points to https://cash.app/$ClarkLangloisII. Donations are optional and every implemented feature is available free.

The first release must contain the complete requested Acrobat feature coverage. Clark explicitly rejected a reduced first release on 2026-11-12 and authorized taking the time necessary. Intermediate builds are development checkpoints. Rendering, real text editing and export are foundational tasks within the full release. Viewing, search and editing must work on user files. Process locally wherever possible. Existing PDF content must be removed when replaced. Exports must retain unaffected page content. Unsupported cases must produce actionable feedback and remain open release requirements.

The chosen approach uses a dedicated React interface over open-source PDF engines. Adapting BentoPDF was also considered and offers broader existing tooling, but requires verification of source availability for bundled editor components. The dedicated approach gives direct control of UI behavior and dependencies.

The mandatory first-release scope includes text and image editing, annotations, OCR, forms, signatures, conversion, compression, page organization, redaction and sanitization, comparison, accessibility, print production, batch actions, collaboration and equivalent Studio workflows. Build an exhaustive source-backed inventory of Adobe paid workflows and verify each equivalent before release. Hosted collaboration and signature delivery require infrastructure implementation as part of this scope. Open dependencies and deployment costs must be accounted for while preserving free access to features. No feature can be silently moved to a later release.

Verification must exercise an actual PDF edit, export and reopen, confirm the replacement text and absence of removed text, preserve unrelated content, and inspect the browser interface visually.
