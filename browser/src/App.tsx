import { useEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  Highlighter,
  Minus,
  MousePointer2,
  PanelLeft,
  PenLine,
  Plus,
  Redo2,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import * as pdf from "./pdf";
import type { Field, Point } from "./pdf";
GlobalWorkerOptions.workerSrc = worker;
type Tool = "select" | "text" | "ink" | "highlight";
function Button({
  title,
  children,
  onClick,
  disabled,
  active,
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      className={"icon-button" + (active ? " active" : "")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function PageCanvas({
  document,
  index,
  scale,
  thumb = false,
  onReady,
}: {
  document: PDFDocumentProxy;
  index: number;
  scale: number;
  thumb?: boolean;
  onReady?: (page: PDFPageProxy, scale: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PDFPageProxy["render"]> | undefined;
    void (async () => {
      const page = await document.getPage(index + 1);
      if (cancelled || !ref.current) return;
      const actual = thumb ? 96 / page.getViewport({ scale: 1 }).width : scale;
      const viewport = page.getViewport({ scale: actual });
      const canvas = ref.current;
      const ratio = Math.min(devicePixelRatio, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      task = page.render({
        canvas,
        canvasContext: canvas.getContext("2d")!,
        viewport,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      await task.promise;
      if (!cancelled) onReady?.(page, actual);
    })().catch((error) => {
      if (error?.name !== "RenderingCancelledException" && !cancelled)
        console.error("Page rendering failed", error);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [document, index, scale, thumb]);
  return (
    <canvas
      ref={ref}
      aria-label={
        thumb ? `Thumbnail of page ${index + 1}` : `Page ${index + 1}`
      }
    />
  );
}
export default function App() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null),
    [loaded, setLoaded] = useState<{
      bytes: Uint8Array;
      document: PDFDocumentProxy;
    } | null>(null);
  // Never render a proxy belonging to a previous revision: its worker is destroyed
  // by the loading effect cleanup when bytes changes.
  const doc = loaded?.bytes === bytes ? loaded.document : null;
  const [name, setName] = useState("Untitled.pdf"),
    [page, setPage] = useState(0),
    [zoom, setZoom] = useState(() => (window.innerWidth < 650 ? 0.38 : 0.95)),
    [busy, setBusy] = useState(false);
  const [past, setPast] = useState<Uint8Array[]>([]),
    [future, setFuture] = useState<Uint8Array[]>([]),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [tool, setTool] = useState<Tool>("select"),
    [text, setText] = useState(""),
    [size, setSize] = useState(16),
    [color, setColor] = useState("#202020");
  const [panel, setPanel] = useState<
      "none" | "document" | "extract" | "forms" | "search"
    >("none"),
    [sidebar, setSidebar] = useState(() => window.innerWidth > 650);
  const [moreTools, setMoreTools] = useState(false);
  const [range, setRange] = useState("1"),
    [formFields, setFormFields] = useState<Field[]>([]),
    [title, setTitle] = useState(""),
    [author, setAuthor] = useState("");
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<{ page: number; text: string }[]>([]);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("folio-theme") || "system",
  );
  const [backend, setBackend] = useState(""),
    [officeOpen, setOfficeOpen] = useState(false),
    [officeFile, setOfficeFile] = useState<File | null>(null),
    [officeError, setOfficeError] = useState("");
  useEffect(() => {
    if (!officeOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector(".office-dialog");
    const first = dialog?.querySelector<HTMLElement>(
      "button:not(:disabled),input:not(:disabled)",
    );
    first?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setOfficeOpen(false);
      if (event.key !== "Tab") return;
      const items = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled)",
        ) ?? [],
      );
      const first = items[0],
        last = items[items.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [officeOpen, busy]);
  const input = useRef<HTMLInputElement>(null),
    mergeInput = useRef<HTMLInputElement>(null),
    currentPage = useRef<PDFPageProxy | null>(null),
    overlay = useRef<SVGSVGElement>(null);
  const [stroke, setStroke] = useState<Point[]>([]);
  const points = useRef<Point[]>([]);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("folio-theme", theme);
  }, [theme]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${import.meta.env.BASE_URL}backend.json`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return;
        const config = await response.json();
        if (typeof config.url === "string" && /^https:\/\//.test(config.url))
          setBackend(config.url.replace(/\/$/, ""));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    currentPage.current = null;
  }, [page, zoom, bytes]);
  useEffect(() => {
    setResults([]);
    if (bytes && panel === "forms") {
      let cancelled = false;
      void pdf
        .fields(bytes)
        .then((values) => {
          if (!cancelled) setFormFields(values);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
  }, [bytes]);
  useEffect(() => {
    if (!bytes) return;
    const options = { data: bytes.slice(), isEvalSupported: false };
    const task = getDocument(options);
    let cancelled = false;
    void task.promise
      .then((document) => {
        if (!cancelled) {
          setLoaded({ bytes, document });
          setPage((p) => Math.min(p, document.numPages - 1));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (past.length) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [past.length]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setError(
        /encrypt|password/i.test(detail)
          ? "Password-protected PDFs are not supported here. Open an unlocked copy."
          : /WinAnsi|encode/i.test(detail)
            ? "This font supports Latin text only. Remove unsupported characters and try again."
            : detail,
      );
    } finally {
      setBusy(false);
    }
  };
  const commit = (next: Uint8Array, status: string) => {
    if (bytes) setPast((p) => [...p.slice(-19), bytes]);
    setFuture([]);
    setBytes(next);
    setMessage(status);
  };
  const openFiles = (files: FileList | File[] | null, append = false) => {
    if (!files?.length) return;
    void run(async () => {
      if (
        !append &&
        bytes &&
        past.length &&
        !window.confirm(
          "Open another document? Download your current changes first if you want to keep them.",
        )
      )
        return;
      const converted: Uint8Array[] = [];
      for (const file of Array.from(files))
        converted.push(await pdf.convert(file));
      if (append && bytes)
        commit(
          await pdf.merge(bytes, converted),
          `${files.length} file${files.length > 1 ? "s" : ""} added`,
        );
      else {
        const next =
          converted.length > 1
            ? await pdf.merge(converted[0], converted.slice(1))
            : converted[0];
        setBytes(next);
        setName(files[0].name.replace(/\.[^.]+$/, "") + ".pdf");
        setPast([]);
        setFuture([]);
        setPage(0);
        setTool("select");
        setPanel("none");
        setMessage(
          converted.length > 1
            ? `${converted.length} files combined`
            : "Opened on this device",
        );
      }
    });
  };
  const undo = () => {
    if (!bytes || !past.length || busy) return;
    setFuture((f) => [bytes, ...f]);
    setBytes(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setMessage("Change undone");
  };
  const redo = () => {
    if (!bytes || !future.length || busy) return;
    setPast((p) => [...p, bytes]);
    setBytes(future[0]);
    setFuture((f) => f.slice(1));
    setMessage("Change restored");
  };
  const action = (kind: Parameters<typeof pdf.pageAction>[2]) =>
    void run(async () => {
      if (!bytes) return;
      commit(await pdf.pageAction(bytes, page, kind), "Page updated");
      if (kind === "up") setPage((p) => Math.max(0, p - 1));
      if (kind === "down" || kind === "duplicate") setPage((p) => p + 1);
    });
  const openPanel = (value: typeof panel) => {
    setPanel(value);
    if (!bytes) return;
    if (value === "forms")
      void run(async () => setFormFields(await pdf.fields(bytes)));
    if (value === "document")
      void run(async () => {
        const loaded = await pdf.load(bytes);
        setTitle(loaded.getTitle() ?? "");
        setAuthor(loaded.getAuthor() ?? "");
      });
  };
  function location(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (busy || tool === "select") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    points.current = [location(event)];
    setStroke(points.current);
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!points.current.length || tool === "text") return;
    const point = location(event);
    points.current =
      tool === "highlight"
        ? [points.current[0], point]
        : [...points.current, point];
    setStroke([...points.current]);
  }
  function pointerUp() {
    const current = points.current;
    points.current = [];
    setStroke([]);
    if (!current.length || !bytes || !currentPage.current || tool === "select")
      return;
    if (tool === "text" && !text.trim()) {
      setError("Enter the text to add in the toolbar, then click the page.");
      return;
    }
    if (tool !== "text" && current.length < 2) return;
    const viewport = currentPage.current.getViewport({ scale: zoom });
    const mapped = current.map((p) => {
      const [x, y] = viewport.convertToPdfPoint(p.x, p.y);
      return { x, y };
    });
    void run(async () =>
      commit(
        await pdf.annotate(bytes, page, tool, mapped, text, size, color),
        tool === "text"
          ? "Text added"
          : tool === "ink"
            ? "Drawing added"
            : "Highlight added",
      ),
    );
  }
  const search = () =>
    void run(async () => {
      if (!doc || !query.trim()) return;
      const found: typeof results = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        const value = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        const at = value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
        if (at >= 0)
          found.push({
            page: i - 1,
            text: value.slice(Math.max(0, at - 45), at + query.length + 90),
          });
      }
      setResults(found);
      setMessage(`${found.length} matching pages`);
    });
  const save = () => {
    if (bytes) {
      pdf.download(bytes, name);
      setMessage("PDF downloaded");
    }
  };
  const convertOffice = () =>
    void run(async () => {
      if (!officeFile || !backend) return;
      setOfficeError("");
      if (officeFile.size > 25 * 1024 * 1024) {
        setOfficeError("Choose a file smaller than 25 MB.");
        return;
      }
      if (
        bytes &&
        past.length &&
        !window.confirm(
          "Replace the current PDF? Download your changes first if you want to keep them.",
        )
      )
        return;
      const body = new FormData();
      body.append("file", officeFile);
      try {
        const response = await fetch(`${backend}/convert`, {
          method: "POST",
          body,
          signal: AbortSignal.timeout(180000),
          credentials: "omit",
        });
        if (!response.ok) {
          if (response.status === 503 || response.status === 429)
            throw new Error(
              "The converter is busy. Wait a moment, then select Convert to try again.",
            );
          let detail = "";
          try {
            const result = await response.json();
            detail = typeof result.detail === "string" ? result.detail : "";
          } catch {}
          throw new Error(
            detail ||
              `Conversion failed (${response.status}). Try again later or use the desktop app.`,
          );
        }
        const data = new Uint8Array(await response.arrayBuffer());
        await pdf.load(data);
        setBytes(data);
        setName(officeFile.name.replace(/\.[^.]+$/, "") + ".pdf");
        setPast([]);
        setFuture([]);
        setPage(0);
        setPanel("none");
        setTool("select");
        setMessage("Office document converted — ready to download");
        setOfficeOpen(false);
        setOfficeFile(null);
      } catch (e) {
        setOfficeError(
          e instanceof Error && e.name === "TimeoutError"
            ? "Conversion timed out. Try a smaller file or use the desktop app."
            : e instanceof TypeError
              ? "The converter is unavailable. Try again later or use the desktop app."
              : e instanceof Error
                ? e.message
                : String(e),
        );
      }
    });
  return (
    <div
      className="app"
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        openFiles(event.dataTransfer.files, !!bytes);
      }}
    >
      <input
        ref={input}
        data-testid="open-input"
        className="hidden"
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
        multiple
        onChange={(e) => {
          openFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={mergeInput}
        data-testid="merge-input"
        className="hidden"
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
        multiple
        onChange={(e) => {
          openFiles(e.target.files, true);
          e.target.value = "";
        }}
      />
      <header className="topbar">
        <a className="brand" href="/" aria-label="Folio home">
          <span className="brand-mark">
            <FileText size={20} />
          </span>
          Folio
        </a>
        <div className="document-name">
          <strong>{bytes ? name : "PDF workspace"}</strong>
          <span>
            {busy
              ? "Working…"
              : bytes
                ? `${doc?.numPages ?? "…"} pages · On this device`
                : "Browser edition"}
          </span>
        </div>
        <div className="top-actions">
          <select
            aria-label="Appearance"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          {backend && (
            <button
              className="office-trigger"
              onClick={() => setOfficeOpen(true)}
              disabled={busy}
            >
              Office to PDF
            </button>
          )}
          <button onClick={() => input.current?.click()} disabled={busy}>
            <FolderOpen size={16} />
            <span>Open</span>
          </button>
          <button className="primary save-button" aria-label="Download PDF" onClick={save} disabled={!bytes || busy}>
            <Download size={16} />
            <span>Download PDF</span>
            <span className="mobile-save">Save</span>
          </button>
        </div>
      </header>
      {bytes && (
        <nav className={`toolbar${moreTools ? " expanded" : ""}`} aria-label="PDF tools">
          <div className="tool-group history-tools">
            <Button
              title="Toggle pages"
              onClick={() => setSidebar(!sidebar)}
              active={sidebar}
            >
              <PanelLeft />
            </Button>
            <Button title="Undo" onClick={undo} disabled={!past.length || busy}>
              <Undo2 />
            </Button>
            <Button
              title="Redo"
              onClick={redo}
              disabled={!future.length || busy}
            >
              <Redo2 />
            </Button>
          </div>
          <div className="tool-group edit-tools">
            {(
              [
                ["select", MousePointer2, "View"],
                ["text", Type, "Add text"],
                ["ink", PenLine, "Draw / sign"],
                ["highlight", Highlighter, "Highlight"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                disabled={busy}
                className={tool === id ? "active" : ""}
                aria-pressed={tool === id}
                onClick={() => {
                  setTool(id);
                  setMoreTools(false);
                  setPanel("none");
                  if (window.innerWidth <= 650) setSidebar(false);
                  if (id === "highlight") setColor("#f4c94f");
                  else setColor("#202020");
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          <button className="more-tools" aria-expanded={moreTools} aria-controls="additional-tools" onClick={() => setMoreTools(!moreTools)}>
            <Settings2 size={16} />{moreTools ? "Less" : "More tools"}
          </button>
          <div className="tool-group additional-tools" id="additional-tools">
            <button disabled={busy} onClick={() => mergeInput.current?.click()}>
              <FilePlus2 size={16} />
              Add files
            </button>
            <button onClick={() => openPanel("extract")}>Extract</button>
            <button onClick={() => openPanel("forms")}>Fill form</button>
            <Button title="Search document" onClick={() => openPanel("search")}>
              <Search />
            </Button>
            <Button
              title="Document settings"
              onClick={() => openPanel("document")}
            >
              <Settings2 />
            </Button>
          </div>
        </nav>
      )}
      {error && (
        <div role="alert" className="alert">
          <span>{error}</span>
          <Button title="Dismiss error" onClick={() => setError("")}>
            <X />
          </Button>
        </div>
      )}
      {!bytes ? (
        <main className="empty">
          <div className="empty-paper">
            <FileText size={48} strokeWidth={1} />
            <span />
            <span />
            <span />
          </div>
          <h1>Your PDF workspace.</h1>
          <p>Read, annotate, fill forms and put pages in order.</p>
          <button
            className="primary open-large"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            <FolderOpen size={18} />
            Open files
          </button>
          <p className="drop-copy">or drop PDFs, images or text files here</p>
          <div className="privacy">
            <ShieldCheck size={16} />
            PDF edits stay in your browser.
          </div>
          <div className="empty-details">
            <span>Combine & extract pages</span>
            <span>Draw & add text</span>
            <span>Images & text to PDF</span>
          </div>
          <p className="desktop-note">
            Need to change existing text?{" "}
            <a href="/">Get the desktop app</a>.
          </p>
        </main>
      ) : (
        <>
          {tool !== "select" && (
            <div className="annotation-bar">
              <p className="editing-hint" role="status">
                {tool === "text" ? (text.trim() ? "Tap the page to place your text." : "Type your text, then tap the page to place it.") : tool === "ink" ? "Draw or sign with your finger. Tap Done to scroll." : "Drag your finger over an area. Tap Done to scroll."}
              </p>
              {tool === "text" ? (
                <input
                  aria-label="Text to add"
                  placeholder="Type your text"
                  enterKeyHint="done"
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              ) : (
                <span>
                  {tool === "ink"
                    ? "Draw on the page to add ink or a handwritten signature."
                    : "Drag over the page to highlight an area."}
                </span>
              )}
              <label>
                {tool === "text" ? "Size" : "Width"}
                <input
                  aria-label="Annotation size"
                  type="number"
                  min={6}
                  max={96}
                  value={size}
                  onChange={(e) =>
                    setSize(Math.max(6, Math.min(96, Number(e.target.value))))
                  }
                />
              </label>
              <input
                aria-label="Annotation color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <button onClick={() => setTool("select")}>Done</button>
            </div>
          )}
          {tool === "select" && <p className="mobile-edit-hint">Choose a tool to edit. Save downloads your PDF.</p>}
          <div className="workspace">
            {sidebar && (
              <aside className="pages">
                <div className="aside-heading">
                  Pages <span>{doc?.numPages}</span>
                </div>
                <div className="thumbnail-list">
                  {doc &&
                    Array.from({ length: doc.numPages }, (_, i) => (
                      <button
                        className={
                          "thumbnail " + (i === page ? "selected" : "")
                        }
                        key={`${i}-${doc.fingerprints[0]}`}
                        onClick={() => {
                          setPage(i);
                          currentPage.current = null;
                        }}
                        aria-label={`Go to page ${i + 1}`}
                        aria-current={i === page ? "page" : undefined}
                      >
                        {Math.abs(i - page) < 10 ? (
                          <PageCanvas
                            document={doc}
                            index={i}
                            scale={1}
                            thumb
                          />
                        ) : (
                          <div className="thumbnail-placeholder" />
                        )}
                        <span>{i + 1}</span>
                      </button>
                    ))}
                </div>
              </aside>
            )}
            <main className="viewer">
              <div className="page-controls">
                <div className="tool-group">
                  <Button
                    title="Previous page"
                    disabled={page === 0 || busy}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft />
                  </Button>
                  <span>
                    {page + 1} / {doc?.numPages ?? "…"}
                  </span>
                  <Button
                    title="Next page"
                    disabled={!doc || page >= doc.numPages - 1 || busy}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight />
                  </Button>
                </div>
                <div className="tool-group">
                  <Button
                    title="Zoom out"
                    onClick={() => setZoom((z) => Math.max(0.25, z - 0.15))}
                  >
                    <Minus />
                  </Button>
                  <button onClick={() => setZoom(0.95)} title="Reset zoom">
                    {Math.round(zoom * 100)}%
                  </button>
                  <Button
                    title="Zoom in"
                    onClick={() => setZoom((z) => Math.min(3, z + 0.15))}
                  >
                    <Plus />
                  </Button>
                </div>
              </div>
              <div className="page-scroll">
                <div
                  className={"paper " + (tool !== "select" ? "annotating" : "")}
                >
                  {doc && (
                    <PageCanvas
                      document={doc}
                      index={page}
                      scale={zoom}
                      onReady={(p) => {
                        currentPage.current = p;
                      }}
                    />
                  )}
                  <svg
                    ref={overlay}
                    className="annotation-overlay"
                    style={{
                      pointerEvents: tool === "select" ? "none" : "auto",
                    }}
                    onPointerDown={pointerDown}
                    onPointerMove={pointerMove}
                    onPointerUp={pointerUp}
                    onPointerCancel={() => {
                      points.current = [];
                      setStroke([]);
                    }}
                  >
                    {stroke.length > 1 &&
                      (tool === "highlight" ? (
                        <rect
                          x={Math.min(stroke[0].x, stroke[1].x)}
                          y={Math.min(stroke[0].y, stroke[1].y)}
                          width={Math.abs(stroke[0].x - stroke[1].x)}
                          height={Math.abs(stroke[0].y - stroke[1].y)}
                          fill={color}
                          opacity={0.3}
                        />
                      ) : (
                        <polyline
                          points={stroke.map((p) => `${p.x},${p.y}`).join(" ")}
                          stroke={color}
                          strokeWidth={(size / 8) * zoom}
                          fill="none"
                        />
                      ))}
                  </svg>
                </div>
              </div>
              <div className="page-actions">
                <Button
                  title="Move page earlier"
                  disabled={busy || page === 0}
                  onClick={() => action("up")}
                >
                  <ArrowUp />
                </Button>
                <Button
                  title="Move page later"
                  disabled={busy || !doc || page === doc.numPages - 1}
                  onClick={() => action("down")}
                >
                  <ArrowDown />
                </Button>
                <Button
                  title="Rotate page"
                  disabled={busy}
                  onClick={() => action("rotate")}
                >
                  <RotateCw />
                </Button>
                <Button
                  title="Duplicate page"
                  disabled={busy}
                  onClick={() => action("duplicate")}
                >
                  <Copy />
                </Button>
                <Button
                  title="Delete page"
                  disabled={busy || doc?.numPages === 1}
                  onClick={() => action("delete")}
                >
                  <Trash2 />
                </Button>
                <span>Page {page + 1}</span>
              </div>
            </main>
            {panel !== "none" && (
              <aside className="inspector">
                <div className="aside-heading">
                  {
                    {
                      document: "Document",
                      extract: "Extract pages",
                      forms: "Fill form",
                      search: "Search",
                    }[panel]
                  }
                  <Button title="Close panel" onClick={() => setPanel("none")}>
                    <X />
                  </Button>
                </div>
                {panel === "extract" && (
                  <>
                    <p>
                      Save selected pages as a separate PDF. The current
                      document stays open.
                    </p>
                    <label>
                      Pages
                      <input
                        value={range}
                        onChange={(e) => setRange(e.target.value)}
                        placeholder="1, 3-5"
                      />
                    </label>
                    <small>
                      Use commas and ranges, for example 1, 3-5. Form values are
                      preserved as non-editable page content.
                    </small>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          pdf.download(
                            await pdf.extract(
                              bytes,
                              pdf.parsePages(range, doc!.numPages),
                            ),
                            name.replace(/\.pdf$/i, "-extracted.pdf"),
                          );
                          setMessage("Extracted PDF downloaded");
                        })
                      }
                    >
                      Download selected pages
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const selected = pdf.parsePages(range, doc!.numPages);
                          if (
                            selected.length > 1 &&
                            !window.confirm(
                              `Download ${selected.length} separate PDFs? Your browser may ask to allow multiple downloads.`,
                            )
                          )
                            return;
                          for (const i of selected)
                            pdf.download(
                              await pdf.extract(bytes, [i]),
                              name.replace(/\.pdf$/i, `-page-${i + 1}.pdf`),
                            );
                          setMessage("Individual pages downloaded");
                        })
                      }
                    >
                      Download each page separately
                    </button>
                  </>
                )}
                {panel === "document" && (
                  <>
                    <label>
                      Filename
                      <input
                        value={name}
                        onChange={(e) =>
                          setName(
                            e.target.value.replace(/[\\/:*?"<>|]/g, "") ||
                              "Untitled.pdf",
                          )
                        }
                      />
                    </label>
                    <label>
                      Title
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </label>
                    <label>
                      Author
                      <input
                        value={author}
                        onChange={(e) => setAuthor(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () =>
                          commit(
                            await pdf.transform(bytes, (d) => {
                              d.setTitle(title);
                              d.setAuthor(author);
                            }),
                            "Document details updated",
                          ),
                        )
                      }
                    >
                      Apply details
                    </button>
                    <hr />
                    <h3>Flatten forms</h3>
                    <p>
                      Make filled form fields part of the page. They will no
                      longer be editable fields.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () =>
                          commit(
                            await pdf.transform(bytes, (d) =>
                              d.getForm().flatten(),
                            ),
                            "Form fields flattened",
                          ),
                        )
                      }
                    >
                      Flatten form fields
                    </button>
                    <hr />
                    <h3>Export this page</h3>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const p = await doc!.getPage(page + 1);
                          const viewport = p.getViewport({ scale: 2 });
                          const canvas = document.createElement("canvas");
                          canvas.width = viewport.width;
                          canvas.height = viewport.height;
                          await p.render({
                            canvas,
                            canvasContext: canvas.getContext("2d")!,
                            viewport,
                          }).promise;
                          const blob = await new Promise<Blob>((resolve) =>
                            canvas.toBlob((b) => resolve(b!), "image/png"),
                          );
                          pdf.download(
                            new Uint8Array(await blob.arrayBuffer()),
                            `page-${page + 1}.png`,
                            "image/png",
                          );
                          setMessage("Page image downloaded");
                        })
                      }
                    >
                      Download PNG
                    </button>
                  </>
                )}
                {panel === "forms" && (
                  <>
                    {formFields.length ? (
                      <>
                        <p>
                          Edit the document’s interactive fields, then apply
                          your changes.
                        </p>
                        {formFields.map((field, i) => (
                          <label key={field.name}>
                            {field.name}
                            {field.kind === "check" ? (
                              <input
                                type="checkbox"
                                checked={!!field.value}
                                disabled={field.readonly}
                                onChange={(e) =>
                                  setFormFields((f) =>
                                    f.map((v, j) =>
                                      j === i
                                        ? { ...v, value: e.target.checked }
                                        : v,
                                    ),
                                  )
                                }
                              />
                            ) : field.kind === "choice" ? (
                              <select
                                value={String(field.value)}
                                disabled={field.readonly}
                                onChange={(e) =>
                                  setFormFields((f) =>
                                    f.map((v, j) =>
                                      j === i
                                        ? { ...v, value: e.target.value }
                                        : v,
                                    ),
                                  )
                                }
                              >
                                <option value="">Choose…</option>
                                {field.options?.map((option) => (
                                  <option key={option}>{option}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                value={String(field.value)}
                                disabled={field.readonly}
                                onChange={(e) =>
                                  setFormFields((f) =>
                                    f.map((v, j) =>
                                      j === i
                                        ? { ...v, value: e.target.value }
                                        : v,
                                    ),
                                  )
                                }
                              />
                            )}
                          </label>
                        ))}
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () =>
                              commit(
                                await pdf.fill(bytes, formFields),
                                "Form changes applied",
                              ),
                            )
                          }
                        >
                          Apply form changes
                        </button>
                      </>
                    ) : (
                      <>
                        <p>No supported interactive fields in this PDF.</p>
                        <button
                          onClick={() => {
                            setTool("text");
                            setPanel("none");
                          }}
                        >
                          Add text to the page
                        </button>
                      </>
                    )}
                  </>
                )}
                {panel === "search" && (
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        search();
                      }}
                    >
                      <label>
                        Find text
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search this PDF"
                        />
                      </label>
                      <button
                        disabled={busy || !query.trim()}
                        className="primary"
                      >
                        Search
                      </button>
                    </form>
                    <p>
                      Search finds embedded text. Scanned pages need OCR in the
                      desktop app.
                    </p>
                    {results.map((result) => (
                      <button
                        className="search-result"
                        key={result.page}
                        onClick={() => setPage(result.page)}
                      >
                        <strong>Page {result.page + 1}</strong>
                        <span>{result.text}</span>
                      </button>
                    ))}
                  </>
                )}
              </aside>
            )}
          </div>
          <footer>
            <span role="status" aria-live="polite">
              {busy ? "Working…" : message || "Ready"}
            </span>
            <span>
              <ShieldCheck size={13} />
              Local processing
            </span>
          </footer>
        </>
      )}
      {officeOpen && (
        <div className="dialog-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="office-title"
            className="office-dialog"
          >
            <div className="aside-heading">
              <h2 id="office-title">Office to PDF</h2>
              <Button
                title="Close conversion"
                disabled={busy}
                onClick={() => setOfficeOpen(false)}
              >
                <X />
              </Button>
            </div>
            <p>
              Word, Excel, PowerPoint and OpenDocument files need the conversion
              server. Selecting Convert uploads only the file you choose here.
            </p>
            <p>
              Up to 25 MB. Files are processed one at a time and removed after
              conversion. PDF editing, images and text stay local.
            </p>
            <label>
              Office document
              <input
                type="file"
                accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf"
                onChange={(e) => {
                  setOfficeFile(e.target.files?.[0] ?? null);
                  setOfficeError("");
                }}
                disabled={busy}
              />
            </label>
            {officeError && (
              <p role="alert" className="office-error">
                {officeError}
              </p>
            )}
            <button
              className="primary"
              disabled={!officeFile || busy}
              onClick={convertOffice}
            >
              {busy ? "Converting…" : "Convert to PDF"}
            </button>
          </section>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay" onDragLeave={() => setDragging(false)}>
          <FilePlus2 size={38} />
          <h2>{bytes ? "Add files to this PDF" : "Open your files"}</h2>
          <p>PDF, PNG, JPEG, WebP or TXT</p>
        </div>
      )}
    </div>
  );
}
