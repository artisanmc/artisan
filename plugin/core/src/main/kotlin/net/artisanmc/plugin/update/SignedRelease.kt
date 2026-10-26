package net.artisanmc.plugin.update

import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * `release.json` of a plugin's GitHub Release, written by the repository's `scripts/sign-release.sh`:
 * the jar's plugin name, version and SHA-256, signed with Ed25519 by the release workflow.
 */
data class ReleaseManifest(val plugin: String, val version: String, val sha256: String, val signature: String) {
    companion object {
        /** Null when a field is missing or not a string. */
        fun parse(json: Map<*, *>): ReleaseManifest? {
            fun text(key: String) = (json[key] as? String)?.takeIf { it.isNotBlank() }
            return ReleaseManifest(
                text("plugin") ?: return null,
                text("version") ?: return null,
                text("sha256")?.lowercase() ?: return null,
                text("signature") ?: return null,
            )
        }
    }
}

/**
 * Why a release can be trusted: its signature checks against a key Artisan pins, and the jar
 * downloaded is the one signed. The download source (GitHub) only carries bytes.
 */
object SignedRelease {
    /** What the release workflow signs: the plugin's name is in it, so a jar cannot pass for another plugin's. */
    fun message(plugin: String, version: String, sha256: String): ByteArray =
        "artisan-release\n$plugin\n$version\n$sha256".toByteArray(Charsets.UTF_8)

    /** True when one of [publicKeys] (Base64 X.509 Ed25519 keys) signed [manifest]. */
    fun verify(manifest: ReleaseManifest, publicKeys: List<String>): Boolean {
        val signature = runCatching { Base64.getDecoder().decode(manifest.signature) }.getOrNull() ?: return false
        val message = message(manifest.plugin, manifest.version, manifest.sha256)
        return publicKeys.any { key ->
            runCatching {
                val publicKey = KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(key)))
                Signature.getInstance("Ed25519").run {
                    initVerify(publicKey)
                    update(message)
                    verify(signature)
                }
            }.getOrDefault(false)
        }
    }

    fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}

/** Plugin versions as releases write them: `1.0.10` after `1.0.9`; a qualifier (`-SNAPSHOT`) before the plain release. */
object PluginVersions {
    fun compare(a: String, b: String): Int {
        val (aNumbers, aQualifier) = split(a)
        val (bNumbers, bQualifier) = split(b)
        for (i in 0 until maxOf(aNumbers.size, bNumbers.size)) {
            val diff = aNumbers.getOrElse(i) { 0 }.compareTo(bNumbers.getOrElse(i) { 0 })
            if (diff != 0) return diff
        }
        return when {
            aQualifier == bQualifier -> 0
            aQualifier.isEmpty() -> 1
            bQualifier.isEmpty() -> -1
            else -> aQualifier.compareTo(bQualifier)
        }
    }

    fun isNewer(candidate: String, installed: String): Boolean = compare(candidate, installed) > 0

    private fun split(version: String): Pair<List<Long>, String> {
        val core = version.trim().removePrefix("v").substringBefore('-').substringBefore('+')
        val qualifier = version.trim().substringAfter('-', "").substringBefore('+')
        return core.split('.').map { it.toLongOrNull() ?: 0 } to qualifier
    }
}
