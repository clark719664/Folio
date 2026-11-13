import { useEffect, useState } from "react";

type Comment = {
  page: number;
  xref: number;
  text: string;
  author: string;
  replyTo: number | null;
  resolved: boolean;
};
type Measurement = {
  page: number;
  xref: number;
  label: string;
  kind: string;
  value: number;
  unit: string;
};
type Props = {
  documentId: string;
  page: number;
  mode: "comments" | "measurements";
  rect: number[];
  mutate: (
    operation: Record<string, unknown>,
    endpoint?: string,
  ) => Promise<void>;
  onPageChange: (page: number) => void;
  busy: boolean;
};
export default function ReviewTools({
  documentId,
  page,
  mode,
  rect,
  mutate,
  onPageChange,
  busy,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");
  const [selected, setSelected] = useState<Comment | null>(null);
  const [action, setAction] = useState("add");
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState("distance");
  const [points, setPoints] = useState(
    `${rect[0]}, ${rect[1]}\n${rect[2]}, ${rect[3]}`,
  );
  const [scale, setScale] = useState(1);
  const [unit, setUnit] = useState("pt");
  const [label, setLabel] = useState("");
  const base = `/api/documents/${documentId}`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`${base}/${mode}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.detail || "Unable to load document annotations.",
          );
        setComments(data.comments || []);
        setMeasurements(data.measurements || []);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base, mode]);
  function choose(comment: Comment, operation: string) {
    setSelected(comment);
    setAction(operation);
    setText(operation === "edit" ? comment.text : "");
    setAuthor(operation === "edit" ? comment.author : author);
    onPageChange(comment.page);
  }
  async function saveMeasurement() {
    setError("");
    const parsed = points
      .trim()
      .split(/\n/)
      .map((line) =>
        line
          .split(",")
          .map((value) => (value.trim() ? Number(value.trim()) : NaN)),
      );
    if (
      parsed.some(
        (point) =>
          point.length !== 2 || point.some((value) => !Number.isFinite(value)),
      ) ||
      !Number.isFinite(scale) ||
      scale <= 0
    ) {
      setError("Enter one x, y coordinate pair per line and a positive scale.");
      return;
    }
    await mutate(
      { page, kind, points: parsed, unitsPerPoint: scale, unit, label },
      "measurements",
    );
  }
  return (
    <>
      {error && (
        <p role="alert" className="tool-error">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading…</p>}
      {mode === "comments" ? (
        <>
          <label>
            Filter comments
            <input
              aria-label="Filter comments"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          <div className="review-list">
            {comments
              .filter((comment) =>
                `${comment.text} ${comment.author}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              )
              .map((comment) => (
                <article
                  className="review-item"
                  key={`${comment.page}-${comment.xref}`}
                >
                  <div className="review-meta">
                    <button onClick={() => onPageChange(comment.page)}>
                      Page {comment.page + 1}
                    </button>
                    <span>
                      {comment.author || "Anonymous"}
                      {comment.resolved ? " · Resolved" : ""}
                      {comment.replyTo ? " · Reply" : ""}
                    </span>
                  </div>
                  {comment.replyTo && (
                    <blockquote className="reply-context">
                      {comments.find(
                        (parent) =>
                          parent.page === comment.page &&
                          parent.xref === comment.replyTo,
                      )?.text || "Earlier comment"}
                    </blockquote>
                  )}
                  <p>{comment.text}</p>
                  <div className="review-actions">
                    <button
                      disabled={busy}
                      onClick={() => choose(comment, "reply")}
                    >
                      Reply
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => choose(comment, "edit")}
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        mutate(
                          {
                            operation: "resolve",
                            page: comment.page,
                            xref: comment.xref,
                            resolved: !comment.resolved,
                          },
                          "comments",
                        )
                      }
                    >
                      {comment.resolved ? "Reopen" : "Resolve"}
                    </button>
                    <button
                      disabled={
                        busy ||
                        comments.some(
                          (reply) =>
                            reply.page === comment.page &&
                            reply.replyTo === comment.xref,
                        )
                      }
                      title="Delete replies before deleting their parent comment"
                      onClick={() =>
                        mutate(
                          {
                            operation: "delete",
                            page: comment.page,
                            xref: comment.xref,
                          },
                          "comments",
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            {!loading && comments.length === 0 && <p>No comments yet.</p>}
          </div>
          {selected && (
            <div className="review-meta">
              <span>
                {action === "reply" ? "Replying on" : "Editing comment on"} page{" "}
                {selected.page + 1}
              </span>
              <button
                onClick={() => {
                  setSelected(null);
                  setAction("add");
                  setText("");
                }}
              >
                Cancel
              </button>
            </div>
          )}
          <label>
            Author
            <input
              aria-label="Comment author"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
            />
          </label>
          <label>
            {action === "reply" ? "Reply" : "Comment"}
            <textarea
              aria-label="Comment text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
            />
          </label>
          <button
            className="wide-button primary"
            disabled={busy || !text.trim()}
            onClick={() =>
              mutate(
                {
                  operation: action === "edit" ? "edit" : "add",
                  page: selected?.page ?? page,
                  rect,
                  text,
                  author,
                  ...(action === "reply" && selected
                    ? { replyTo: selected.xref }
                    : {}),
                  ...(action === "edit" && selected
                    ? { xref: selected.xref }
                    : {}),
                },
                "comments",
              )
            }
          >
            {action === "edit"
              ? "Save comment"
              : action === "reply"
                ? "Post reply"
                : "Add comment"}
          </button>
          <a className="split-file" href={`${base}/comments/summary`} download>
            Download review summary
          </a>
          <a
            className="split-file"
            href={`${base}/comments`}
            download="comments.json"
          >
            Export comments
          </a>
        </>
      ) : (
        <>
          <label>
            Measurement
            <select
              aria-label="Measurement"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="distance">Distance</option>
              <option value="perimeter">Perimeter</option>
              <option value="area">Area</option>
            </select>
          </label>
          <label>
            Points
            <textarea
              aria-label="Measurement points"
              rows={4}
              value={points}
              onChange={(event) => setPoints(event.target.value)}
            />
          </label>
          <p className="help-text">
            Enter one x, y pair per line in PDF points. Distance uses two
            points. Perimeter and area close a polygon with at least three
            points.
          </p>
          <div className="placement">
            <label>
              Units per PDF point
              <input
                aria-label="Units per PDF point"
                type="number"
                step="any"
                min="0.000001"
                value={scale}
                onChange={(event) => setScale(Number(event.target.value))}
              />
            </label>
            <label>
              Unit
              <input
                aria-label="Measurement unit"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              />
            </label>
          </div>
          <label>
            Label
            <input
              aria-label="Measurement label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <button
            className="wide-button primary"
            disabled={busy || !unit.trim()}
            onClick={saveMeasurement}
          >
            Save measurement
          </button>
          <div className="review-list">
            {measurements.map((item) => (
              <article
                className="review-item"
                key={`${item.page}-${item.xref}`}
              >
                <button onClick={() => onPageChange(item.page)}>
                  Page {item.page + 1}
                </button>
                <p>
                  {item.label || item.kind} · {Number(item.value.toFixed(4))}{" "}
                  {item.unit}
                </p>
              </article>
            ))}
          </div>
          <a className="split-file" href={`${base}/measurements/csv`} download>
            Export measurements
          </a>
        </>
      )}
    </>
  );
}
