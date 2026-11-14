import { useDialog } from "./useDialog";
import SignaturePad from "./SignaturePad";
import ReviewTools from "./ReviewTools";
import AccessibilityTools from "./AccessibilityTools";
import PrintTools from "./PrintTools";
import ProductionTools from "./ProductionTools";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileText,
  Image,
  Link,
  List,
  LoaderCircle,
  ScanText,
  Search,
  TextCursorInput,
  X,
  Paperclip,
  Columns2,
  Printer,
} from "lucide-react";

type Field = {
  name: string;
  label: string;
  kind: string;
  value: string | boolean;
  choices: string[];
  flags: number;
  page: number;
};
type DocumentInfo = {
  id: string;
  name: string;
  pageCount: number;
  pages: { index: number; width: number; height: number; rotation: number }[];
  metadata: Record<string, string>;
};
type Props = {
  document: DocumentInfo;
  page: number;
  rect?: number[];
  onClose: () => void;
  onChange: (doc: DocumentInfo) => void;
  onPageChange: (page: number) => void;
  onConvert: () => void;
};
const items = [
  { id: "convert-to-pdf", label: "Convert to PDF", description: "Images, documents and other files into PDFs", icon: FileText },
  {
    id: "production",
    label: "Print production",
    description: "Inspect fonts, images, boxes and output profiles",
    icon: ScanText,
  },
  {
    id: "print",
    label: "Print",
    description: "Original pages, multiple pages or booklets",
    icon: Printer,
  },
  {
    id: "accessibility",
    label: "Accessibility",
    description: "Inspect tags and edit reading structure",
    icon: List,
  },
  {
    id: "comments",
    label: "Comments",
    description: "Reply, resolve and export review threads",
    icon: FileText,
  },
  {
    id: "measurements",
    label: "Measurements",
    description: "Measure distances, perimeters and areas",
    icon: ScanText,
  },
  {
    id: "certsign",
    label: "Sign with a certificate",
    description: "Apply a digital signature",
    icon: TextCursorInput,
  },
  {
    id: "verify",
    label: "Verify signatures",
    description: "Inspect signatures and document integrity",
    icon: ScanText,
  },
  {
    id: "labels",
    label: "Page labels",
    description: "Set page numbering styles",
    icon: List,
  },
  {
    id: "header",
    label: "Header",
    description: "Add text at the top of pages",
    icon: FileText,
  },
  {
    id: "footer",
    label: "Footer",
    description: "Add text at the bottom of pages",
    icon: FileText,
  },
  {
    id: "background",
    label: "Background",
    description: "Place an image behind page content",
    icon: Image,
  },
  {
    id: "stamp",
    label: "Stamp",
    description: "Place an image stamp on pages",
    icon: Image,
  },
  {
    id: "searchfiles",
    label: "Search files",
    description: "Find text across multiple PDFs",
    icon: Search,
  },
  {
    id: "markup",
    label: "Mark up a page",
    description: "Underline, strike out or draw a shape",
    icon: TextCursorInput,
  },
  {
    id: "objects",
    label: "Images and links",
    description: "Remove existing images or links",
    icon: Image,
  },
  {
    id: "addtext",
    label: "Add text",
    description: "Place new text on a page",
    icon: TextCursorInput,
  },
  {
    id: "signature",
    label: "Draw a signature",
    description: "Add your handwritten signature",
    icon: TextCursorInput,
  },
  {
    id: "forms",
    label: "Fill forms",
    description: "Complete the fields in your document",
    icon: TextCursorInput,
  },
  {
    id: "field",
    label: "Create a form field",
    description: "Text, checkboxes, lists and signatures",
    icon: TextCursorInput,
  },
  {
    id: "replace",
    label: "Find and replace",
    description: "Replace matching text across pages",
    icon: Search,
  },
  {
    id: "image",
    label: "Insert an image",
    description: "Place a picture on the current page",
    icon: Image,
  },
  {
    id: "link",
    label: "Add a link",
    description: "Link to a website or another page",
    icon: Link,
  },
  {
    id: "bookmarks",
    label: "Bookmarks",
    description: "Create an outline for your document",
    icon: List,
  },
  {
    id: "attachment",
    label: "Attachments",
    description: "Include or download another file",
    icon: Paperclip,
  },
  {
    id: "ocr",
    label: "Recognize text",
    description: "Make scanned pages searchable",
    icon: ScanText,
  },
  {
    id: "compare",
    label: "Compare documents",
    description: "See text changes between two PDFs",
    icon: Columns2,
  },
  {
    id: "crop",
    label: "Crop pages",
    description: "Adjust the visible page area",
    icon: ScanText,
  },
  {
    id: "watermark",
    label: "Watermark",
    description: "Add text across selected pages",
    icon: FileText,
  },
  {
    id: "bates",
    label: "Bates numbering",
    description: "Add sequential document identifiers",
    icon: List,
  },
  {
    id: "sanitize",
    label: "Remove hidden information",
    description: "Clear metadata and embedded files",
    icon: ScanText,
  },
  {
    id: "batch",
    label: "Process multiple files",
    description: "Apply one action to several PDFs",
    icon: FileText,
  },
  {
    id: "extract",
    label: "Extract content",
    description: "Save images, text or form data",
    icon: Download,
  },
];
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api" + path, init);
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ detail: "Request failed" }));
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : "Check the values and try again.",
    );
  }
  return response.json();
}
async function encode(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}
export default function AdvancedTools({
  document: doc,
  page,
  rect,
  onClose,
  onChange,
  onPageChange,
  onConvert,
}: Props) {
  useDialog(true, onClose);
  const [view, setView] = useState("");
  const [certificatePassword, setCertificatePassword] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [certify, setCertify] = useState(false);
  const [allowedChanges, setAllowedChanges] = useState("forms");
  const [verification, setVerification] = useState<
    | {
        fieldName: string;
        signer: string;
        intact: boolean;
        valid: boolean;
        trusted: boolean;
        coverage: string;
        certificationSatisfied: boolean;
        summary: string;
      }[]
    | null
  >(null);
  const [trustFile, setTrustFile] = useState<File | null>(null);
  const [labelStyle, setLabelStyle] = useState("D");
  const [searchDocuments, setSearchDocuments] = useState<DocumentInfo[]>([doc]);
  const [collectionQuery, setCollectionQuery] = useState("");
  const [searchHits, setSearchHits] = useState<
    { id: string; page: number; text: string }[]
  >([]);
  const [selectedImage, setSelectedImage] = useState<{
    page: number;
    xref: number;
  } | null>(null);
  const [toolQuery, setToolQuery] = useState("");
  const [objects, setObjects] = useState<
    {
      page: number;
      links: { xref: number; url?: string; targetPage?: number }[];
      images: {
        xref: number;
        width: number;
        height: number;
        rects: number[][];
      }[];
    }[]
  >([]);
  const [signature, setSignature] = useState("");
  const [markup, setMarkup] = useState("underline");
  const [compareMode, setCompareMode] = useState("text");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [name, setName] = useState("");
  const [kind, setKind] = useState("text");
  const [choices, setChoices] = useState("");
  const [required, setRequired] = useState(false);
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [size, setSize] = useState(12);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [targetPage, setTargetPage] = useState(1);
  const [linkKind, setLinkKind] = useState("website");
  const [bookmarks, setBookmarks] = useState<[number, string, number][]>([]);
  const [attachments, setAttachments] = useState<
    { name: string; filename: string }[]
  >([]);
  const [language, setLanguage] = useState("eng");
  const [allPages, setAllPages] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [start, setStart] = useState(1);
  const [digits, setDigits] = useState(6);
  const [opacity, setOpacity] = useState(0.25);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchAction, setBatchAction] = useState("sanitize");
  const [batchResults, setBatchResults] = useState<
    { source: string; document?: DocumentInfo; error?: string }[]
  >([]);
  const [comparison, setComparison] = useState<
    | {
        page: number;
        status: string;
        diffPng?: string;
        bbox?: number[];
        changes?: { kind: string; before: string[]; after: string[] }[];
      }[]
    | null
  >(null);
  const [pageMoves, setPageMoves] = useState<
    { beforePage: number; afterPage: number }[]
  >([]);
  const [bounds, setBounds] = useState(rect || [72, 72, 272, 122]);
  const base = "/documents/" + doc.id;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to finish. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function mutate(
    operation: Record<string, unknown>,
    endpoint = "tools",
  ) {
    await run(async () => {
      const next = await api<DocumentInfo>(`${base}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation),
      });
      onChange(next);
      onClose();
    });
  }
  useEffect(() => {
    setError("");
    setFile(null);
    if (view === "objects")
      run(async () => {
        const data = await api<{ pages: typeof objects }>(base + "/objects");
        setObjects(data.pages);
      });
    if (view === "forms")
      run(async () => {
        const data = await api<{ fields: Field[] }>(base + "/forms");
        setFields(data.fields);
        setValues(
          Object.fromEntries(
            data.fields
              .filter(
                (field) =>
                  !(field.flags & 1) &&
                  field.kind.toLowerCase() !== "signature",
              )
              .map((field) => [field.name, field.value]),
          ),
        );
      });
    if (view === "bookmarks")
      run(async () => {
        const data = await api<{ bookmarks: [number, string, number][] }>(
          base + "/bookmarks",
        );
        setBookmarks(data.bookmarks);
      });
    if (view === "attachment")
      run(async () => {
        const data = await api<{
          attachments: { name: string; filename: string }[];
        }>(base + "/attachments");
        setAttachments(data.attachments);
      });
  }, [view]);
  const placement = (
    <fieldset className="placement">
      <legend>
        Position on page{" "}
        {(view === "object-edit" ? (selectedImage?.page ?? page) : page) + 1}
      </legend>
      <div>
        {["Left", "Top", "Right", "Bottom"].map((label, index) => (
          <label key={label}>
            {label}
            <input
              type="number"
              value={bounds[index]}
              min="0"
              step="1"
              onChange={(event) =>
                setBounds((current) =>
                  current.map((value, i) =>
                    i === index ? Number(event.target.value) : value,
                  ),
                )
              }
            />
          </label>
        ))}
      </div>
      <small>Measured in PDF points. 72 points = 1 inch.</small>
    </fieldset>
  );
  const chosen = items.find((item) => item.id === view);
  return (
    <div className="modal-backdrop">
      <section
        className="modal tools-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tools-title"
      >
        <div className="inspector-heading">
          <div className="tools-heading">
            {view && (
              <button aria-label="Back to tools" onClick={() => setView("")}>
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 id="tools-title">
              {view === "object-edit" ? "Edit image" : chosen?.label || "Tools"}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close tools"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {error && (
          <p className="tool-error" role="alert">
            {error}
          </p>
        )}
        {!view ? (
          <div className="tool-grid">
            <div className="tool-search">
              <Search size={16} />
              <input
                autoFocus
                aria-label="Find a tool"
                placeholder="Find a tool"
                value={toolQuery}
                onChange={(event) => setToolQuery(event.target.value)}
              />
            </div>
            {!items.some((item) =>
              (item.label + " " + item.description)
                .toLowerCase()
                .includes(toolQuery.trim().toLowerCase()),
            ) && (
              <p className="help-text" role="status">
                No matching tools.
              </p>
            )}
            {items
              .filter((item) =>
                (item.label + " " + item.description)
                  .toLowerCase()
                  .includes(toolQuery.trim().toLowerCase()),
              )
              .map((item) => (
                <button key={item.id} onClick={() => item.id === "convert-to-pdf" ? onConvert() : setView(item.id)}>
                  <item.icon size={20} />
                  <span>
                    <b>{item.label}</b>
                    <small>{item.description}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
          </div>
        ) : (
          <div className="tool-content">
            {view === "production" && (
              <ProductionTools
                documentId={doc.id}
                page={page}
                busy={busy}
                mutate={mutate}
              />
            )}
            {view === "print" && (
              <PrintTools documentId={doc.id} pageCount={doc.pageCount} />
            )}
            {view === "accessibility" && (
              <AccessibilityTools
                documentId={doc.id}
                busy={busy}
                mutate={mutate}
              />
            )}
            {(view === "comments" || view === "measurements") && (
              <ReviewTools
                documentId={doc.id}
                page={page}
                mode={view}
                rect={bounds}
                mutate={mutate}
                onPageChange={onPageChange}
                busy={busy}
              />
            )}
            {view === "addtext" && (
              <>
                <label className="field-label">Text</label>
                <textarea
                  aria-label="Text"
                  rows={4}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <label className="field-label">Font size</label>
                <input
                  aria-label="Font size"
                  type="number"
                  value={size}
                  min="4"
                  max="96"
                  onChange={(event) => setSize(Number(event.target.value))}
                />
                {placement}
                <button
                  className="wide-button primary"
                  disabled={busy || !name}
                  onClick={() =>
                    mutate(
                      {
                        operation: "annotate",
                        kind: "text",
                        page,
                        rect: bounds,
                        text: name,
                        fontSize: size,
                      },
                      "edit",
                    )
                  }
                >
                  Add text
                </button>
              </>
            )}
            {view === "signature" && (
              <>
                <SignaturePad onChange={setSignature} />
                {placement}
                <button
                  className="wide-button primary"
                  disabled={busy || !signature}
                  onClick={() =>
                    mutate({
                      operation: "image",
                      page,
                      rect: bounds,
                      content: signature,
                    })
                  }
                >
                  Add signature
                </button>
              </>
            )}
            {view === "object-edit" && selectedImage && (
              <>
                {placement}
                <button
                  className="wide-button primary"
                  disabled={busy}
                  onClick={() =>
                    mutate({
                      operation: "move_image",
                      page: selectedImage.page,
                      xref: selectedImage.xref,
                      rect: bounds,
                    })
                  }
                >
                  Move image
                </button>
                <label className="field-label">Replace image</label>
                <input
                  aria-label="Replace image"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
                <button
                  className="wide-button primary"
                  disabled={busy || !file}
                  onClick={() =>
                    run(async () => {
                      const next = await api<DocumentInfo>(base + "/tools", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          operation: "replace_image",
                          page: selectedImage.page,
                          xref: selectedImage.xref,
                          content: await encode(file!),
                        }),
                      });
                      onChange(next);
                      onClose();
                    })
                  }
                >
                  Replace image
                </button>
              </>
            )}
            {view === "objects" && (
              <div className="object-list">
                {objects.map((item) => (
                  <section key={item.page}>
                    <h3>Page {item.page + 1}</h3>
                    {item.images.map((image, index) => (
                      <div key={image.xref}>
                        <span>
                          Image {index + 1}{" "}
                          <small>
                            {image.width} Ã— {image.height}
                          </small>
                        </span>
                        <button
                          onClick={() => {
                            setSelectedImage({
                              page: item.page,
                              xref: image.xref,
                            });
                            setBounds(image.rects[0] || [72, 72, 272, 172]);
                            setView("object-edit");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            mutate({
                              operation: "delete_image",
                              page: item.page,
                              xref: image.xref,
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    {item.links.map((link, index) => (
                      <div key={link.xref}>
                        <span>
                          {link.url ||
                            "Link to page " + ((link.targetPage || 0) + 1)}
                        </span>
                        <button
                          disabled={busy}
                          onClick={() =>
                            mutate({
                              operation: "delete_link",
                              page: item.page,
                              xref: link.xref,
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    {!item.links.length && !item.images.length && (
                      <p>No images or links</p>
                    )}
                  </section>
                ))}
              </div>
            )}
            {view === "markup" && (
              <>
                <label className="field-label">Mark</label>
                <select
                  aria-label="Mark"
                  value={markup}
                  onChange={(event) => setMarkup(event.target.value)}
                >
                  {[
                    "underline",
                    "strikeout",
                    "squiggly",
                    "rectangle",
                    "circle",
                  ].map((kind) => (
                    <option key={kind} value={kind}>
                      {kind.charAt(0).toUpperCase() + kind.slice(1)}
                    </option>
                  ))}
                </select>
                {placement}
                <button
                  className="wide-button primary"
                  disabled={busy}
                  onClick={() =>
                    mutate(
                      {
                        operation: "annotate",
                        kind: markup,
                        page,
                        rect: bounds,
                        color: [0.2, 0.25, 0.3],
                      },
                      "edit",
                    )
                  }
                >
                  Add mark
                </button>
              </>
            )}
            {view === "searchfiles" && (
              <>
                <label className="field-label">Add PDFs</label>
                <input
                  aria-label="Add PDFs"
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    run(async () => {
                      const added: DocumentInfo[] = [];
                      for (const file of files) {
                        const body = new FormData();
                        body.append("file", file);
                        added.push(
                          await api<DocumentInfo>("/documents", {
                            method: "POST",
                            body,
                          }),
                        );
                      }
                      setSearchDocuments((current) => [...current, ...added]);
                    });
                  }}
                />
                <p className="help-text">
                  {searchDocuments.length} files selected
                </p>
                <label className="field-label">Find text</label>
                <input
                  aria-label="Find text"
                  value={collectionQuery}
                  onChange={(event) => setCollectionQuery(event.target.value)}
                />
                <button
                  className="wide-button primary"
                  disabled={busy || !collectionQuery}
                  onClick={() =>
                    run(async () => {
                      const result = await api<{ hits: typeof searchHits }>(
                        "/index/search",
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            ids: searchDocuments.map((document) => document.id),
                            query: collectionQuery,
                          }),
                        },
                      );
                      setSearchHits(result.hits);
                    })
                  }
                >
                  Search files
                </button>
                <div className="collection-results">
                  {searchHits.map((hit, index) => (
                    <button
                      key={index}
                      onClick={() =>
                        run(async () => {
                          const document = await api<DocumentInfo>(
                            "/documents/" + hit.id,
                          );
                          onChange(document);
                          onPageChange(hit.page);
                          onClose();
                        })
                      }
                    >
                      <small>
                        {
                          searchDocuments.find(
                            (document) => document.id === hit.id,
                          )?.name
                        }{" "}
                        Â· Page {hit.page + 1}
                      </small>
                      <span>{hit.text}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {view === "certsign" && (
              <>
                <label className="field-label">Certificate file</label>
                <input
                  aria-label="Certificate file"
                  type="file"
                  accept=".p12,.pfx"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
                <label className="field-label">Certificate password</label>
                <input
                  aria-label="Certificate password"
                  type="password"
                  value={certificatePassword}
                  onChange={(event) =>
                    setCertificatePassword(event.target.value)
                  }
                />
                <label className="field-label">Reason</label>
                <input
                  aria-label="Reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <label className="field-label">Location</label>
                <input
                  aria-label="Location"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={certify}
                    onChange={(event) => setCertify(event.target.checked)}
                  />
                  Certify document
                </label>
                {certify && (
                  <>
                    <label className="field-label">Allowed changes</label>
                    <select
                      aria-label="Allowed changes"
                      value={allowedChanges}
                      onChange={(event) =>
                        setAllowedChanges(event.target.value)
                      }
                    >
                      <option value="none">None</option>
                      <option value="forms">Form filling</option>
                      <option value="annotations">
                        Form filling and annotations
                      </option>
                    </select>
                  </>
                )}
                <button
                  className="wide-button primary"
                  disabled={busy || !file}
                  onClick={() =>
                    run(async () => {
                      const result = await api<DocumentInfo>(
                        base + "/signatures",
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            pkcs12: await encode(file!),
                            password: certificatePassword,
                            fieldName: "Signature",
                            reason,
                            location,
                            certify,
                            allowedChanges,
                          }),
                        },
                      );
                      setCertificatePassword("");
                      onChange(result);
                      onClose();
                    })
                  }
                >
                  Sign document
                </button>
              </>
            )}
            {view === "verify" && (
              <>
                <label className="field-label">
                  Trusted certificate (optional)
                </label>
                <input
                  aria-label="Trusted certificate"
                  type="file"
                  accept=".pem,.crt"
                  onChange={(event) =>
                    setTrustFile(event.target.files?.[0] || null)
                  }
                />
                <p className="help-text">
                  Verification runs offline. Certificate revocation is not
                  checked.
                </p>
                <button
                  className="wide-button primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await api<{
                        signatures: NonNullable<typeof verification>;
                      }>(base + "/signatures/verify", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          trustRoots: trustFile ? [await trustFile.text()] : [],
                        }),
                      });
                      setVerification(result.signatures);
                    })
                  }
                >
                  Verify signatures
                </button>
                {verification && (
                  <div className="signature-results">
                    {verification.length === 0 ? (
                      <p>No digital signatures found.</p>
                    ) : (
                      verification.map((signature, index) => (
                        <section key={index}>
                          <h3>{signature.fieldName}</h3>
                          <p>{signature.signer}</p>
                          <dl>
                            <dt>Integrity</dt>
                            <dd>{signature.intact ? "Intact" : "Modified"}</dd>
                            <dt>Signature</dt>
                            <dd>{signature.valid ? "Valid" : "Invalid"}</dd>
                            <dt>Certificate trust</dt>
                            <dd>
                              {signature.trusted
                                ? "Trusted"
                                : "Trust not established"}
                            </dd>
                            <dt>Coverage</dt>
                            <dd>{signature.coverage}</dd>
                          </dl>
                        </section>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
            {view === "labels" && (
              <>
                <label className="field-label">Numbering style</label>
                <select
                  aria-label="Numbering style"
                  value={labelStyle}
                  onChange={(event) => setLabelStyle(event.target.value)}
                >
                  <option value="D">1, 2, 3</option>
                  <option value="r">i, ii, iii</option>
                  <option value="R">I, II, III</option>
                  <option value="a">a, b, c</option>
                  <option value="A">A, B, C</option>
                </select>
                <label className="field-label">Prefix</label>
                <input
                  aria-label="Prefix"
                  value={prefix}
                  onChange={(event) => setPrefix(event.target.value)}
                />
                <label className="field-label">Start number</label>
                <input
                  aria-label="Start number"
                  type="number"
                  min="1"
                  value={start}
                  onChange={(event) => setStart(Number(event.target.value))}
                />
                <p className="help-text">
                  Numbering starts on page {page + 1}.
                </p>
                <button
                  className="wide-button primary"
                  disabled={busy}
                  onClick={() =>
                    mutate({
                      operation: "page_labels",
                      labels: [
                        {
                          startpage: page,
                          style: labelStyle,
                          prefix,
                          firstpagenum: start,
                        },
                      ],
                    })
                  }
                >
                  Set page labels
                </button>
              </>
            )}
            {["header", "footer", "background", "stamp"].includes(view) && (
              <>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={allPages}
                    onChange={(event) => setAllPages(event.target.checked)}
                  />
                  All pages
                </label>
                {["header", "footer"].includes(view) ? (
                  <>
                    <label className="field-label">Text</label>
                    <input
                      aria-label="Text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Page {page} of {pages}"
                    />
                    <p className="help-text">
                      Use {"{page}"} for the page number and {"{pages}"} for the
                      total.
                    </p>
                    <label className="field-label">Font size</label>
                    <input
                      aria-label="Font size"
                      type="number"
                      min="4"
                      max="96"
                      value={size}
                      onChange={(event) => setSize(Number(event.target.value))}
                    />
                    <button
                      className="wide-button primary"
                      disabled={busy || !name}
                      onClick={() =>
                        mutate({
                          operation: view,
                          text: name,
                          fontSize: size,
                          pages: allPages
                            ? doc.pages.map((item) => item.index)
                            : [page],
                        })
                      }
                    >
                      Add {view}
                    </button>
                  </>
                ) : (
                  <>
                    <label className="field-label">Image</label>
                    <input
                      aria-label="Image"
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={(event) =>
                        setFile(event.target.files?.[0] || null)
                      }
                    />
                    {view === "stamp" && placement}
                    <button
                      className="wide-button primary"
                      disabled={busy || !file}
                      onClick={() =>
                        run(async () => {
                          const result = await api<DocumentInfo>(
                            base + "/tools",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                operation: view,
                                content: await encode(file!),
                                pages: allPages
                                  ? doc.pages.map((item) => item.index)
                                  : [page],
                                ...(view === "stamp" ? { rect: bounds } : {}),
                              }),
                            },
                          );
                          onChange(result);
                          onClose();
                        })
                      }
                    >
                      Add {view}
                    </button>
                  </>
                )}
              </>
            )}

            {view === "forms" && (
              <>
                {fields.length === 0 && !busy && (
                  <p className="help-text">
                    This document has no fillable fields. Create a form field to
                    add one.
                  </p>
                )}
                {fields.map((field) => (
                  <label className="form-field" key={field.name}>
                    <span>
                      {field.label || field.name}
                      <small>Page {field.page + 1}</small>
                    </span>
                    {field.kind.toLowerCase() === "checkbox" ? (
                      <input
                        type="checkbox"
                        checked={
                          values[field.name] === true ||
                          values[field.name] === "Yes"
                        }
                        onChange={(event) =>
                          setValues({
                            ...values,
                            [field.name]: event.target.checked,
                          })
                        }
                      />
                    ) : field.choices?.length ? (
                      <select
                        value={String(values[field.name] || "")}
                        onChange={(event) =>
                          setValues({
                            ...values,
                            [field.name]: event.target.value,
                          })
                        }
                      >
                        <option value="">Selectâ€¦</option>
                        {field.choices.map((choice) => (
                          <option key={choice}>{choice}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        disabled={
                          field.kind.toLowerCase() === "signature" ||
                          !!(field.flags & 1)
                        }
                        value={String(values[field.name] || "")}
                        onChange={(event) =>
                          setValues({
                            ...values,
                            [field.name]: event.target.value,
                          })
                        }
                      />
                    )}
                  </label>
                ))}
                {fields.length > 0 && (
                  <>
                    <button
                      className="wide-button primary"
                      disabled={busy}
                      onClick={() =>
                        mutate({ operation: "fill_forms", values })
                      }
                    >
                      Save form
                    </button>
                    <button
                      className="wide-button"
                      disabled={busy}
                      onClick={() => mutate({ operation: "flatten_forms" })}
                    >
                      Make fields permanent
                    </button>
                  </>
                )}
              </>
            )}
            {view === "field" && (
              <>
                <label className="field-label">Field name</label>
                <input
                  aria-label="Field name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <label className="field-label">Type</label>
                <select
                  aria-label="Type"
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                >
                  {["text", "checkbox", "dropdown", "list", "signature"].map(
                    (type) => (
                      <option key={type} value={type}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </option>
                    ),
                  )}
                </select>
                {["dropdown", "list"].includes(kind) && (
                  <>
                    <label className="field-label">Choices, one per line</label>
                    <textarea
                      aria-label="Choices, one per line"
                      value={choices}
                      onChange={(event) => setChoices(event.target.value)}
                      rows={3}
                    />
                  </>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={required}
                    onChange={(event) => setRequired(event.target.checked)}
                  />
                  Required
                </label>
                {placement}
                <button
                  className="wide-button primary"
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    mutate({
                      operation: "create_field",
                      page,
                      rect: bounds,
                      name,
                      label: name,
                      kind,
                      required,
                      choices: choices.split("\n").filter(Boolean),
                    })
                  }
                >
                  Create field
                </button>
              </>
            )}
            {view === "replace" && (
              <>
                <label className="field-label">Find</label>
                <input
                  aria-label="Find"
                  value={find}
                  onChange={(event) => setFind(event.target.value)}
                />
                <label className="field-label">Replace with</label>
                <input
                  aria-label="Replace with"
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                />
                <label className="field-label">Font size</label>
                <input
                  aria-label="Font size"
                  type="number"
                  value={size}
                  min="4"
                  max="96"
                  onChange={(event) => setSize(Number(event.target.value))}
                />
                <p className="help-text">
                  Matches are replaced using Helvetica. Review the result before
                  saving your copy.
                </p>
                <button
                  className="wide-button primary"
                  disabled={busy || !find}
                  onClick={() =>
                    mutate({
                      operation: "find_replace",
                      find,
                      replacement,
                      fontSize: size,
                    })
                  }
                >
                  Replace all
                </button>
              </>
            )}
            {view === "image" && (
              <>
                <label className="field-label">Image</label>
                <input
                  aria-label="Image"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
                {placement}
                <button
                  className="wide-button primary"
                  disabled={busy || !file}
                  onClick={() =>
                    run(async () => {
                      const next = await api<DocumentInfo>(base + "/tools", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          operation: "image",
                          page,
                          rect: bounds,
                          content: await encode(file!),
                        }),
                      });
                      onChange(next);
                      onClose();
                    })
                  }
                >
                  Insert image
                </button>
              </>
            )}
            {view === "link" && (
              <>
                <label className="field-label">Link to</label>
                <select
                  aria-label="Link to"
                  value={linkKind}
                  onChange={(event) => setLinkKind(event.target.value)}
                >
                  <option value="website">Website</option>
                  <option value="page">Page in this document</option>
                </select>
                {linkKind === "website" ? (
                  <>
                    <label className="field-label">URL</label>
                    <input
                      aria-label="URL"
                      type="url"
                      placeholder="https://"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <label className="field-label">Page</label>
                    <input
                      aria-label="Page"
                      type="number"
                      min="1"
                      max={doc.pageCount}
                      value={targetPage}
                      onChange={(event) =>
                        setTargetPage(Number(event.target.value))
                      }
                    />
                  </>
                )}
                {placement}
                <button
                  className="wide-button primary"
                  disabled={busy || (linkKind === "website" && !url)}
                  onClick={() =>
                    mutate({
                      operation: "link",
                      page,
                      rect: bounds,
                      ...(linkKind === "website"
                        ? { url }
                        : { targetPage: targetPage - 1 }),
                    })
                  }
                >
                  Add link
                </button>
              </>
            )}
            {view === "bookmarks" && (
              <>
                <div className="bookmarks-list">
                  {bookmarks.map((bookmark, index) => (
                    <div key={index}>
                      <input
                        aria-label={`Bookmark ${index + 1} title`}
                        value={bookmark[1]}
                        onChange={(event) =>
                          setBookmarks((current) =>
                            current.map((item, i) =>
                              i === index
                                ? [item[0], event.target.value, item[2]]
                                : item,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label={`Bookmark ${index + 1} page`}
                        type="number"
                        min="1"
                        max={doc.pageCount}
                        value={bookmark[2]}
                        onChange={(event) =>
                          setBookmarks((current) =>
                            current.map((item, i) =>
                              i === index
                                ? [item[0], item[1], Number(event.target.value)]
                                : item,
                            ),
                          )
                        }
                      />
                      <button
                        aria-label={`Delete bookmark ${index + 1}`}
                        onClick={() =>
                          setBookmarks((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="wide-button"
                  onClick={() =>
                    setBookmarks((current) => [
                      ...current,
                      [1, "Bookmark", page + 1],
                    ])
                  }
                >
                  Add bookmark
                </button>
                <button
                  className="wide-button primary"
                  disabled={busy}
                  onClick={() => mutate({ operation: "bookmarks", bookmarks })}
                >
                  Save bookmarks
                </button>
              </>
            )}
            {view === "attachment" && (
              <>
                {attachments.map((attachment) => (
                  <a
                    className="split-file"
                    key={attachment.name}
                    href={
                      "/api" +
                      base +
                      "/attachments/" +
                      encodeURIComponent(attachment.name)
                    }
                    download={attachment.filename}
                  >
                    <Paperclip size={15} />
                    {attachment.filename || attachment.name}
                    <Download size={15} />
                  </a>
                ))}
                <label className="field-label">Attach a file</label>
                <input
                  aria-label="Attach a file"
                  type="file"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
                <button
                  className="wide-button primary"
                  disabled={busy || !file}
                  onClick={() =>
                    run(async () => {
                      const next = await api<DocumentInfo>(base + "/edit", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          operation: "attachment",
                          name: file!.name,
                          content: await encode(file!),
                        }),
                      });
                      onChange(next);
                      onClose();
                    })
                  }
                >
                  Attach file
                </button>
              </>
            )}
            {view === "ocr" && (
              <>
                <label className="field-label">Language</label>
                <select
                  aria-label="Language"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  <option value="eng">English</option>
                  <option value="fra">French</option>
                  <option value="spa">Spanish</option>
                  <option value="deu">German</option>
                </select>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={allPages}
                    onChange={(event) => setAllPages(event.target.checked)}
                  />
                  All pages
                </label>
                <p className="help-text">
                  Recognizes text on scanned pages. Tesseract and the selected
                  language need to be installed on this computer.
                </p>
                <button
                  className="wide-button primary"
                  disabled={busy}
                  onClick={() =>
                    mutate(
                      {
                        operation: "ocr",
                        language,
                        pages: allPages ? [] : [page],
                      },
                      "edit",
                    )
                  }
                >
                  Recognize text
                </button>
              </>
            )}
            {view === "compare" && (
              <>
                <label className="field-label">Comparison</label>
                <select
                  aria-label="Comparison"
                  value={compareMode}
                  onChange={(event) => {
                    setCompareMode(event.target.value);
                    setComparison(null);
                  }}
                >
                  <option value="text">Text changes</option>
                  <option value="visual">Visual changes</option>
                </select>
                <label className="field-label">Compare with</label>
                <input
                  aria-label="Compare with"
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] || null);
                    setComparison(null);
                  }}
                />
                <button
                  className="wide-button primary"
                  disabled={busy || !file}
                  onClick={() =>
                    run(async () => {
                      const body = new FormData();
                      body.append("file", file!);
                      const other = await api<DocumentInfo>("/documents", {
                        method: "POST",
                        body,
                      });
                      const result = await api<{
                        differences: NonNullable<typeof comparison>;
                        pageMoves?: { beforePage: number; afterPage: number }[];
                      }>("/compare", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          before: doc.id,
                          after: other.id,
                          mode: compareMode,
                        }),
                      });
                      setComparison(result.differences);
                      setPageMoves(result.pageMoves || []);
                    })
                  }
                >
                  Compare
                </button>
                {comparison && (
                  <div className="comparison">
                    {pageMoves.map((move) => (
                      <p key={`${move.beforePage}-${move.afterPage}`}>
                        Page {move.beforePage + 1} moved to page{" "}
                        {move.afterPage + 1}.
                      </p>
                    ))}
                    {comparison.length === 0 ? (
                      <p>
                        {compareMode === "visual"
                          ? "No visual differences found."
                          : "No text differences found."}
                      </p>
                    ) : (
                      comparison.map((difference, index) => (
                        <section key={index}>
                          <h3>Page {difference.page + 1}</h3>
                          {difference.diffPng && (
                            <img
                              className="visual-diff"
                              src={
                                "data:image/png;base64," + difference.diffPng
                              }
                              alt={
                                "Visual differences on page " +
                                (difference.page + 1)
                              }
                            />
                          )}
                          <small>{difference.status}</small>
                          {difference.changes?.map((change, i) => (
                            <div key={i}>
                              {change.before.length > 0 && (
                                <del>{change.before.join("\n")}</del>
                              )}
                              {change.after.length > 0 && (
                                <ins>{change.after.join("\n")}</ins>
                              )}
                            </div>
                          ))}
                        </section>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
            {["crop", "watermark", "bates"].includes(view) && (
              <>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={allPages}
                    onChange={(event) => setAllPages(event.target.checked)}
                  />
                  All pages
                </label>
                {view === "crop" && placement}
                {view === "watermark" && (
                  <>
                    <label className="field-label">Watermark text</label>
                    <input
                      aria-label="Watermark text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                    <label className="field-label">Opacity</label>
                    <input
                      aria-label="Opacity"
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={opacity}
                      onChange={(event) =>
                        setOpacity(Number(event.target.value))
                      }
                    />
                  </>
                )}
                {view === "bates" && (
                  <>
                    <label className="field-label">Prefix</label>
                    <input
                      aria-label="Prefix"
                      value={prefix}
                      onChange={(event) => setPrefix(event.target.value)}
                    />
                    <label className="field-label">Start number</label>
                    <input
                      aria-label="Start number"
                      type="number"
                      min="0"
                      value={start}
                      onChange={(event) => setStart(Number(event.target.value))}
                    />
                    <label className="field-label">Digits</label>
                    <input
                      aria-label="Digits"
                      type="number"
                      min="1"
                      max="12"
                      value={digits}
                      onChange={(event) =>
                        setDigits(Number(event.target.value))
                      }
                    />
                  </>
                )}
                {view !== "crop" && (
                  <>
                    <label className="field-label">Font size</label>
                    <input
                      aria-label="Font size"
                      type="number"
                      min="4"
                      max="96"
                      value={size}
                      onChange={(event) => setSize(Number(event.target.value))}
                    />
                  </>
                )}
                <button
                  className="wide-button primary"
                  disabled={busy || (view === "watermark" && !name)}
                  onClick={() =>
                    mutate({
                      operation: view,
                      pages: allPages
                        ? doc.pages.map((item) => item.index)
                        : [page],
                      ...(view === "crop"
                        ? { rect: bounds }
                        : view === "watermark"
                          ? { text: name, fontSize: size, opacity }
                          : { prefix, start, digits, fontSize: size }),
                    })
                  }
                >
                  Apply
                </button>
              </>
            )}
            {view === "sanitize" && (
              <>
                <p className="help-text">
                  Remove document metadata and embedded files from a new copy.
                  Review the copy before sharing.
                </p>
                <button
                  className="wide-button primary"
                  disabled={busy}
                  onClick={() => mutate({ operation: "sanitize" })}
                >
                  Remove hidden information
                </button>
              </>
            )}
            {view === "batch" && (
              <>
                <label className="field-label">PDF files</label>
                <input
                  aria-label="PDF files"
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={(event) => {
                    setBatchFiles(Array.from(event.target.files || []));
                    setBatchResults([]);
                  }}
                />
                <label className="field-label">Action</label>
                <select
                  aria-label="Action"
                  value={batchAction}
                  onChange={(event) => setBatchAction(event.target.value)}
                >
                  <option value="sanitize">Remove hidden information</option>
                  <option value="flatten_forms">
                    Make form fields permanent
                  </option>
                  <option value="find_replace">Find and replace</option>
                </select>
                {batchAction === "find_replace" && (
                  <>
                    <label className="field-label">Find</label>
                    <input
                      aria-label="Find"
                      value={find}
                      onChange={(event) => setFind(event.target.value)}
                    />
                    <label className="field-label">Replace with</label>
                    <input
                      aria-label="Replace with"
                      value={replacement}
                      onChange={(event) => setReplacement(event.target.value)}
                    />
                  </>
                )}
                <button
                  className="wide-button primary"
                  disabled={
                    busy ||
                    !batchFiles.length ||
                    (batchAction === "find_replace" && !find)
                  }
                  onClick={() =>
                    run(async () => {
                      const ids: string[] = [];
                      for (const file of batchFiles) {
                        const body = new FormData();
                        body.append("file", file);
                        ids.push(
                          (
                            await api<DocumentInfo>("/documents", {
                              method: "POST",
                              body,
                            })
                          ).id,
                        );
                      }
                      const result = await api<{
                        results: typeof batchResults;
                      }>("/batch", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          ids,
                          actions: [
                            {
                              operation: batchAction,
                              ...(batchAction === "find_replace"
                                ? { find, replacement, fontSize: size }
                                : {}),
                            },
                          ],
                        }),
                      });
                      setBatchResults(result.results);
                    })
                  }
                >
                  Process {batchFiles.length || ""} files
                </button>
                {batchResults.map((result, index) => (
                  <div key={result.source}>
                    {result.document ? (
                      <a
                        className="split-file"
                        href={"/api/documents/" + result.document.id + "/file"}
                        download={result.document.name}
                      >
                        <FileText size={15} />
                        {result.document.name}
                        <Download size={15} />
                      </a>
                    ) : (
                      <p className="tool-error">
                        {batchFiles[index]?.name}: {result.error}
                      </p>
                    )}
                  </div>
                ))}
              </>
            )}
            {view === "extract" && (
              <div className="extract-list">
                {[
                  {
                    path: "/export/xlsx",
                    label: "Tables as Excel",
                    extension: "xlsx",
                  },
                  {
                    path: "/export/pptx",
                    label: "Pages as PowerPoint",
                    extension: "pptx",
                  },
                  {
                    path: "/export/png",
                    label: "Pages as images",
                    extension: "zip",
                  },
                  {
                    path: "/images",
                    label: "Embedded images",
                    extension: "zip",
                  },
                  { path: "/html", label: "HTML text", extension: "html" },
                  {
                    path: "/forms/data",
                    label: "Form data",
                    extension: "json",
                  },
                ].map((item) => (
                  <a
                    key={item.path}
                    href={"/api" + base + item.path}
                    download={
                      doc.name.replace(/\.pdf$/i, "") + "." + item.extension
                    }
                  >
                    <FileText size={17} />
                    {item.label}
                    <Download size={16} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
        {busy && (
          <div className="tool-progress" role="status">
            <LoaderCircle className="spin" size={16} />
            Workingâ€¦
          </div>
        )}
      </section>
    </div>
  );
}
