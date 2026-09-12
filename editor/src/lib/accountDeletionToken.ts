// Read before analytics initializes; the bearer secret stays only in memory.
export const accountDeletionToken = (() => {
  if (typeof window === "undefined" || window.location.pathname !== "/delete-account") return "";
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
  window.history.replaceState(window.history.state, "", window.location.pathname);
  return token;
})();
