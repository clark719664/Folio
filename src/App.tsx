import SharedWorkspace from "./SharedWorkspace";
import ConvertToPdf from "./ConvertToPdf";
import TextLayer from "./TextLayer";
import { useAppearance } from "./appearance";
import { useDialog } from "./useDialog";
import AdvancedTools from "./AdvancedTools";
import LibraryPanel from "./LibraryPanel";
import { readSession, writeSession, clearSession, exportName } from "./session";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  Highlighter,
  Menu,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Redo2,
  RotateCw,
  Search,
  Settings2,
  Shield,
  StickyNote,
  Trash2,
  Undo2,
  X,
  ScanLine,
  Type,
  Heart,
  Layers,
  Printer,
  Library,
  LoaderCircle,
} from "lucide-react";
type Page = {
  index: number;
  width: number;
  height: number;
  rotation: number;
};
type DocumentInfo = {
  id: string;
  name: string;
  pageCount: number;
  pages: Page[];
  metadata: Record<string, string>;
};
type Span = {
  text: string;
  bbox: number[];
  font: string;
  size: number;
  color: number;
  block?: number;
  line?: number;
};
type Tool = "read" | "text" | "highlight" | "note" | "redact";
const API = "/api";
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(API + url, options);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("folio-auth-required"));
    const body = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    throw Object.assign(
      new Error(
        typeof body.detail === "string"
          ? body.detail
          : "The file could not be processed. Check the selected values.",
      ),
      { status: response.status },
    );
  }
  return response.json();
}
function IconButton({
  label,
  children,
  active = false,
  ...props
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`icon-button ${active ? "active" : ""} ${props.className || ""}`}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
function spanStyle(span: Span, page: Page) {
  const [x0, y0, x1, y1] = span.bbox;
  const rotation = ((page.rotation % 360) + 360) % 360;
  const bounds =
    rotation === 90
      ? [page.height - y1, x0, page.height - y0, x1]
      : rotation === 180
        ? [page.width - x1, page.height - y1, page.width - x0, page.height - y0]
        : rotation === 270
          ? [y0, page.width - x1, y1, page.width - x0]
          : span.bbox;
  const width = rotation % 180 ? page.height : page.width;
  const height = rotation % 180 ? page.width : page.height;
  return {
    left: `${(bounds[0] / width) * 100}%`,
    top: `${(bounds[1] / height) * 100}%`,
    width: `${((bounds[2] - bounds[0]) / width) * 100}%`,
    height: `${((bounds[3] - bounds[1]) / height) * 100}%`,
  };
}
export default function App() {
  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const documentLoad = useRef(0);
  const [authenticationVersion, setAuthenticationVersion] = useState(0);
  useEffect(() => {
    const signIn = () => setShared(true);
    const authenticated = () => setAuthenticationVersion(value => value + 1);
    const clearLocal = () => { setDoc(null); setHistory([]); setFuture([]); setSpans([]); clearSession(); };
    window.addEventListener("folio-auth-required", signIn);
    window.addEventListener("folio-local-session-ended", clearLocal);
    window.addEventListener("folio-owner-authenticated", authenticated);
    return () => { window.removeEventListener("folio-auth-required", signIn); window.removeEventListener("folio-local-session-ended", clearLocal); window.removeEventListener("folio-owner-authenticated", authenticated); };
  }, []);
  const [history, setHistory] = useState<DocumentInfo[]>([]);
  const [future, setFuture] = useState<DocumentInfo[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const pageViewport = useRef<HTMLDivElement>(null);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 700);
  const [tool, setTool] = useState<Tool>("read");
  const [spans, setSpans] = useState<Span[]>([]);
  const [selected, setSelected] = useState<Span | null>(null);
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(12);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);
  const [appearance, setAppearance] = useAppearance();
  const [advanced, setAdvanced] = useState(false);
  const [library, setLibrary] = useState(false);
  const [conversion, setConversion] = useState(false);
  const [shared, setShared] = useState(() => new URLSearchParams(location.search).has("invite"));
  const [modal, setModal] = useState<
    "properties" | "password" | "unlock" | "export" | null
  >(null);
  const [password, setPassword] = useState("");
  const [lockedDocumentId, setLockedDocumentId] = useState<string | null>(null);
  const [ownerPassword, setOwnerPassword] = useState("");
  const [permissions, setPermissions] = useState([
    "print",
    "copy",
    "annotate",
    "fill",
    "modify",
    "assemble",
    "accessibility",
  ]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchPages, setSearchPages] = useState<
    { page: number; spans: Span[] }[]
  >([]);
  const [indexing, setIndexing] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [splitFiles, setSplitFiles] = useState<DocumentInfo[]>([]);
  useDialog(!!modal, () => setModal(null));
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const lockedFile = useRef<File | null>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const page = doc?.pages[pageIndex];
  useEffect(() => {
    const saved = readSession();
    if (!saved) return;
    const controller = new AbortController();
    const load = ++documentLoad.current;
    request<DocumentInfo>(`/documents/${saved.documentId}`, {
      signal: controller.signal,
    })
      .then((next) => {
        if (load !== documentLoad.current) return;
        setDoc(next);
        setError("");
        setPageIndex(Math.min(saved.page, Math.max(0, next.pageCount - 1)));
        setZoom(saved.zoom);
        setFitWidth(saved.fitWidth);
      })
      .catch((error) => {
        if (controller.signal.aborted || load !== documentLoad.current) return;
        if (error.status === 404) {
          clearSession();
          setError(
            "The previous document is no longer available. Open it again to continue.",
          );
        } else
          setError(
            "Unable to reopen the previous document. Check the local PDF service and reload.",
          );
      });
    return () => controller.abort();
  }, [authenticationVersion]);
  useEffect(() => {
    if (doc)
      writeSession({ documentId: doc.id, page: pageIndex, zoom, fitWidth });
  }, [doc?.id, pageIndex, zoom, fitWidth]);
  useEffect(() => {
    if (!doc || !page || !fitWidth || !pageViewport.current) return;
    const element = pageViewport.current;
    const fit = () => {
      const padding = window.innerWidth <= 700 ? 30 : 76;
      const paperWidth = page.rotation % 180 ? page.height : page.width;
      setZoom(
        Math.min(
          3,
          Math.max(0.15, (element.clientWidth - padding) / paperWidth),
        ),
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    return () => observer.disconnect();
  }, [doc?.id, pageIndex, fitWidth, sidebar]);
  const base = doc ? `/documents/${doc.id}` : "";
  useEffect(() => {
    if (!doc) return;
    const controller = new AbortController();
    setSelected(null);
    setSpans([]);
    request<{
      spans: Span[];
    }>(`${base}/pages/${pageIndex}/text`, { signal: controller.signal })
      .then((data) => setSpans(data.spans))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [doc?.id, pageIndex]);
  useEffect(() => {
    if (!searchOpen || !doc) return;
    const controller = new AbortController();
    setSearchPages([]);
    setIndexing(true);
    const index = async () => {
      try {
        for (const page of doc.pages) {
          const data = await request<{ spans: Span[] }>(
            `${base}/pages/${page.index}/text`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          setSearchPages((current) => [
            ...current,
            { page: page.index, spans: data.spans },
          ]);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Search could not finish",
          );
      } finally {
        if (!controller.signal.aborted) setIndexing(false);
      }
    };
    index();
    return () => controller.abort();
  }, [searchOpen, doc?.id]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector(".shared-workspace, .conversion-dialog")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "o") {
        e.preventDefault();
        input.current?.click();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSelected(null);
        setMenu(false);
        setModal(null);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function perform(
    label: string,
    action: () => Promise<void>,
  ): Promise<boolean> {
    if (working.current) return false;
    working.current = true;
    setBusy(label);
    setError("");
    try {
      await action();
      return true;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Try again.",
      );
      return false;
    } finally {
      working.current = false;
      setBusy("");
    }
  }
  function accept(next: DocumentInfo) {
    if (doc) setHistory((h) => [...h, doc]);
    setFuture([]);
    setDoc(next);
    setPageIndex((i) => Math.min(i, next.pageCount - 1));
    setSelected(null);
  }
  async function openSaved(documentId: string) {
    documentLoad.current++;
    return perform("Opening document", async () => {
      let next: DocumentInfo;
      try {
        next = await request<DocumentInfo>(`/documents/${documentId}`);
      } catch (error) {
        if ((error as { status?: number }).status === 423) {
          setLockedDocumentId(documentId);
          setPassword("");
          setLibrary(false);
          setModal("unlock");
          return;
        }
        throw error;
      }
      setDoc(next);
      setHistory([]);
      setFuture([]);
      setPageIndex(0);
      setSelected(null);
      setSplitFiles([]);
      setTool("read");
      setLibrary(false);
    });
  }
  async function refreshDocumentMetadata() {
    if (doc) {
      const next = await request<DocumentInfo>(`/documents/${doc.id}`);
      setDoc((current) =>
        current?.id === next.id ? { ...current, name: next.name } : current,
      );
    }
  }
  async function upload(file: File, filePassword = ""): Promise<DocumentInfo> {
    const body = new FormData();
    body.append("file", file);
    body.append("password", filePassword);
    return request("/documents", { method: "POST", body });
  }
  function unlockSaved() {
    if (!lockedDocumentId) return;
    perform("Opening document", async () => {
      const next = await request<DocumentInfo>(
        `/documents/${lockedDocumentId}/unlock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      setDoc(next);
      setHistory([]);
      setFuture([]);
      setPageIndex(0);
      setTool("read");
      setSelected(null);
      setModal(null);
      setPassword("");
      setLockedDocumentId(null);
    });
  }
  function open(file?: File, filePassword = "") {
    if (!file) return;
    setLockedDocumentId(null);
    documentLoad.current++;
    perform("Opening document", async () => {
      try {
        const next = await upload(file, filePassword);
        setDoc(next);
        setHistory([]);
        setFuture([]);
        setPageIndex(0);
        setSplitFiles([]);
        setTool("read");
        setModal(null);
        setPassword("");
        lockedFile.current = null;
      } catch (error) {
        if ((error as { status?: number }).status === 423) {
          lockedFile.current = file;
          setModal("unlock");
          if (filePassword)
            setError("That password did not open this file. Try again.");
          return;
        }
        throw error;
      }
    });
  }
  function edit(operation: Record<string, unknown>) {
    return perform("Saving changes", async () => {
      accept(
        await request<DocumentInfo>(`${base}/edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(operation),
        }),
      );
      setModal(null);
      setNotice("Changes saved");
    });
  }
  function undo() {
    const previous = history.at(-1);
    if (!previous || !doc) return;
    setFuture((f) => [doc, ...f]);
    setHistory((h) => h.slice(0, -1));
    setDoc(previous);
    setPageIndex((i) => Math.min(i, previous.pageCount - 1));
  }
  function redo() {
    const next = future[0];
    if (!next || !doc) return;
    setHistory((h) => [...h, doc]);
    setFuture((f) => f.slice(1));
    setDoc(next);
    setPageIndex((i) => Math.min(i, next.pageCount - 1));
  }
  function choose(span: Span) {
    setSelected(span);
    setText(tool === "note" ? "" : span.text);
    setFontSize(Math.round(span.size * 10) / 10);
  }
  function apply() {
    if (!selected) return;
    const common = { page: pageIndex, rect: selected.bbox, text, fontSize };
    if (tool === "text") edit({ operation: "text", ...common });
    else if (tool === "redact")
      edit({ operation: "redact", ...common, color: [0, 0, 0] });
    else
      edit({
        operation: "annotate",
        ...common,
        kind: tool === "highlight" ? "highlight" : "note",
        color: tool === "highlight" ? [1, 0.82, 0.15] : [0, 0, 0],
      });
  }
  function movePage(direction: number) {
    if (!doc) return;
    const target = pageIndex + direction;
    if (target < 0 || target >= doc.pageCount) return;
    const order = doc.pages.map((p) => p.index);
    [order[pageIndex], order[target]] = [order[target], order[pageIndex]];
    edit({ operation: "reorder", order }).then((success) => {
      if (success) setPageIndex(target);
    });
  }
  async function saveFile(url: string, name: string) {
    const response = await fetch(API + url);
    if (!response.ok) {
      const failure = await response
        .json()
        .catch(() => ({ detail: "Export failed" }));
      throw new Error(failure.detail || "Export failed");
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }
  function download(format = "pdf") {
    if (!doc) return;
    perform("Preparing download", async () => {
      await saveFile(
        base + (format === "pdf" ? "/file" : `/export/${format}`),
        exportName(doc.name, format),
      );
      setModal(null);
    });
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (document.querySelector(".shared-workspace, .conversion-dialog")) return;
      if (!doc || busy) return;
      const editable =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable);
      if (
        !editable &&
        !modal &&
        !advanced &&
        !library &&
        !(event.ctrlKey || event.metaKey || event.altKey)
      ) {
        if (["PageDown", "PageUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setPageIndex((index) =>
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? doc.pageCount - 1
                : Math.max(
                    0,
                    Math.min(
                      doc.pageCount - 1,
                      index + (event.key === "PageDown" ? 1 : -1),
                    ),
                  ),
          );
        }
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (!editable && ["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "0") setFitWidth(true);
        else {
          setFitWidth(false);
          setZoom((z) =>
            Math.max(0.15, Math.min(3, z + (event.key === "-" ? -0.15 : 0.15))),
          );
        }
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        download();
      }
      if (!editable && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
      if (!editable && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [doc, busy, history, future, modal, advanced, library]);
  useEffect(() => {
    const media = window.matchMedia("(max-width:700px)");
    const change = () => {
      if (media.matches) setSidebar(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const results = searchPages.flatMap((item) =>
    item.spans
      .filter(
        (span) =>
          query && span.text.toLowerCase().includes(query.toLowerCase()),
      )
      .map((span) => ({ page: item.page, span })),
  );
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length > 1) {
          setError(
            "Drop one PDF to open it. Use Combine files to merge several PDFs.",
          );
          return;
        }
        open(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          open(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={mergeInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          if (!files.length || !doc) return;
          perform("Combining documents", async () => {
            const ids = [doc.id];
            for (const file of files) ids.push((await upload(file)).id);
            accept(
              await request("/merge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids }),
              }),
            );
          });
        }}
      />
      {shared && <SharedWorkspace localDocument={doc} onClose={() => setShared(false)} />}
      <header className="toolbar">
        <div className="toolbar-left">
          <IconButton
            label="Toggle pages"
            onClick={() => setSidebar(!sidebar)}
            active={sidebar && !!doc}
          >
            <PanelLeft size={19} />
          </IconButton>
          <div className="brand">
            folio
            <span className="brand-dot" />
          </div>
          <span className="toolbar-divider" />
          <button
            className="filename"
            onClick={() => input.current?.click()}
            title="Open PDF"
          >
            {doc?.name || "Documents"}
            <ChevronDown size={13} />
          </button>
        </div>
        <div className="toolbar-center">
          {doc && (
            <>
              <IconButton
                label="Undo"
                disabled={!history.length || !!busy}
                onClick={undo}
              >
                <Undo2 size={17} />
              </IconButton>
              <IconButton
                label="Redo"
                disabled={!future.length || !!busy}
                onClick={redo}
              >
                <Redo2 size={17} />
              </IconButton>
              <span className="toolbar-divider" />
              <IconButton
                label="Zoom out"
                onClick={() => {
                  setFitWidth(false);
                  setZoom((z) => Math.max(0.15, z - 0.15));
                }}
              >
                <Minus size={16} />
              </IconButton>
              <button
                className="zoom"
                onClick={() => setFitWidth(true)}
                title="Fit page width"
              >
                {Math.round(zoom * 100)}%
              </button>
              <IconButton
                label="Zoom in"
                onClick={() => {
                  setFitWidth(false);
                  setZoom((z) => Math.min(3, z + 0.15));
                }}
              >
                <Plus size={16} />
              </IconButton>
            </>
          )}
        </div>
        <div className="toolbar-right">
          <button className="tools-button" onClick={() => setShared(true)}>Share</button>
          {doc && (
            <button className="tools-button" onClick={() => setAdvanced(true)}>
              <Settings2 size={16} />
              Tools
            </button>
          )}
          <IconButton
            label="Search document"
            disabled={!doc}
            active={searchOpen}
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search size={19} />
          </IconButton>
          {doc && (
            <button
              className="save-button"
              disabled={!!busy}
              onClick={() => download()}
            >
              <Download size={15} />
              <span>Save a copy</span>
            </button>
          )}
          <div className="menu-anchor">
            <IconButton
              label="More actions"
              active={menu}
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={21} />
            </IconButton>
            {menu && (
              <div className="dropdown" onClick={() => setMenu(false)}>
                <button onClick={() => setLibrary(true)}>
                  <Library size={16} />
                  Library
                </button>
                <button onClick={() => input.current?.click()}>
                  <FolderOpen size={16} />
                  Open PDF<kbd>Ctrl O</kbd>
                </button>
                <button onClick={() => setConversion(true)}><FilePlus2 size={16}/>Convert to PDF</button>
                {doc && (
                  <>
                    <button onClick={() => mergeInput.current?.click()}>
                      <Layers size={16} />
                      Combine files
                    </button>
                    <button
                      onClick={() => {
                        setTitle(doc.metadata.title || "");
                        setAuthor(doc.metadata.author || "");
                        setModal("properties");
                      }}
                    >
                      <Settings2 size={16} />
                      Document properties
                    </button>
                    <button onClick={() => setModal("export")}>
                      <Download size={16} />
                      Export
                    </button>
                    <a
                      href={`${API}${base}/print-preview`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Printer size={16} />
                      Open print preview
                    </a>
                    <button onClick={() => setModal("password")}>
                      <Shield size={16} />
                      Protect with password
                    </button>
                    <button onClick={() => edit({ operation: "compress" })}>
                      <ScanLine size={16} />
                      Compress
                    </button>
                    <button
                      onClick={() =>
                        perform("Splitting pages", async () => {
                          const result = await request<{
                            documents: DocumentInfo[];
                          }>(`${base}/split`, { method: "POST" });
                          setSplitFiles(result.documents);
                        })
                      }
                    >
                      <FileText size={16} />
                      Split into pages
                    </button>
                  </>
                )}
                <fieldset
                  className="appearance"
                  onClick={(event) => event.stopPropagation()}
                >
                  <legend>Appearance</legend>
                  <div
                    className="appearance-options"
                    role="radiogroup"
                    aria-label="Appearance"
                  >
                    {(["light", "dark", "system"] as const).map((value) => (
                      <button
                        key={value}
                        role="radio"
                        aria-checked={appearance === value}
                        onClick={() => setAppearance(value)}
                      >
                        {value[0].toUpperCase() + value.slice(1)}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="menu-rule" />
                <a
                  href="https://cash.app/$ClarkLangloisII"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Heart size={16} />
                  Donate
                  <ArrowUp size={14} className="external" />
                </a>
              </div>
            )}
          </div>
        </div>
      </header>
      {searchOpen && doc && (
        <div className="searchbar">
          <Search size={17} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find in document"
            aria-label="Find in document"
          />
          <span>{query ? `${results.length} matches` : ""}</span>
          <IconButton label="Close search" onClick={() => setSearchOpen(false)}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <IconButton label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      <div className="workspace">
        {searchOpen && query && (
          <aside className="search-results" aria-label="Search results">
            {results.length ? (
              results.map((result, index) => (
                <button key={index} onClick={() => setPageIndex(result.page)}>
                  <small>Page {result.page + 1}</small>
                  <span>{result.span.text}</span>
                </button>
              ))
            ) : (
              <p>{indexing ? "SearchingÃ¢â‚¬Â¦" : "No matches"}</p>
            )}
          </aside>
        )}
        {doc && sidebar && (
          <aside className="sidebar">
            <button
              className="sidebar-library"
              onClick={() => setLibrary(true)}
            >
              <Library size={16} />
              Library
            </button>
            <div className="sidebar-header">
              <span>Pages</span>
              <span>{doc.pageCount}</span>
            </div>
            <div className="thumbnail-list">
              {doc.pages.map((p) => (
                <button
                  key={p.index}
                  className={`thumbnail ${pageIndex === p.index ? "selected" : ""}`}
                  onClick={() => setPageIndex(p.index)}
                  aria-label={`Page ${p.index + 1}`}
                  aria-current={pageIndex === p.index ? "page" : undefined}
                >
                  <div className="thumbnail-paper">
                    <img
                      loading="lazy"
                      src={`${API}${base}/pages/${p.index}/render?scale=0.25`}
                      alt=""
                    />
                  </div>
                  <span>{p.index + 1}</span>
                </button>
              ))}
            </div>
            <div className="page-actions">
              <IconButton
                label="Move page up"
                disabled={pageIndex === 0 || !!busy}
                onClick={() => movePage(-1)}
              >
                <ArrowUp size={16} />
              </IconButton>
              <IconButton
                label="Move page down"
                disabled={pageIndex === doc.pageCount - 1 || !!busy}
                onClick={() => movePage(1)}
              >
                <ArrowDown size={16} />
              </IconButton>
              <IconButton
                label="Rotate page clockwise"
                disabled={!!busy}
                onClick={() =>
                  edit({ operation: "rotate", pages: [pageIndex], angle: 90 })
                }
              >
                <RotateCw size={16} />
              </IconButton>
              <IconButton
                label="Delete page"
                disabled={doc.pageCount < 2 || !!busy}
                onClick={() =>
                  edit({ operation: "delete", pages: [pageIndex] })
                }
              >
                <Trash2 size={16} />
              </IconButton>
            </div>
          </aside>
        )}
        <main className={`document-stage ${!doc ? "empty-stage" : ""}`}>
          {!doc ? (
            <div className="welcome">
              <div className="paper-stack">
                <div className="paper-back" />
                <div className="paper-front">
                  <div className="paper-mark">f.</div>
                  <div className="paper-line long" />
                  <div className="paper-line" />
                  <div className="paper-line short" />
                  <div className="paper-highlight" />
                  <div className="paper-line" />
                  <div className="paper-line long" />
                </div>
              </div>
              <button
                className="open-button"
                onClick={() => input.current?.click()}
              >
                <Plus size={18} />
                Open PDF
              </button>
              <p>or drop a file here</p>
              <button className="convert-welcome" onClick={() => setConversion(true)}>Convert files to PDF</button>
              <div className="welcome-footer">
                <span>Free & open source</span>
                <span className="tiny-dot" />
                <a
                  href="https://cash.app/$ClarkLangloisII"
                  target="_blank"
                  rel="noreferrer"
                >
                  Support Folio <Heart size={12} />
                </a>
              </div>
            </div>
          ) : (
            <>
              <div
                className="editing-tools"
                role="toolbar"
                aria-label="PDF tools"
              >
                {(
                  [
                    { id: "read", label: "Read", icon: FileText },
                    { id: "text", label: "Edit text", icon: Type },
                    { id: "highlight", label: "Highlight", icon: Highlighter },
                    { id: "note", label: "Add note", icon: StickyNote },
                    { id: "redact", label: "Redact", icon: Shield },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    disabled={!!busy}
                    className={tool === item.id ? "chosen" : ""}
                    title={item.label}
                    aria-pressed={tool === item.id}
                    onClick={() => {
                      setTool(item.id);
                      setSelected(null);
                    }}
                  >
                    <item.icon size={17} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <div className="page-scroll" ref={pageViewport}>
                <div
                  className="page-wrap"
                  style={{
                    width: page
                      ? (page.rotation % 180 ? page.height : page.width) * zoom
                      : 612,
                  }}
                >
                  {page && (
                    <div
                      className="pdf-page"
                      style={{
                        aspectRatio: `${page.rotation % 180 ? page.height : page.width} / ${page.rotation % 180 ? page.width : page.height}`,
                      }}
                    >
                      <img
                        className="page-image"
                        src={`${API}${base}/pages/${pageIndex}/render?scale=${Math.min(3, zoom * 1.6)}`}
                        alt={`Page ${pageIndex + 1} of ${doc.name}`}
                        draggable={false}
                      />
                      {tool === "read" && (
                        <TextLayer spans={spans} page={page} zoom={zoom} />
                      )}
                      {spans.map((span, index) => {
                        const hit =
                          !!query &&
                          span.text.toLowerCase().includes(query.toLowerCase());
                        if (tool === "read" && !hit) return null;
                        return (
                          <button
                            key={index}
                            className={`text-region ${tool !== "read" ? "editable" : ""} ${hit ? "search-match" : ""} ${selected === span ? "selected-region" : ""}`}
                            style={spanStyle(span, page)}
                            aria-label={span.text}
                            title={
                              tool === "read"
                                ? span.text
                                : `${tool === "text" ? "Edit" : tool === "redact" ? "Redact" : "Select"} ${span.text}`
                            }
                            tabIndex={tool === "read" ? -1 : 0}
                            onClick={() => tool !== "read" && choose(span)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="page-navigation">
                <span className="mobile-zoom">
                  <IconButton
                    label="Zoom out"
                    onClick={() => {
                      setFitWidth(false);
                      setZoom((z) => Math.max(0.15, z - 0.15));
                    }}
                  >
                    <Minus size={15} />
                  </IconButton>
                  <button
                    onClick={() => setFitWidth(true)}
                    title="Fit page width"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <IconButton
                    label="Zoom in"
                    onClick={() => {
                      setFitWidth(false);
                      setZoom((z) => Math.min(3, z + 0.15));
                    }}
                  >
                    <Plus size={15} />
                  </IconButton>
                </span>
                <IconButton
                  label="Previous page"
                  disabled={!pageIndex}
                  onClick={() => setPageIndex((i) => i - 1)}
                >
                  <ArrowLeft size={15} />
                </IconButton>
                <span>
                  <b>{pageIndex + 1}</b> / {doc.pageCount}
                </span>
                <IconButton
                  label="Next page"
                  disabled={pageIndex === doc.pageCount - 1}
                  onClick={() => setPageIndex((i) => i + 1)}
                >
                  <ArrowRight size={15} />
                </IconButton>
              </div>
            </>
          )}
        </main>
        {selected && doc && (
          <aside className="inspector">
            <div className="inspector-heading">
              <h2>
                {tool === "read"
                  ? "Selected text"
                  : tool === "text"
                    ? "Edit text"
                    : tool === "highlight"
                      ? "Highlight"
                      : tool === "redact"
                        ? "Redact text"
                        : "Add note"}
              </h2>
              <IconButton
                label="Close selection"
                onClick={() => setSelected(null)}
              >
                <X size={17} />
              </IconButton>
            </div>
            {tool === "read" ? (
              <>
                <p className="selected-copy">{selected.text}</p>
                <button
                  className="wide-button"
                  onClick={() =>
                    perform("Copying", async () => {
                      await navigator.clipboard.writeText(
                        selected.text.replace(/\s*\n\s*/g, " "),
                      );
                      setNotice("Copied");
                    })
                  }
                >
                  <Copy size={15} />
                  Copy text
                </button>
              </>
            ) : (
              <>
                <label className="field-label">
                  {tool === "note" ? "Note" : "Text"}
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  readOnly={tool === "highlight" || tool === "redact"}
                  aria-label="Selected text"
                  rows={5}
                />
                {tool === "text" && (
                  <>
                    <div className="field-row">
                      <label htmlFor="font-size">Font size</label>
                      <input
                        id="font-size"
                        type="number"
                        min="4"
                        max="96"
                        step=".5"
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.target.value))}
                      />
                    </div>
                    <p className="help-text">
                      Replacement uses Helvetica with fallback fonts for
                      Unicode. Review the result before exporting.
                    </p>
                  </>
                )}
                {tool === "redact" && (
                  <p className="help-text">
                    This removes the selected text from the saved PDF. You can
                    undo before exporting.
                  </p>
                )}
                <button
                  className={`wide-button primary ${tool === "redact" ? "danger" : ""}`}
                  disabled={
                    !!busy || !Number.isFinite(fontSize) || fontSize < 4
                  }
                  onClick={apply}
                >
                  <Check size={16} />
                  {tool === "text"
                    ? "Apply change"
                    : tool === "redact"
                      ? "Remove text"
                      : tool === "highlight"
                        ? "Highlight"
                        : "Add note"}
                </button>
              </>
            )}
          </aside>
        )}
        {splitFiles.length > 0 && (
          <aside className="inspector">
            <div className="inspector-heading">
              <h2>Split pages</h2>
              <IconButton
                label="Close split pages"
                onClick={() => setSplitFiles([])}
              >
                <X size={17} />
              </IconButton>
            </div>
            {splitFiles.map((file) => (
              <a
                key={file.id}
                className="split-file"
                href={`${API}/documents/${file.id}/file`}
                download={file.name}
              >
                <FileText size={16} />
                {file.name}
                <Download size={14} />
              </a>
            ))}
          </aside>
        )}
      </div>
      {library && (
        <LibraryPanel
          onClose={() => setLibrary(false)}
          onOpen={openSaved}
          onMetadataChanged={refreshDocumentMetadata}
        />
      )}
      {conversion && <ConvertToPdf onClose={() => setConversion(false)} onOpen={next => { accept(next); setPageIndex(0); setConversion(false); }} />}
      {advanced && doc && (
        <AdvancedTools
          document={doc}
          page={pageIndex}
          rect={selected?.bbox}
          onChange={accept}
          onPageChange={setPageIndex}
          onConvert={() => { setAdvanced(false); setConversion(true); }}
          onClose={() => setAdvanced(false)}
        />
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <div className="inspector-heading">
              <h2 id="dialog-title">
                {modal === "properties"
                  ? "Document properties"
                  : modal === "password"
                    ? "Protect document"
                    : modal === "unlock"
                      ? "Open protected PDF"
                      : "Export document"}
              </h2>
              <IconButton label="Close dialog" onClick={() => setModal(null)}>
                <X size={18} />
              </IconButton>
            </div>
            {modal === "properties" ? (
              <>
                <label className="field-label" htmlFor="title">
                  Title
                </label>
                <input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <label className="field-label" htmlFor="author">
                  Author
                </label>
                <input
                  id="author"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
                <button
                  className="wide-button primary"
                  disabled={!!busy}
                  onClick={() =>
                    edit({ operation: "metadata", metadata: { title, author } })
                  }
                >
                  Save properties
                </button>
              </>
            ) : modal === "password" || modal === "unlock" ? (
              <>
                <label className="field-label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {modal === "password" && (
                  <details className="permission-options">
                    <summary>Permissions</summary>
                    <div>
                      {[
                        { id: "print", label: "Printing" },
                        { id: "copy", label: "Copying text" },
                        { id: "annotate", label: "Comments" },
                        { id: "fill", label: "Filling forms" },
                        { id: "modify", label: "Editing" },
                        { id: "assemble", label: "Reordering pages" },
                        { id: "accessibility", label: "Screen readers" },
                      ].map((permission) => (
                        <label className="checkbox-label" key={permission.id}>
                          <input
                            type="checkbox"
                            checked={permissions.includes(permission.id)}
                            onChange={(event) =>
                              setPermissions((current) =>
                                event.target.checked
                                  ? [...current, permission.id]
                                  : current.filter(
                                      (item) => item !== permission.id,
                                    ),
                              )
                            }
                          />
                          {permission.label}
                        </label>
                      ))}
                    </div>
                    {permissions.length < 7 && (
                      <>
                        <label className="field-label" htmlFor="owner-password">
                          Owner password
                        </label>
                        <input
                          id="owner-password"
                          type="password"
                          value={ownerPassword}
                          onChange={(event) =>
                            setOwnerPassword(event.target.value)
                          }
                        />
                        <p className="help-text">
                          Use a different password to change permissions. PDF
                          viewers control how these permissions are enforced.
                        </p>
                      </>
                    )}
                  </details>
                )}
                <button
                  className="wide-button primary"
                  disabled={
                    !password ||
                    !!busy ||
                    (modal === "password" &&
                      permissions.length < 7 &&
                      (!ownerPassword || ownerPassword === password))
                  }
                  onClick={() =>
                    modal === "unlock"
                      ? lockedDocumentId
                        ? unlockSaved()
                        : open(lockedFile.current || undefined, password)
                      : perform("Protecting document", async () => {
                          const protectedDoc = await request<DocumentInfo>(
                            base + "/edit",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                operation: "encrypt",
                                password,
                                ownerPassword,
                                permissions,
                              }),
                            },
                          );
                          await saveFile(
                            "/documents/" + protectedDoc.id + "/file",
                            "Protected.pdf",
                          );
                          setModal(null);
                          setPassword("");
                          setNotice("Protected copy saved");
                        })
                  }
                >
                  <Shield size={15} />
                  {modal === "unlock" ? "Open PDF" : "Protect PDF"}
                </button>
              </>
            ) : (
              <div className="export-options">
                {[
                  {
                    format: "pdf",
                    label: "PDF",
                    description: "Your document with all changes",
                  },
                  {
                    format: "txt",
                    label: "Plain text",
                    description: "Text from every page",
                  },
                  {
                    format: "docx",
                    label: "Word document",
                    description: "Extracted text in an editable document",
                  },
                ].map((item) => (
                  <button
                    key={item.format}
                    onClick={() => download(item.format)}
                  >
                    <FileText size={22} />
                    <span>
                      <b>{item.label}</b>
                      <small>{item.description}</small>
                    </span>
                    <Download size={17} />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {busy && (
        <div className="busy" role="status">
          <LoaderCircle size={17} className="spin" />
          {busy}
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {dragging && (
        <div className="drop-overlay" onDragLeave={() => setDragging(false)}>
          <FilePlus2 size={42} />
          <span>Drop to open</span>
        </div>
      )}
    </div>
  );
}
