package net.artisanmc.tunnelserver

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.logging.Logger

/**
 * Tells a Discord webhook of each name taken, for whoever watches for abuse: the name, its address,
 * the one it replaces and where the plugin connects from. Sent in the background; a failure is logged, never retried.
 */
class NamesWebhook(private val url: String, private val logger: Logger) {
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()

    fun taken(name: String, address: String, id: String, previous: String?, from: String) = post(
        buildString {
            append("Address taken: **$name** → <$address>")
            append("\ntunnel `$id`")
            if (previous != null) append(", was `$previous`")
            append(", from `$from`")
            append("\nRevoke: `DELETE /admin/names/$name` (`?ban=1` keeps it from being taken again)")
        },
    )

    private fun post(content: String) {
        // No mentions: a name such as "everyone" pings nobody.
        val body = mapper.writeValueAsBytes(mapOf("content" to content, "allowed_mentions" to mapOf("parse" to emptyList<String>())))
        val request = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(10))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofByteArray(body))
            .build()
        client.sendAsync(request, HttpResponse.BodyHandlers.discarding()).whenComplete { response, error ->
            if (error != null || response.statusCode() !in 200..299) {
                logger.warning("Names webhook failed: ${error?.message ?: "HTTP ${response.statusCode()}"}")
            }
        }
    }

    private companion object {
        val mapper = jacksonObjectMapper()
    }
}
