import { useEffect, useState } from "react";
import { useThemeStore } from "@/state/themeStore";

// Konva paint commands need literal color strings — canvas context doesn't
// resolve `var(--token)`. This hook reads the computed value of a CSS custom
// property and re-reads when the theme toggles.
export function useCssVar(token: string): string {
  const theme = useThemeStore((s) => s.theme);
  const [value, setValue] = useState(() => readVar(token));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `theme` is the re-read trigger — the CSS var's computed value changes when the theme flips, which Biome can't see
  useEffect(() => {
    setValue(readVar(token));
  }, [theme, token]);
  return value;
}

function readVar(token: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}
