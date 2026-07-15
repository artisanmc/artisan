package net.artisanmc.plugin.ws

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** Outcome of redeeming a link code. */
sealed class LinkResult {
    data class Success(val serverKey: String, val networkName: String?) : LinkResult()
    /** [reason] is a backend error code (`expired`, `already_redeemed`, `not_found`) or `network`/`invalid_response`/`http_<n>`. */
    data class Failure(val reason: String) : LinkResult()
}

/**
 * Exchanges a link code for the server_key secret via
 * `POST {httpBase}/api/v1/link/{code}/redeem`. Blocking — call off the main
 * thread. Replaces the old WS `SetupClient` pairing: the editor mints the code
 * when the Server is created, the plugin redeems it here.
 */
class LinkClient(
    private val httpBaseUrl: String,
    private val mapper: ObjectMapper = ObjectMapper(),
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build(),
) {
    fun redeem(code: String): LinkResult {
        val req = Request.Builder()
            .url("$httpBaseUrl/api/v1/link/$code/redeem")
            .post(ByteArray(0).toRequestBody(null))
            .build()
        return try {
            httpClient.newCall(req).execute().use { resp ->
                val bodyText = resp.body?.string() ?: ""
                if (!resp.isSuccessful) {
                    val reason = runCatching { mapper.readTree(bodyText)["error"]?.asText() }.getOrNull()
                    return LinkResult.Failure(reason ?: "http_${resp.code}")
                }
                val node = runCatching { mapper.readTree(bodyText) }.getOrNull()
                    ?: return LinkResult.Failure("invalid_response")
                val key = node["server_key"]?.asText()?.takeIf { it.isNotBlank() }
                    ?: return LinkResult.Failure("invalid_response")
                LinkResult.Success(key, node["network_name"]?.asText()?.takeIf { it.isNotBlank() })
            }
        } catch (_: Exception) {
            LinkResult.Failure("network")
        }
    }
}
