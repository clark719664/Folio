import { useState } from "react";

type Props = { documentId: string; pageCount: number };
type Output = { id: string; pageCount: number; sheets: (number | null)[][] };
export default function PrintTools({ documentId, pageCount }: Props) {
  const [mode, setMode] = useState("original");
  const [range, setRange] = useState("");
  const [columns, setColumns] = useState(2);
  const [rows, setRows] = useState(2);
  const [paper, setPaper] = useState("a4");
  const [landscape, setLandscape] = useState(true);
  const [margin, setMargin] = useState(18);
  const [gutter, setGutter] = useState(12);
  const [rtl, setRtl] = useState(false);
  const [borders, setBorders] = useState(false);
  const [annotations, setAnnotations] = useState(true);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/documents/${documentId}`;
  async function prepare() {
    setBusy(true);
    setError("");
    setOutput(null);
    try {
      const pages: number[] = [];
      if (range.trim())
        for (const part of range.split(",")) {
          const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
          if (!match)
            throw new Error("Enter page numbers or ranges, such as 1–3, 5.");
          const first = Number(match[1]),
            last = Number(match[2] || match[1]);
          if (first < 1 || last < first || last > pageCount)
            throw new Error(`Choose pages between 1 and ${pageCount}.`);
          for (let page = first; page <= last; page++) pages.push(page - 1);
        }
      const dimensions = paper === "letter" ? [612, 792] : [595, 842];
      const response = await fetch(base + "/impose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          ...(pages.length ? { pages } : {}),
          columns,
          rows,
          width: landscape ? dimensions[1] : dimensions[0],
          height: landscape ? dimensions[0] : dimensions[1],
          margin,
          gutter,
          rightToLeft: rtl,
          borders,
          includeAnnotations: annotations,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : "Check the page and sheet settings.",
        );
      setOutput(result);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to prepare print layout.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p role="alert" className="tool-error">
          {error}
        </p>
      )}
      <label>
        Layout
        <select
          aria-label="Print layout"
          value={mode}
          onChange={(event) => {
            setMode(event.target.value);
            setOutput(null);
          }}
        >
          <option value="original">Original pages</option>
          <option value="nup">Multiple pages per sheet</option>
          <option value="booklet">Booklet</option>
        </select>
      </label>
      {mode === "original" ? (
        <>
          <a
            className="wide-button primary print-link"
            href={base + "/print-preview"}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open print preview
          </a>
          <p className="help-text">
            Choose the printer, copies and page range in your browser’s PDF
            print controls.
          </p>
        </>
      ) : (
        <>
          <label>
            Pages
            <input
              aria-label="Print pages"
              placeholder={`All ${pageCount} pages`}
              value={range}
              onChange={(event) => {
                setRange(event.target.value);
                setOutput(null);
              }}
            />
          </label>
          <label>
            Paper
            <select
              aria-label="Paper size"
              value={paper}
              onChange={(event) => {
                setPaper(event.target.value);
                setOutput(null);
              }}
            >
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
            </select>
          </label>
          <label>
            Orientation
            <select
              aria-label="Paper orientation"
              value={landscape ? "landscape" : "portrait"}
              onChange={(event) => {
                setLandscape(event.target.value === "landscape");
                setOutput(null);
              }}
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </label>
          {mode === "nup" && (
            <div className="print-grid">
              <label>
                Columns
                <input
                  aria-label="Print columns"
                  type="number"
                  min="1"
                  max="8"
                  value={columns}
                  onChange={(event) => {
                    setColumns(Number(event.target.value));
                    setOutput(null);
                  }}
                />
              </label>
              <label>
                Rows
                <input
                  aria-label="Print rows"
                  type="number"
                  min="1"
                  max="8"
                  value={rows}
                  onChange={(event) => {
                    setRows(Number(event.target.value));
                    setOutput(null);
                  }}
                />
              </label>
            </div>
          )}
          <div className="print-grid">
            <label>
              Margin (pt)
              <input
                aria-label="Print margin"
                type="number"
                min="0"
                value={margin}
                onChange={(event) => {
                  setMargin(Number(event.target.value));
                  setOutput(null);
                }}
              />
            </label>
            <label>
              Gutter (pt)
              <input
                aria-label="Print gutter"
                type="number"
                min="0"
                value={gutter}
                onChange={(event) => {
                  setGutter(Number(event.target.value));
                  setOutput(null);
                }}
              />
            </label>
          </div>
          {mode === "booklet" && (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rtl}
                  onChange={(event) => {
                    setRtl(event.target.checked);
                    setOutput(null);
                  }}
                />
                Right-to-left binding
              </label>
              <p className="help-text">
                Print double-sided at actual size. Check your printer’s duplex
                flip setting with a test sheet before printing the full booklet.
              </p>
            </>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={borders}
              onChange={(event) => {
                setBorders(event.target.checked);
                setOutput(null);
              }}
            />
            Page borders
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={annotations}
              onChange={(event) => {
                setAnnotations(event.target.checked);
                setOutput(null);
              }}
            />
            Include annotations
          </label>
          <button
            className="wide-button primary"
            disabled={busy}
            onClick={prepare}
          >
            {busy ? "Preparing…" : "Prepare print layout"}
          </button>
          {output && (
            <section className="print-result">
              <h3>{output.pageCount} sheet sides</h3>
              <img
                className="visual-diff"
                src={`/api/documents/${output.id}/pages/0/render?scale=0.6`}
                alt="First prepared print sheet"
              />
              <a
                className="wide-button primary print-link"
                href={`/api/documents/${output.id}/print-preview`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open print preview
              </a>
              <a
                className="split-file"
                href={`/api/documents/${output.id}/file`}
                download="Print-layout.pdf"
              >
                Save print layout
              </a>
              <details>
                <summary>Page order</summary>
                <ol>
                  {output.sheets.map((sheet, index) => (
                    <li key={index}>
                      {sheet
                        .map((page) => (page === null ? "Blank" : page + 1))
                        .join(", ")}
                    </li>
                  ))}
                </ol>
              </details>
            </section>
          )}
        </>
      )}
    </>
  );
}
