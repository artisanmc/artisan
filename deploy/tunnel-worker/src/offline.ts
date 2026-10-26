// The page a browser gets when the Minecraft server behind an address does not answer: OfflinePage.kt,
// same texts and look. Always 503: Cloudflare swaps a 502 or 504 for its "Bad gateway" page.

export type Reason = "offline" | "no_answer";

const RETRY_SECONDS = 30;

interface Texts {
  lang: string; offlineTitle: string; offlineLead: string; noAnswerTitle: string; noAnswerLead: string;
  network: string; working: string; server: string; offline: string; notAnswering: string; what: string; retry: string;
}

const FR: Texts = {
  lang: "fr",
  offlineTitle: "Ce serveur Minecraft est hors ligne",
  offlineLead: "Le serveur derrière {host} n'est pas connecté pour le moment : il est éteint, en train de redémarrer, ou Artisan n'y est pas lancé.",
  noAnswerTitle: "Ce serveur Minecraft ne répond pas",
  noAnswerLead: "Le serveur derrière {host} est connecté mais n'a pas répondu à temps. Il est peut-être surchargé ou en train de redémarrer.",
  network: "Réseau Artisan",
  working: "Opérationnel",
  server: "Serveur Minecraft",
  offline: "Hors ligne",
  notAnswering: "Ne répond pas",
  what: "Le réseau Artisan fonctionne normalement. Si vous administrez ce serveur, démarrez-le ou vérifiez qu'Artisan s'y charge sans erreur : l'adresse se reconnecte d'elle-même.",
  retry: `Cette page se recharge toute seule toutes les ${RETRY_SECONDS} secondes.`,
};

const EN: Texts = {
  lang: "en",
  offlineTitle: "This Minecraft server is offline",
  offlineLead: "The server behind {host} is not connected right now: it is stopped, restarting, or Artisan is not running on it.",
  noAnswerTitle: "This Minecraft server is not responding",
  noAnswerLead: "The server behind {host} is connected but did not answer in time. It may be overloaded or restarting.",
  network: "Artisan network",
  working: "Operational",
  server: "Minecraft server",
  offline: "Offline",
  notAnswering: "Not responding",
  what: "The Artisan network is working normally. If you run this server, start it or check that Artisan loads without errors: the address reconnects by itself.",
  retry: `This page reloads by itself every ${RETRY_SECONDS} seconds.`,
};

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function offlinePage(request: Request, reason: Reason, host: string): Response {
  const headers = { "Cache-Control": "no-store", "Retry-After": String(RETRY_SECONDS) };
  if (!(request.headers.get("Accept") ?? "").includes("text/html")) {
    const body = reason === "offline"
      ? "This Artisan server is not connected to the tunnel server."
      : "The Artisan server did not answer.";
    return new Response(body, { status: 503, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  }
  const first = (request.headers.get("Accept-Language") ?? "").split(",")[0].trim().toLowerCase();
  const t = first.startsWith("fr") ? FR : EN;
  const title = reason === "offline" ? t.offlineTitle : t.noAnswerTitle;
  const lead = (reason === "offline" ? t.offlineLead : t.noAnswerLead)
    .replace("{host}", `<span class="host">${escape(host)}</span>`);
  const html = `<!doctype html>
<html lang="${t.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${RETRY_SECONDS}">
<meta name="robots" content="noindex">
<title>${title} · Artisan</title>
<style>
:root{--surface:#0f1115;--raised:#181b22;--border:#2a2f3a;--text:#f1f5f9;--mut:#94a3b8;--ok:#2ed573;--off:#f59e0b}
@media (prefers-color-scheme:light){:root{--surface:#ffffff;--raised:#f8fafc;--border:#e2e8f0;--text:#0f172a;--mut:#475569;--ok:#179a4e;--off:#b45309}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--surface);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:560px}
.brand{font-weight:700;letter-spacing:.02em;color:var(--ok);margin-bottom:28px}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 12px}
p{margin:0 0 16px;color:var(--mut)}
.host{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--text);word-break:break-all}
ul{list-style:none;margin:24px 0;padding:0;border:1px solid var(--border);border-radius:10px;background:var(--raised)}
li{display:flex;gap:12px;align-items:center;padding:12px 16px}
li+li{border-top:1px solid var(--border)}
.dot{flex:none;width:10px;height:10px;border-radius:50%}
.ok .dot{background:var(--ok)}.off .dot{background:var(--off)}
li span:last-child{margin-left:auto;font-size:.9rem;color:var(--mut)}
.ok span:last-child{color:var(--ok)}.off span:last-child{color:var(--off)}
small{display:block;color:var(--mut);font-size:.85rem}
</style>
</head>
<body>
<main>
<div class="brand">Artisan</div>
<h1>${title}</h1>
<p>${lead}</p>
<ul>
<li class="ok"><span class="dot"></span><span>${t.network}</span><span>${t.working}</span></li>
<li class="off"><span class="dot"></span><span>${t.server}</span><span>${reason === "offline" ? t.offline : t.notAnswering}</span></li>
</ul>
<p>${t.what}</p>
<small>${t.retry}</small>
</main>
</body>
</html>
`;
  return new Response(html, { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
