import { useEffect, useState } from "react";
import { useThemeStore } from "@/state/themeStore";

// Konva paint commands need literal color strings — canvas context doesn't
// resolve `var(--token)`. This hook reads the computed value of a CSS custom
// property and re-reads when the theme toggles.
export function useCssVar(token: string): string {
  const theme = useThemeStore((s) => s.theme);
  const [value, setValue] = useState(() => readVar(token));
  useEffect(() => {
    setValue(readVar(token));
  }, [theme, token]);
  return value;
}

function readVar(token: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}
