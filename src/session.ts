export type SavedSession = {
  documentId: string;
  page: number;
  zoom: number;
  fitWidth: boolean;
};
const key = "folio.document-session.v1";

export function readSession(): SavedSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (
      !value ||
      typeof value.documentId !== "string" ||
      !/^[a-f0-9]{32}$/.test(value.documentId)
    )
      return null;
    return {
      documentId: value.documentId,
      page: Number.isInteger(value.page) && value.page >= 0 ? value.page : 0,
      zoom:
        typeof value.zoom === "number" && Number.isFinite(value.zoom)
          ? Math.max(0.15, Math.min(3, value.zoom))
          : 1,
      fitWidth: typeof value.fitWidth === "boolean" ? value.fitWidth : true,
    };
  } catch {
    return null;
  }
}

export function writeSession(session: SavedSession) {
  try {
    localStorage.setItem(key, JSON.stringify(session));
  } catch {
    /* Storage can be disabled by the browser. The open document stays usable. */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Storage can be disabled by the browser. */
  }
}

export function exportName(name: string, extension: string): string {
  const stem =
    name
      .replace(/\.pdf$/i, "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/, "")
      .trim() || "Document";
  return `${stem}.${extension}`;
}
