/**
 * `setInterval` that skips its ticks while the tab is hidden, and runs once as soon as the tab shows
 * again if it skipped one. Through the tunnel each request costs the hub's address a Durable Object
 * request: a tab forgotten in the background must not keep polling all day. Returns the cleanup.
 */
export function visibleInterval(fn: () => void, ms: number): () => void {
  let missed = false;
  const timer = setInterval(() => {
    if (document.hidden) missed = true;
    else fn();
  }, ms);
  const onVisibility = () => {
    if (document.hidden || !missed) return;
    missed = false;
    fn();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
