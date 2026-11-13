import { useEffect, useState } from "react";

export type Appearance = "light" | "dark" | "system";
const key = "folio.appearance.v1";
function read(): Appearance {
  try {
    const value = localStorage.getItem(key);
    if (value === "light" || value === "dark") return value;
  } catch {
    /* Storage can be unavailable in private browser contexts. */
  }
  return "system";
}
function apply(value: Appearance) {
  document.documentElement.dataset.theme =
    value === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : value;
}
apply(read());
export function useAppearance() {
  const [value, setValue] = useState<Appearance>(read);
  useEffect(() => {
    apply(value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* The current window still works. */
    }
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => apply(value);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [value]);
  return [value, setValue] as const;
}
