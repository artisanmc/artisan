package net.artisanmc.plugin.update

import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SignedReleaseTest {
    private val keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
    private val publicKey = Base64.getEncoder().encodeToString(keys.public.encoded)
    private val jar = "jar bytes".toByteArray()

    private fun signed(plugin: String = "ArtisanDailyRewards", version: String = "1.0.3", sha: String = SignedRelease.sha256(jar)): ReleaseManifest {
        val signature = Signature.getInstance("Ed25519").run {
            initSign(keys.private)
            update(SignedRelease.message(plugin, version, sha))
            sign()
        }
        return ReleaseManifest(plugin, version, sha, Base64.getEncoder().encodeToString(signature))
    }

    @Test
    fun `a release signed by a pinned key verifies`() {
        assertTrue(SignedRelease.verify(signed(), listOf("not a key", publicKey)))
    }

    @Test
    fun `any change to the signed fields breaks the signature`() {
        val release = signed()
        assertFalse(SignedRelease.verify(release.copy(plugin = "ArtisanAuctions"), listOf(publicKey)))
        assertFalse(SignedRelease.verify(release.copy(version = "1.0.4"), listOf(publicKey)))
        assertFalse(SignedRelease.verify(release.copy(sha256 = SignedRelease.sha256("other".toByteArray())), listOf(publicKey)))
    }

    @Test
    fun `another key, no key or a malformed signature never verify`() {
        val other = Base64.getEncoder().encodeToString(KeyPairGenerator.getInstance("Ed25519").generateKeyPair().public.encoded)
        assertFalse(SignedRelease.verify(signed(), listOf(other)))
        assertFalse(SignedRelease.verify(signed(), emptyList()))
        assertFalse(SignedRelease.verify(signed().copy(signature = "%%%"), listOf(publicKey)))
    }

    /** The bytes `sign-release.yml` signs: no trailing newline. */
    @Test
    fun `the signed message matches the release script`() {
        assertEquals("artisan-release\nP\n1.0\nab", String(SignedRelease.message("P", "1.0", "ab")))
    }

    /** A release.json written by `sign-release.yml` (OpenSSL) with a throwaway test key. */
    @Test
    fun `a signature made by the release script verifies`() {
        val release = ReleaseManifest(
            "ArtisanDailyRewards", "1.0.3", "3dbdfe10c2fd527af5caa88d8a3fa4b969c0f98025be37ea0328e4fb8554be25",
            "vtehrCeSfbqN5Y1x7712ps5nZVQqgJKjAnnzw7I/YrKlizYKIAaMfKbV8y1JWPGB5qvL9p8y5/5EDWSwz6qECA==",
        )
        val scriptKey = "MCowBQYDK2VwAyEAUm3zMKcf/Xa0hQX5+K1FyG55lGp7NzVc3tfMDmDVfOE="
        assertTrue(SignedRelease.verify(release, listOf(scriptKey)))
        assertFalse(SignedRelease.verify(release.copy(version = "1.0.4"), listOf(scriptKey)))
    }

    @Test
    fun `a manifest without a field is refused`() {
        assertNull(ReleaseManifest.parse(mapOf("plugin" to "P", "version" to "1", "sha256" to "ab")))
        assertEquals("ab", ReleaseManifest.parse(mapOf("plugin" to "P", "version" to "1", "sha256" to "AB", "signature" to "s"))?.sha256)
    }

    @Test
    fun `versions compare by number, a release after its snapshot`() {
        assertTrue(PluginVersions.isNewer("1.0.10", "1.0.9"))
        assertTrue(PluginVersions.isNewer("1.1", "1.0.9"))
        assertTrue(PluginVersions.isNewer("1.0.0", "1.0.0-SNAPSHOT"))
        assertFalse(PluginVersions.isNewer("1.0.3", "1.0.3"))
        assertFalse(PluginVersions.isNewer("1.0.2", "v1.0.3"))
        assertEquals(0, PluginVersions.compare("1.0", "1.0.0"))
    }
}
