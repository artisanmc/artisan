package net.artisanmc.tunnelserver

import org.eclipse.jetty.http.HttpHeader
import org.eclipse.jetty.server.Request
import org.eclipse.jetty.server.Response
import org.eclipse.jetty.util.Callback
import java.nio.ByteBuffer

/**
 * What a browser sees on `<id>.<domain>` when the Minecraft server behind it does not answer: its own
 * page, in 503. Cloudflare swaps a 502 or 504 from the origin for its "Bad gateway" page, which blames
 * the host and reads as Artisan being down; a 503 goes through as sent. Scripts (no `text/html` in
 * `Accept`) get the same status in plain text.
 */
object OfflinePage {
    enum class Reason { OFFLINE, NO_ANSWER }

    /** Seconds before the page reloads itself, and the `Retry-After` it sends. */
    const val RETRY_SECONDS = 30

    fun write(request: Request, response: Response, callback: Callback, reason: Reason, host: String) {
        val html = request.headers.get(HttpHeader.ACCEPT)?.contains("text/html") == true
        val french = french(request.headers.get(HttpHeader.ACCEPT_LANGUAGE))
        response.status = 503
        response.headers.put(HttpHeader.CACHE_CONTROL, "no-store")
        response.headers.put(HttpHeader.RETRY_AFTER, RETRY_SECONDS.toString())
        val body = if (html) {
            response.headers.put(HttpHeader.CONTENT_TYPE, "text/html; charset=utf-8")
            html(reason, host, french)
        } else {
            response.headers.put(HttpHeader.CONTENT_TYPE, "text/plain; charset=utf-8")
            when (reason) {
                Reason.OFFLINE -> "This Artisan server is not connected to the tunnel server."
                Reason.NO_ANSWER -> "The Artisan server did not answer."
            }
        }
        response.write(true, ByteBuffer.wrap(body.toByteArray()), callback)
    }

    /** The browser's first language: French when it starts with `fr`, English otherwise. */
    fun french(acceptLanguage: String?): Boolean =
        acceptLanguage?.split(',')?.firstOrNull()?.trim()?.lowercase()?.startsWith("fr") == true

    fun html(reason: Reason, host: String, french: Boolean): String {
        val t = if (french) FR else EN
        val title = if (reason == Reason.OFFLINE) t.offlineTitle else t.noAnswerTitle
        val lead = if (reason == Reason.OFFLINE) t.offlineLead else t.noAnswerLead
        return """<!doctype html>
<html lang="${t.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="$RETRY_SECONDS">
<meta name="robots" content="noindex">
<title>$title · Artisan</title>
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
<h1>$title</h1>
<p>${lead.replace("{host}", "<span class=\"host\">${escape(host)}</span>")}</p>
<ul>
<li class="ok"><span class="dot"></span><span>${t.network}</span><span>${t.working}</span></li>
<li class="off"><span class="dot"></span><span>${t.server}</span><span>${if (reason == Reason.OFFLINE) t.offline else t.notAnswering}</span></li>
</ul>
<p>${t.what}</p>
<small>${t.retry}</small>
</main>
</body>
</html>
"""
    }

    private fun escape(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    private class Texts(
        val lang: String,
        val offlineTitle: String,
        val offlineLead: String,
        val noAnswerTitle: String,
        val noAnswerLead: String,
        val network: String,
        val working: String,
        val server: String,
        val offline: String,
        val notAnswering: String,
        val what: String,
        val retry: String,
    )

    private val FR = Texts(
        lang = "fr",
        offlineTitle = "Ce serveur Minecraft est hors ligne",
        offlineLead = "Le serveur derrière {host} n'est pas connecté pour le moment : il est éteint, en train de redémarrer, ou Artisan n'y est pas lancé.",
        noAnswerTitle = "Ce serveur Minecraft ne répond pas",
        noAnswerLead = "Le serveur derrière {host} est connecté mais n'a pas répondu à temps. Il est peut-être surchargé ou en train de redémarrer.",
        network = "Réseau Artisan",
        working = "Opérationnel",
        server = "Serveur Minecraft",
        offline = "Hors ligne",
        notAnswering = "Ne répond pas",
        what = "Le réseau Artisan fonctionne normalement. Si vous administrez ce serveur, démarrez-le ou vérifiez qu'Artisan s'y charge sans erreur : l'adresse se reconnecte d'elle-même.",
        retry = "Cette page se recharge toute seule toutes les $RETRY_SECONDS secondes.",
    )

    private val EN = Texts(
        lang = "en",
        offlineTitle = "This Minecraft server is offline",
        offlineLead = "The server behind {host} is not connected right now: it is stopped, restarting, or Artisan is not running on it.",
        noAnswerTitle = "This Minecraft server is not responding",
        noAnswerLead = "The server behind {host} is connected but did not answer in time. It may be overloaded or restarting.",
        network = "Artisan network",
        working = "Operational",
        server = "Minecraft server",
        offline = "Offline",
        notAnswering = "Not responding",
        what = "The Artisan network is working normally. If you run this server, start it or check that Artisan loads without errors: the address reconnects by itself.",
        retry = "This page reloads by itself every $RETRY_SECONDS seconds.",
    )
}
