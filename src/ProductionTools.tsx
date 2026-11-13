import { useEffect, useState } from "react";
type Rule = {
  kind: string;
  minimumDpi?: number;
  allowedColorspaces?: string[];
  width?: number;
  height?: number;
};
type Profile = { name: string; rules: Rule[] };
type PageInfo = {
  index: number;
  rotation: number;
  boxes: Record<string, number[]>;
  fonts: {
    xref: number;
    name: string;
    type: string;
    embedded: boolean;
    format: string;
  }[];
  images: {
    xref: number;
    width: number;
    height: number;
    colorspace: string;
    dpiX: number;
    dpiY: number;
  }[];
};
type Report = {
  passed: boolean;
  findings: { rule: number; kind: string; page?: number; message: string }[];
  scope: string;
  conformanceCertified: boolean;
};
type Props = {
  documentId: string;
  page: number;
  busy: boolean;
  mutate: (
    operation: Record<string, unknown>,
    endpoint?: string,
  ) => Promise<void>;
};
const ruleNames: Record<string, string> = {
  "font-embedded": "Embedded fonts",
  "minimum-image-dpi": "Image resolution",
  "allowed-image-colorspaces": "Image color spaces",
  "document-title": "Document title",
  "maximum-page-size": "Maximum page size",
  "page-boxes": "Page boxes",
};
export default function ProductionTools({
  documentId,
  page,
  busy,
  mutate,
}: Props) {
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [limits, setLimits] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [profile, setProfile] = useState<Profile>({
    name: "Print checks",
    rules: [
      { kind: "font-embedded" },
      { kind: "minimum-image-dpi", minimumDpi: 150 },
      { kind: "page-boxes" },
    ],
  });
  const [report, setReport] = useState<Report | null>(null);
  const [box, setBox] = useState("trim");
  const [bounds, setBounds] = useState([0, 0, 595, 842]);
  const [allPages, setAllPages] = useState(false);
  const [icc, setIcc] = useState<File | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [subtype, setSubtype] = useState("GTS_PDFX");
  const base = `/api/documents/${documentId}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(base + "/production", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.detail || "Unable to inspect print production.",
          );
        setPages(result.pages);
        setLimits(result.inspectionLimits || []);
        setBounds(result.pages[page]?.boxes[box] || [0, 0, 595, 842]);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [base]);
  async function check() {
    setChecking(true);
    setError("");
    try {
      const response = await fetch(base + "/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : "Check the preflight profile values.",
        );
      setReport(result);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to inspect document.",
      );
    } finally {
      setChecking(false);
    }
  }
  function changeRule(index: number, patch: Partial<Rule>) {
    setProfile((current) => ({
      ...current,
      rules: current.rules.map((rule, i) =>
        i === index ? { ...rule, ...patch } : rule,
      ),
    }));
    setReport(null);
  }
  function downloadProfile() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(profile, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "folio-preflight.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importProfile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      if (file.size > 1000000)
        throw new Error("Choose a profile smaller than 1 MB.");
      const result = JSON.parse(await file.text());
      if (
        typeof result.name !== "string" ||
        !Array.isArray(result.rules) ||
        result.rules.length > 100 ||
        result.rules.some((rule: Rule) => !rule || !ruleNames[rule.kind])
      )
        throw new Error(
          "Choose a Folio preflight profile with supported rules.",
        );
      setProfile(result);
      setReport(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Invalid profile file.",
      );
    }
  }
  async function saveIntent() {
    if (!icc) return;
    setError("");
    try {
      if (icc.size > 5500000)
        throw new Error("Choose an ICC profile smaller than 5.5 MB.");
      const bytes = new Uint8Array(await icc.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 8192)
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      await mutate(
        { profile: btoa(binary), identifier, subtype },
        "output-intent",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to attach output profile.",
      );
    }
  }
  return (
    <>
      {error && (
        <p role="alert" className="tool-error">
          {error}
        </p>
      )}
      <h3>Preflight</h3>
      <label>
        Profile name
        <input
          aria-label="Preflight profile name"
          value={profile.name}
          onChange={(event) =>
            setProfile({ ...profile, name: event.target.value })
          }
        />
      </label>
      {Object.entries(ruleNames).map(([kind, name]) => {
        const index = profile.rules.findIndex((rule) => rule.kind === kind);
        const rule = profile.rules[index];
        return (
          <div className="preflight-rule" key={kind}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={index >= 0}
                onChange={(event) => {
                  setProfile({
                    ...profile,
                    rules: event.target.checked
                      ? [
                          ...profile.rules,
                          {
                            kind,
                            minimumDpi: 150,
                            allowedColorspaces: ["DeviceRGB"],
                            width: 842,
                            height: 1191,
                          },
                        ]
                      : profile.rules.filter((rule) => rule.kind !== kind),
                  });
                  setReport(null);
                }}
              />
              {name}
            </label>
            {rule && kind === "minimum-image-dpi" && (
              <label>
                Minimum dpi
                <input
                  aria-label="Minimum image dpi"
                  type="number"
                  min="1"
                  max="2400"
                  value={rule.minimumDpi ?? 150}
                  onChange={(event) =>
                    changeRule(index, {
                      minimumDpi: Number(event.target.value),
                    })
                  }
                />
              </label>
            )}
            {rule && kind === "allowed-image-colorspaces" && (
              <label>
                Allowed color spaces
                <input
                  aria-label="Allowed image color spaces"
                  value={(rule.allowedColorspaces || ["DeviceRGB"]).join(", ")}
                  onChange={(event) =>
                    changeRule(index, {
                      allowedColorspaces: event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
            )}
            {rule && kind === "maximum-page-size" && (
              <div className="print-grid">
                <label>
                  Width (pt)
                  <input
                    aria-label="Maximum page width"
                    type="number"
                    value={rule.width ?? 842}
                    onChange={(event) =>
                      changeRule(index, { width: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  Height (pt)
                  <input
                    aria-label="Maximum page height"
                    type="number"
                    value={rule.height ?? 1191}
                    onChange={(event) =>
                      changeRule(index, { height: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
            )}
          </div>
        );
      })}
      <button
        className="wide-button primary"
        disabled={checking || busy || !profile.rules.length}
        onClick={check}
      >
        {checking ? "Checking…" : "Run preflight"}
      </button>
      <div className="review-actions">
        <button onClick={downloadProfile}>Export profile</button>
        <label>
          Import profile
          <input
            aria-label="Import preflight profile"
            type="file"
            accept=".json,application/json"
            onChange={(event) => importProfile(event.target.files?.[0])}
          />
        </label>
      </div>
      {report && (
        <section className="preflight-results">
          <h3>{report.passed ? "Selected checks passed" : "Issues found"}</h3>
          <p className="help-text">
            Results cover the configured checks. Standards conformance requires
            an independent validator.
          </p>
          <ul>
            {report.findings.map((finding, index) => (
              <li key={index}>
                {finding.page !== undefined
                  ? `Page ${finding.page + 1} · `
                  : ""}
                {finding.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      <details>
        <summary>Fonts and images</summary>
        {pages.map((item) => (
          <section key={item.index}>
            <h3>Page {item.index + 1}</h3>
            {item.fonts.map((font) => (
              <p key={`${font.xref}-${font.name}`}>
                {font.name} · {font.embedded ? "Embedded" : "Not embedded"} ·{" "}
                {font.type}
              </p>
            ))}
            {item.images.map((image, index) => (
              <p key={`${image.xref}-${index}`}>
                {image.width} × {image.height} · {image.colorspace} ·{" "}
                {Math.round(image.dpiX)} × {Math.round(image.dpiY)} dpi
              </p>
            ))}
          </section>
        ))}
        <ul>
          {limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Page boxes</summary>
        <label>
          Box
          <select
            aria-label="Page box"
            value={box}
            onChange={(event) => {
              setBox(event.target.value);
              setBounds(pages[page]?.boxes[event.target.value] || bounds);
            }}
          >
            {["media", "crop", "bleed", "trim", "art"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <div className="print-grid">
          {["Left", "Top", "Right", "Bottom"].map((name, index) => (
            <label key={name}>
              {name} (pt)
              <input
                aria-label={`Page box ${name.toLowerCase()}`}
                type="number"
                value={bounds[index]}
                onChange={(event) =>
                  setBounds(
                    bounds.map((value, i) =>
                      i === index ? Number(event.target.value) : value,
                    ),
                  )
                }
              />
            </label>
          ))}
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={allPages}
            onChange={(event) => setAllPages(event.target.checked)}
          />
          All pages
        </label>
        <button
          className="wide-button primary"
          disabled={busy}
          onClick={() =>
            mutate(
              {
                pages: allPages ? pages.map((item) => item.index) : [page],
                [box]: bounds,
              },
              "boxes",
            )
          }
        >
          Save page box
        </button>
      </details>
      <details>
        <summary>Output color profile</summary>
        <label>
          ICC profile
          <input
            aria-label="Output ICC profile"
            type="file"
            accept=".icc,.icm"
            onChange={(event) => setIcc(event.target.files?.[0] || null)}
          />
        </label>
        <label>
          Identifier
          <input
            aria-label="Output profile identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </label>
        <label>
          Intent
          <select
            aria-label="Output intent"
            value={subtype}
            onChange={(event) => setSubtype(event.target.value)}
          >
            <option value="GTS_PDFX">Print production</option>
            <option value="GTS_PDFA1">Archival</option>
          </select>
        </label>
        <p className="help-text">
          Embedding a profile declares the intended output. It does not convert
          existing colors or certify the PDF standard.
        </p>
        <button
          className="wide-button primary"
          disabled={busy || !icc || !identifier.trim()}
          onClick={saveIntent}
        >
          Attach output profile
        </button>
      </details>
    </>
  );
}
