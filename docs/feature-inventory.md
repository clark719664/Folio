# Full release acceptance inventory

Research date 2026-11-12. All entries start UNVERIFIED. This is the mandatory first-release baseline. Foundational builds do not satisfy this release. Each checkbox requires a fixture, a normal UI execution, saved output where relevant, and an independent check. A button, mock response, or library capability claim is insufficient.

Completeness remains unproven until the desktop, web, mobile and bundled Express catalogs have been reconciled line by line. Adobe help includes features available in free Reader and separately sold enterprise products. Those entitlement distinctions require verification and must not silently remove capabilities. Platform-specific integrations require their own acceptance fixtures.

## Editing and document structure

Dependency candidates are PDFium or MuPDF for object manipulation, a Unicode shaping engine, licensed redistributable fonts and an independent renderer. The checks below are Folio acceptance criteria. [Adobe desktop guide](https://helpx.adobe.com/acrobat/desktop.html)

- [ ] E01 Correct existing text and remove original content, including text extraction after saving.
- [ ] E02 Insert/delete text across runs while retaining unaffected characters and positions.
- [ ] E03 Change font, size, color and spacing with explicit handling of missing font glyphs.
- [ ] E04 Reflow paragraphs, align text and edit lists across multilingual fixtures.
- [ ] E05 Insert, replace, resize, crop, rotate and extract images without changing unrelated objects.
- [ ] E06 Select, reorder and transform vector objects with undo/redo.
- [ ] E07 Find and replace with case, whole-word and multi-page controls.
- [ ] E08 Add/edit/remove links, destinations and nested bookmarks.
- [ ] E09 Edit metadata, initial view, page labels and document properties.
- [ ] E10 Preserve edits through recovery, save, save-as and reopening.

## Pages and file creation

Use a PDF object copier with reference remapping and native conversion workers. Tests must preserve bookmarks, annotations and forms across document boundaries. [Adobe creation and organization guide](https://helpx.adobe.com/acrobat/desktop.html)

- [ ] P01 Merge mixed files and reorder their preview pages before output.
- [ ] P02 Insert, delete, duplicate, extract, replace and rotate pages.
- [ ] P03 Split by count, size, bookmark and selected ranges.
- [ ] P04 Crop and resize pages with MediaBox/CropBox/TrimBox/BleedBox consistency.
- [ ] P05 Apply/edit/remove backgrounds, watermarks, headers and footers.
- [ ] P06 Apply Bates numbering and page labels across batches without collisions.
- [ ] P07 Create PDFs from blank pages, clipboard, images and captured webpages.
- [ ] P08 Print to PDF and import Office, text, HTML, XPS and PostScript fixtures.
- [ ] P09 Preserve layers and import/reorder/toggle layer groups.
- [ ] P10 Attach, replace and extract embedded files with original bytes intact.

## Conversion, optimization and scanning

Candidate dependencies include LibreOffice conversion workers, OCR with layout detection, image codecs and qpdf. Each file family needs dedicated fidelity fixtures. [Adobe plan capabilities](https://www.adobe.com/acrobat/pricing/compare-versions.html)

- [ ] C01 Export editable DOCX with reading order and tables preserved.
- [ ] C02 Export XLSX including multi-page tables and typed numeric cells.
- [ ] C03 Export PPTX with editable text and preserved slide composition.
- [ ] C04 Export raster images, text and HTML with explicit page/range settings.
- [ ] C05 Compress using downsampling, codec and font/resource controls with before/after comparison.
- [ ] C06 Display storage usage and selectively remove unused resources.
- [ ] C07 Capture camera/scanner input, crop boundaries and assemble multiple pages.
- [ ] C08 Deskew, remove noise and improve scan contrast without erasing fine marks.
- [ ] C09 Run multilingual OCR with searchable text aligned to the original image.
- [ ] C10 Correct uncertain OCR and edit scans while preserving document appearance.

## Annotations and review

Use interoperable PDF annotations and a review service for shared work. [Adobe web review guide](https://helpx.adobe.com/acrobat/web.html)

- [ ] A01 Highlight, underline, strike through and replace selected text accurately at all rotations.
- [ ] A02 Add sticky notes, callouts, free text, ink, shapes and stamps.
- [ ] A03 Create custom/dynamic stamps and preserve appearance after export.
- [ ] A04 Reply, resolve, filter and search comment threads.
- [ ] A05 Import/export comments and produce printable review summaries.
- [ ] A06 Compare text, visual objects and page moves, navigating each difference.
- [ ] A07 Share a review link, enforce roles and revoke access immediately.
- [ ] A08 Synchronize simultaneous comments with durable history and conflict handling.

## Forms and automation

Requires AcroForm serialization, field appearance generation and an isolated document-script runtime. [Adobe forms guide](https://helpx.adobe.com/acrobat/desktop.html) [Guided actions](https://helpx.adobe.com/acrobat/using/action-wizard-acrobat-pro.html)

- [ ] F01 Detect fields and author text, checkbox, radio, list, dropdown, button and signature fields.
- [ ] F02 Set names, tooltips, required/read-only flags, formatting and tab order.
- [ ] F03 Align, distribute, duplicate and resize fields across pages.
- [ ] F04 Run calculations, validation and field actions with deterministic fixtures.
- [ ] F05 Fill/save/flatten forms and import/export structured form data.
- [ ] F06 Distribute forms, collect responses and export response datasets.
- [ ] F07 Handle dynamic XFA and existing document scripts through explicitly tested compatibility.
- [ ] F08 Author/import/export reusable batch actions and run them on folders with per-file results.
- [ ] F09 Resume interrupted batches without duplicating completed output.
- [ ] F10 Build searchable document indexes and search across a collection.

## Security and signatures

Requires secure removal, encryption, cryptographic signing and validation, certificate trust management, timestamp/revocation services, and an agreement service. [Certificate signatures](https://helpx.adobe.com/acrobat/kb/certificate-signatures.html) [Validation preferences](https://helpx.adobe.com/acrobat/desktop/e-sign-documents/manage-digital-signatures/set-preferences.html) [Adobe plan comparison](https://www.adobe.com/acrobat/pricing/compare-versions.html)

- [ ] S01 Redact text, images and regions so removed bytes/content are absent from output.
- [ ] S02 Find/redact repeated phrases and patterns across files with a review step.
- [ ] S03 Sanitize metadata, comments, hidden layers, embedded files and previous revisions.
- [ ] S04 Configure passwords, permissions and certificate-recipient encryption.
- [ ] S05 Draw/type/import signatures and initials with reusable local storage.
- [ ] S06 Sign and certify with digital IDs, multiple signers and allowed-change rules.
- [ ] S07 Validate chains, revocation, timestamps, prior revisions and long-term evidence.
- [ ] S08 Detect signed-document modification and report its effect accurately.
- [ ] S09 Request signatures in sequence/parallel, remind, cancel and track completion.
- [ ] S10 Send bulk agreements using reusable templates, field assignments and branding.
- [ ] S11 Publish web forms and retain verifiable audit records and completed documents.
- [ ] S12 Verify recipient authentication and prevent replay or reassignment attacks.

## Accessibility and production

Requires structure-tree editing, accessibility rules, color management, standards validators and print integration. [Accessibility tools](https://helpx.adobe.com/acrobat/using/create-verify-pdf-accessibility.html) [Print production](https://helpx.adobe.com/acrobat/using/print-production-tools-overview-acrobat.html) [Preflight profiles](https://helpx.adobe.com/acrobat/using/preflight-profiles-acrobat-pro.html)

- [ ] X01 Inspect/edit tags, reading order, headings, lists, tables and artifacts.
- [ ] X02 Set language, title, alt text and accessible form labels.
- [ ] X03 Check accessibility and repair issues, retaining manual-review findings.
- [ ] X04 Export tagged accessible output and verify with an independent checker/screen reader.
- [ ] X05 Convert/validate PDF/A, PDF/X and PDF/E profiles, reporting exact conformance failures.
- [ ] X06 Import/export/edit preflight profiles and apply targeted fixups.
- [ ] X07 Inspect separations, overprint, ink coverage, transparency and color spaces.
- [ ] X08 Convert colors with ICC profiles and output intents.
- [ ] X09 Flatten transparency, manage trapping and add printer marks.
- [ ] X10 Inspect/embed fonts, outline where requested and verify output at print resolution.
- [ ] X11 Print booklet, poster, multiple-page sheets, selected regions and comments.

## Specialized PDF content

Requires container handling, geometry tools and media/3D engines. [Portfolios](https://helpx.adobe.com/ca/acrobat/using/overview-pdf-portfolios.html) [Measurement](https://helpx.adobe.com/acrobat/using/grids-guides-measurements-pdfs.html) [Rich media](https://helpx.adobe.com/acrobat/using/rich-media.html) [3D interaction](https://helpx.adobe.com/acrobat/using/interacting-3d-models.html)

- [ ] D01 Create/edit/search/export portfolios with nested folders and component metadata.
- [ ] D02 Measure distance, perimeter and area with calibrated scale and snapping.
- [ ] D03 Save measurement annotations and export values to CSV.
- [ ] D04 Embed/play audio and video with poster frames and activation settings.
- [ ] D05 Embed/view 3D models with camera views, model-tree selection and measurement.
- [ ] D06 Preserve unsupported embedded content through unrelated edits.

## Studio, shared spaces and AI

Requires indexed sources, grounded generation, open model weights and serving, speech synthesis, presentation generation and a collaboration backend. [Spaces creation](https://helpx.adobe.com/acrobat/web/explore-pdf-spaces/create-pdf-spaces.html) [Sharing experiences](https://helpx.adobe.com/acrobat/web/explore-pdf-spaces/about-experience-sharing.html) [Study tools](https://helpx.adobe.com/acrobat/web/student-spaces/study-tools/multimedia.html)

- [ ] I01 Create shared spaces from documents, links and pasted text with persistent permissions.
- [ ] I02 Ask questions across sources with resolvable citations and source-bound answers.
- [ ] I03 Generate summaries and notes with editable tables and links.
- [ ] I04 Perform document edits through chat with preview, undo and reliable execution.
- [ ] I05 Generate audio summaries/podcasts with transcript and playback controls.
- [ ] I06 Generate editable presentations and export standard formats.
- [ ] I07 Generate interactive reports, quizzes, flashcards, study guides and video summaries.
- [ ] I08 Customize shared experiences, assistants and access roles with engagement reporting.
- [ ] I09 Support cloud file connectors, cross-device sync, offline recovery and version history.

## Bundled Express equivalents

Functional equivalents require an open design editor, a redistributable asset/template catalog, image/video processing, generation engines and publishing connectors. Adobe's proprietary asset catalog is a content entitlement whose equivalent coverage remains an explicit unresolved requirement. Exact Premium versus other bundled-plan entitlements must be confirmed because rendered comparison checkmarks were absent from text extraction. [Express plans](https://www.adobe.com/express/pricing) [Studio includes Express Premium](https://helpx.adobe.com/express/web/adobe-express-subscription/premium.html)

- [ ] B01 Design flyers, presentations, social posts and documents from editable templates.
- [ ] B02 Browse licensed fonts, images, audio, video and design assets with provenance.
- [ ] B03 Apply brand kits and resize layouts across target formats.
- [ ] B04 Edit images, erase backgrounds/objects and apply effects.
- [ ] B05 Edit video/audio timelines, captions, animation and export media.
- [ ] B06 Generate images, layouts, text effects and short video using open components.
- [ ] B07 Export editable design formats and import supported layered assets.
- [ ] B08 Collaborate on designs, manage versions and schedule/publish to connected channels.

## Release gates and outstanding discovery

There are 94 concrete capability checks above. None is marked implemented by this research. Every feature must be reachable through keyboard and touch where applicable. Export checks use independent parsers and renderers. Source, licenses, model weights and reproducible build instructions must be available for the shipped product. The donation destination is https://cash.app/$ClarkLangloisII.

The baseline requires expansion for exact format matrices, OCR languages, signing authentication modes, mobile-only workflows, enterprise administration entitlements, third-party connector lists, JavaScript API coverage, 3D formats and proprietary Reader extension rights. Reader extension compatibility and Adobe-specific signatures may depend on proprietary credentials. These are unresolved requirements, not approved exclusions. Hosting, mail delivery, timestamp authorities, model inference and third-party services incur operational dependencies that need an actual funded or self-hostable deployment plan. Free user access must be demonstrated without pretending those costs disappear.
