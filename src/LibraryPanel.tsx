import { useEffect, useState } from "react";
import { Folder, Search, Star, X, History } from "lucide-react";
import { useDialog } from "./useDialog";
type Entry = {
  id: string;
  documentId: string;
  name: string;
  folder: string;
  favorite: boolean;
  created: number;
  updated: number;
  revisionCount: number;
};
type Revision = {
  id: string;
  parentId: string | null;
  created: number;
  restoredFrom: string | null;
};
type Props = {
  onClose: () => void;
  onOpen: (id: string) => Promise<boolean>;
  onMetadataChanged: () => Promise<void>;
};
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch("/api" + path, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Unable to update the library.",
    );
  return data;
}
function date(value: number) {
  const date = new Date(value * 1000);
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}
export default function LibraryPanel({
  onClose,
  onOpen,
  onMetadataChanged,
}: Props) {
  useDialog(true, onClose);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<{ documents: Entry[] }>("/library", { signal: controller.signal })
      .then((data) => setEntries(data.documents))
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to update library.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function patch(entry: Entry, values: Partial<Entry>) {
    const result = await api<Entry>(`/library/${entry.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setEntries((current) =>
      current.map((item) => (item.id === entry.id ? result : item)),
    );
    if (selected?.id === entry.id) setSelected(result);
    await onMetadataChanged();
  }
  async function select(entry: Entry) {
    setSelected(entry);
    setName(entry.name);
    setDestination(entry.folder);
    setRevisions([]);
    await run(async () => {
      const result = await api<{ revisions: Revision[] }>(
        `/documents/${entry.documentId}/history`,
      );
      setRevisions(result.revisions);
    });
  }
  const folders = Array.from(
    new Set(entries.map((entry) => entry.folder).filter(Boolean)),
  ).sort();
  const visible = entries.filter(
    (entry) =>
      (!favorites || entry.favorite) &&
      (!folder || entry.folder === folder) &&
      `${entry.name} ${entry.folder}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="modal-backdrop">
      <section
        className="modal library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
      >
        <div className="inspector-heading">
          <h2 id="library-title">Library</h2>
          <button
            className="icon-button"
            aria-label="Close library"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {error && (
          <p role="alert" className="tool-error">
            {error}
          </p>
        )}
        <div className="library-filters">
          <label className="library-search">
            <Search size={16} />
            <input
              aria-label="Search library"
              placeholder="Search documents"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="Library folder"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          >
            <option value="">All folders</option>
            {folders.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <button
            className={`library-favorite-filter ${favorites ? "selected" : ""}`}
            aria-label="Show favorites"
            aria-pressed={favorites}
            onClick={() => setFavorites(!favorites)}
          >
            <Star size={17} />
          </button>
        </div>
        {loading && <p role="status">Loading documents…</p>}
        <div className="library-list">
          {visible.map((entry) => (
            <article className="library-entry" key={entry.id}>
              <button
                className="library-open"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (!(await onOpen(entry.documentId)))
                      throw new Error(
                        "Unable to open this document. Check the local PDF service and try again.",
                      );
                  })
                }
              >
                <b>{entry.name}</b>
                <small>
                  {entry.folder ? (
                    <>
                      <Folder size={12} />
                      {entry.folder} ·{" "}
                    </>
                  ) : null}
                  {date(entry.updated)}
                </small>
              </button>
              <button
                className={`icon-button ${entry.favorite ? "is-favorite" : ""}`}
                aria-label={`${entry.favorite ? "Unfavorite" : "Favorite"} ${entry.name}`}
                disabled={busy}
                onClick={() =>
                  run(() => patch(entry, { favorite: !entry.favorite }))
                }
              >
                <Star
                  size={16}
                  fill={entry.favorite ? "currentColor" : "none"}
                />
              </button>
              <button
                className="icon-button"
                aria-label={`Details and history for ${entry.name}`}
                disabled={busy}
                onClick={() => select(entry)}
              >
                <History size={17} />
              </button>
            </article>
          ))}
        </div>
        {!loading && !visible.length && (
          <p>
            {entries.length
              ? "No documents match your search."
              : "Open a PDF to add it to your library."}
          </p>
        )}
        {selected && (
          <section className="library-details">
            <h3>{selected.name}</h3>
            <label>
              Filename
              <input
                aria-label="Library filename"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Folder
              <input
                aria-label="Document folder"
                list="library-folders"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              />
              <datalist id="library-folders">
                {folders.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </label>
            <button
              className="wide-button primary"
              disabled={busy || !name.trim()}
              onClick={() =>
                run(() =>
                  patch(selected, {
                    name: name.trim(),
                    folder: destination.trim(),
                  }),
                )
              }
            >
              Save document details
            </button>
            <h3>Version history</h3>
            <ol className="revision-list">
              {revisions.map((revision, index) => (
                <li key={revision.id}>
                  <span>
                    {date(revision.created)}
                    {index === 0 ? " · Latest" : ""}
                    {revision.restoredFrom ? " · Restored" : ""}
                  </span>
                  <div>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          if (!(await onOpen(revision.id)))
                            throw new Error(
                              "Unable to open this version. Check the local PDF service and try again.",
                            );
                        })
                      }
                    >
                      Open version
                    </button>
                    {index > 0 && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const restored = await api<{ id: string }>(
                              `/documents/${revision.id}/restore`,
                              { method: "POST" },
                            );
                            if (!(await onOpen(restored.id)))
                              throw new Error(
                                "The version was restored. Reopen it from the library when the local service is available.",
                              );
                          })
                        }
                      >
                        Restore version
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </section>
    </div>
  );
}
