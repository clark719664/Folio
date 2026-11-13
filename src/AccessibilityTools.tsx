import { useEffect, useState } from "react";

type Element = {
  path: number[];
  role: string;
  alt: string | null;
  actualText: string | null;
  language: string | null;
  children: Element[];
  contentItems: number;
};
type Inspection = {
  language: string | null;
  title: string | null;
  marked: boolean;
  tagged: boolean;
  tree: Element[];
  roleMap: Record<string, string>;
  issues: { code: string; path?: number[]; field?: string; severity: string }[];
  validation: string;
  manualChecks: string[];
};
type Props = {
  documentId: string;
  busy: boolean;
  mutate: (
    operation: Record<string, unknown>,
    endpoint?: string,
  ) => Promise<void>;
};

export default function AccessibilityTools({
  documentId,
  busy,
  mutate,
}: Props) {
  const [data, setData] = useState<Inspection | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("");
  const [selected, setSelected] = useState<Element | null>(null);
  const [role, setRole] = useState("");
  const [alt, setAlt] = useState("");
  const [actualText, setActualText] = useState("");
  const [elementLanguage, setElementLanguage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/documents/${documentId}/accessibility`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.detail || "Unable to inspect document accessibility.",
          );
        setData(result);
        setTitle(result.title || "");
        setLanguage(result.language || "");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [documentId]);
  function select(element: Element) {
    setSelected(element);
    setRole(element.role);
    setAlt(element.alt || "");
    setActualText(element.actualText || "");
    setElementLanguage(element.language || "");
  }
  function tree(elements: Element[]) {
    return (
      <ul className="structure-tree">
        {elements.map((element) => (
          <li key={element.path.join(".")}>
            <button
              aria-pressed={selected?.path.join(".") === element.path.join(".")}
              onClick={() => select(element)}
            >
              {element.role}
              {element.alt ? ` · ${element.alt}` : ""}
            </button>
            {element.children.length > 0 && (
              <details>
                <summary>{element.children.length} child elements</summary>
                {tree(element.children)}
              </details>
            )}
          </li>
        ))}
      </ul>
    );
  }
  async function move(direction: number) {
    if (!selected || !data) return;
    const parentPath = selected.path.slice(0, -1);
    let siblings = data.tree;
    for (const index of parentPath) {
      const parent = siblings.find((item) => item.path.at(-1) === index);
      if (!parent) return;
      siblings = parent.children;
    }
    const index = selected.path.at(-1)!;
    const order = siblings.map((item) => item.path.at(-1)!);
    if (
      order.some((value, index) => value !== index) ||
      index + direction < 0 ||
      index + direction >= order.length
    ) {
      setError(
        "This position includes content references. Its reading order needs a structure-aware edit.",
      );
      return;
    }
    [order[index], order[index + direction]] = [
      order[index + direction],
      order[index],
    ];
    await mutate(
      { operation: "reorder", path: parentPath, order },
      "accessibility",
    );
  }
  return (
    <>
      {error && (
        <p role="alert" className="tool-error">
          {error}
        </p>
      )}
      {!data ? (
        <p role="status">Inspecting document…</p>
      ) : (
        <>
          <label>
            Document title
            <input
              aria-label="Accessibility document title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Document language
            <input
              aria-label="Document language"
              value={language}
              placeholder="en-US"
              onChange={(event) => setLanguage(event.target.value)}
            />
          </label>
          <button
            className="wide-button primary"
            disabled={busy}
            onClick={() =>
              mutate(
                { operation: "document", title, language },
                "accessibility",
              )
            }
          >
            Save document properties
          </button>
          <h3>Structure</h3>
          {data.tree.length > 0 ? (
            tree(data.tree)
          ) : (
            <p>This PDF has no editable structure tags.</p>
          )}
          {selected && (
            <fieldset className="structure-editor">
              <legend>Edit {selected.role}</legend>
              <label>
                Role
                <input
                  aria-label="Structure role"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                />
              </label>
              <label>
                Alternative text
                <textarea
                  aria-label="Alternative text"
                  value={alt}
                  onChange={(event) => setAlt(event.target.value)}
                />
              </label>
              <label>
                Replacement text
                <textarea
                  aria-label="Accessible replacement text"
                  value={actualText}
                  onChange={(event) => setActualText(event.target.value)}
                />
              </label>
              <label>
                Language
                <input
                  aria-label="Element language"
                  value={elementLanguage}
                  onChange={(event) => setElementLanguage(event.target.value)}
                />
              </label>
              <button
                className="wide-button primary"
                disabled={busy || !role.trim()}
                onClick={() =>
                  mutate(
                    {
                      operation: "element",
                      path: selected.path,
                      role,
                      alt,
                      actualText,
                      language: elementLanguage,
                    },
                    "accessibility",
                  )
                }
              >
                Save structure element
              </button>
              <div className="review-actions">
                <button disabled={busy} onClick={() => move(-1)}>
                  Move earlier
                </button>
                <button disabled={busy} onClick={() => move(1)}>
                  Move later
                </button>
              </div>
            </fieldset>
          )}
          <h3>Inspection results</h3>
          {data.issues.length ? (
            <ul>
              {data.issues.map((issue, index) => (
                <li key={index}>
                  {issue.code.replaceAll("_", " ").replaceAll("-", " ")}
                  {issue.field ? ` · ${issue.field}` : ""} · {issue.severity}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              The automated inspection found no issues in the checks it
              performed.
            </p>
          )}
          <p className="help-text">
            Manual review is still needed to establish accessibility.
          </p>
          <ul>
            {data.manualChecks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
          <a
            className="split-file"
            href={`/api/documents/${documentId}/accessibility/report`}
            download
          >
            Download accessibility report
          </a>
        </>
      )}
    </>
  );
}
