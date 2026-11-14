import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FilePlus2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useDialog } from "./useDialog";
import "./conversion.css";

type DocumentInfo = {
  id: string;
  name: string;
  pageCount: number;
  pages: { index: number; width: number; height: number; rotation: number }[];
  metadata: Record<string, string>;
};
type Format = {
  extensions: string[];
  label: string;
  available: boolean;
  engine: string;
};
type Conversion = {
  documents: DocumentInfo[];
  results: {
    name: string;
    status: "converted" | "error";
    error?: string;
    pages?: number;
  }[];
  mode: string;
};
export default function ConvertToPdf({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (document: DocumentInfo) => void;
}) {
  const [formats, setFormats] = useState<Format[]>([]),
    [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [files, setFiles] = useState<{ id: number; file: File }[]>([]),
    sequence = useRef(0);
  const [mode, setMode] = useState("separate"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<Conversion | null>(null),
    [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    working = useRef(false);
  useDialog(true, () => {
    if (!working.current) onClose();
  });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/conversion/formats", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            typeof data.detail === "string"
              ? data.detail
              : "Could not load available formats.",
          );
        setFormats(data.formats);
        setNotes(data.notes || []);
        setLoaded(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, []);
  function add(incoming: FileList | File[]) {
    if (working.current) return;
    const added = Array.from(incoming, (file) => ({
      id: ++sequence.current,
      file,
    }));
    setFiles((previous) => [...previous, ...added]);
    setResult(null);
    setError("");
  }
  function move(index: number, direction: number) {
    setFiles((previous) => {
      const next = [...previous];
      [next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ];
      return next;
    });
    setResult(null);
  }
  async function convert() {
    if (working.current || !files.length) return;
    working.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const body = new FormData();
      for (const item of files) body.append("files", item.file);
      body.append("mode", mode);
      const response = await fetch("/api/convert", { method: "POST", body });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "These files could not be converted. Check their formats and sizes.",
        );
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const available = formats.filter((format) => format.available),
    unavailable = formats.filter((format) => !format.available);
  const accept = available
    .flatMap((format) =>
      format.extensions.map((extension) =>
        extension.startsWith(".") ? extension : `.${extension}`,
      ),
    )
    .join(",");
  return (
    <div
      className="modal-backdrop conversion-backdrop"
      onDragEnter={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <section
        className="conversion-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversion-title"
      >
        <header>
          <div>
            <h2 id="conversion-title">Convert to PDF</h2>
            <p>Bring your files together. Keep them yours.</p>
          </div>
          <button
            className="icon-button"
            aria-label="Close conversion"
            disabled={busy}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="conversion-content">
          <input
            ref={input}
            type="file"
            multiple
            accept={accept || undefined}
            aria-label="Files to convert"
            hidden
            onChange={(event) => {
              if (event.target.files) add(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            className={`conversion-drop ${dragging ? "dragging" : ""}`}
            disabled={busy || !loaded}
            onClick={() => input.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragging(false);
              add(event.dataTransfer.files);
            }}
          >
            <FilePlus2 size={27} />
            <strong>{files.length ? "Add more files" : "Choose files"}</strong>
            <span>or drop several files here</span>
          </button>
          <div className="conversion-formats">
            <p>
              {loaded
                ? available.map((format) => format.label).join(" · ")
                : "Checking available formats…"}
            </p>
            {unavailable.length > 0 && (
              <details>
                <summary>Other formats</summary>
                {unavailable.map((format) => (
                  <p key={format.label}>
                    {format.label}: requires {format.engine}.
                  </p>
                ))}
              </details>
            )}
            <p>
              Free conversion on your Folio server. No paid conversion service.
            </p>
            {notes.length > 0 && (
              <details>
                <summary>About these conversions</summary>
                {notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </details>
            )}
          </div>
          {error && (
            <div className="conversion-error" role="alert">
              {error}
            </div>
          )}
          {files.length > 0 && (
            <>
              <div className="conversion-queue-heading">
                <h3>
                  {files.length} {files.length === 1 ? "file" : "files"}
                </h3>
                <button
                  disabled={busy}
                  onClick={() => {
                    setFiles([]);
                    setResult(null);
                  }}
                >
                  Clear list
                </button>
              </div>
              <ol className="conversion-queue">
                {files.map((item, index) => (
                  <li key={item.id} data-file-name={item.file.name}>
                    <span className="conversion-order">{index + 1}</span>
                    <div>
                      <strong>{item.file.name}</strong>
                      <small>
                        {item.file.size < 1048576
                          ? `${Math.ceil(item.file.size / 1024)} KB`
                          : `${(item.file.size / 1048576).toFixed(1)} MB`}
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Move ${item.file.name} up`}
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Move ${item.file.name} down`}
                      disabled={busy || index === files.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${item.file.name}`}
                      disabled={busy}
                      onClick={() => {
                        setFiles(files.filter((file) => file.id !== item.id));
                        setResult(null);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ol>
              <fieldset className="conversion-mode" disabled={busy}>
                <legend>Make</legend>
                <label>
                  <input
                    type="radio"
                    name="conversion-mode"
                    checked={mode === "separate"}
                    onChange={() => {
                      setMode("separate");
                      setResult(null);
                    }}
                  />{" "}
                  A PDF for each file
                </label>
                <label>
                  <input
                    type="radio"
                    name="conversion-mode"
                    checked={mode === "combine"}
                    onChange={() => {
                      setMode("combine");
                      setResult(null);
                    }}
                  />{" "}
                  One combined PDF, in this order
                </label>
              </fieldset>
            </>
          )}
          {result && (
            <section
              className="conversion-results"
              aria-label="Conversion results"
            >
              <h3>
                {result.documents.length
                  ? "Your PDFs are ready"
                  : "No files converted"}
              </h3>
              {result.results.map((item, index) => (
                <div
                  key={index}
                  className={
                    item.status === "error"
                      ? "conversion-error"
                      : "conversion-file-status"
                  }
                >
                  <strong>{item.name}</strong>
                  <span>
                    {item.status === "error"
                      ? item.error || "Could not convert this file."
                      : `Converted${item.pages ? ` · ${item.pages} ${item.pages === 1 ? "page" : "pages"}` : ""}`}
                  </span>
                </div>
              ))}
              {result.documents.map((document) => (
                <div className="conversion-output" key={document.id}>
                  <div>
                    <strong>{document.name}</strong>
                    <small>
                      {document.pageCount}{" "}
                      {document.pageCount === 1 ? "page" : "pages"}
                    </small>
                  </div>
                  <button onClick={() => onOpen(document)}>Open PDF</button>
                  <a
                    aria-label={`Download ${document.name}`}
                    href={`/api/documents/${document.id}/file`}
                    download
                  >
                    <Download size={17} />
                  </a>
                </div>
              ))}
            </section>
          )}
        </div>
        <footer>
          <span role="status">
            {busy
              ? "Converting your files…"
              : result
                ? "Converted PDFs are also saved in your Library."
                : "Original files stay unchanged."}
          </span>
          <button
            className="conversion-submit"
            disabled={busy || !files.length || !loaded}
            onClick={convert}
          >
            <Plus size={16} />
            {busy
              ? "Converting…"
              : mode === "combine"
                ? "Create combined PDF"
                : "Convert files"}
          </button>
        </footer>
      </section>
    </div>
  );
}
