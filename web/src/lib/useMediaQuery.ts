import { useEffect, useState } from "react";

/** Subscribe to a CSS media query — re-renders when match flips. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

/** Tailwind `lg:` is `≥1024px`. Same threshold here for layout mode. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
