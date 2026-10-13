import { useEffect, useState } from "react";

/**
 * Past this, a revalidation IN PROGRESS deserves to be announced.
 *
 * Generous on purpose. A revalidation that succeeds — even in a second and a
 * half — has nothing to report: the displayed content is the previous visit's,
 * it will be replaced, and warning in that interval only flickers. What
 * deserves a notice is a wait that settles in: by then, the user rightly
 * wonders what they are looking at.
 *
 * The REALLY risky case is not this one — it is failure, where the screen can
 * stay dated indefinitely. That one is announced without delay (cf. callers).
 */
export const STALE_NOTICE_DELAY_MS = 3_000;

/**
 * True only once [flag] has stayed true for [delayMs] in a row.
 *
 * For warnings that only matter if they last. A dated display that corrects
 * itself in 200 ms needs to warn no one: the banner would appear and vanish
 * before being read, and that agitation costs more attention than it informs.
 * If it lingers — slow server, offline — then it must be said, and the rule
 * holds: a dated state is never silent.
 *
 * Drops back to false immediately: what is no longer true clears without delay.
 */
export function useSettledFlag(flag: boolean, delayMs: number): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!flag) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), delayMs);
    return () => clearTimeout(timer);
  }, [flag, delayMs]);

  return settled;
}
