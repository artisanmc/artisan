package net.artisanmc.plugin

import net.artisanmc.plugin.update.PluginUpdater
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.io.File
import java.nio.file.Files
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.util.Base64
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class PluginUpdaterTest {
    private val keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
    private val publicKey = Base64.getEncoder().encodeToString(keys.public.encoded)
    private val server = MockWebServer().apply { start() }
    private val updateDir = Files.createTempDirectory("update").toFile()
    private val target = File(updateDir, "Artisan.jar")

    @AfterTest fun tearDown() = server.shutdown()

    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun sign(version: String, sha: String, key: PrivateKey = keys.private): String =
        Base64.getEncoder().encodeToString(Signature.getInstance("Ed25519").run {
            initSign(key); update(PluginUpdater.message(version, sha).toByteArray()); sign()
        })

    private fun release(version: String, jar: ByteArray, signature: String = sign(version, sha256(jar)), served: ByteArray = jar) {
        server.enqueue(MockResponse().setBody("""{"version":"$version","sha256":"${sha256(jar)}","signature":"$signature","size":${jar.size}}"""))
        server.enqueue(MockResponse().setBody(okio.Buffer().write(served)))
    }

    private fun updater(current: String = "1.0.1") =
        PluginUpdater(server.url("/").toString().trimEnd('/'), "sk_test", current, target, publicKey)

    @Test fun `installe le JAR signe dans le dossier update`() {
        release("1.0.2", "new jar".toByteArray())
        assertEquals(PluginUpdater.Result(true, "1.0.2"), updater().install())
        assertEquals("new jar", target.readText())
        server.takeRequest()
        assertEquals("Bearer sk_test", server.takeRequest().getHeader("Authorization"))
        assertEquals(listOf("Artisan.jar"), updateDir.list()!!.toList())
    }

    @Test fun `refuse une signature d'une autre cle sans rien ecrire`() {
        val jar = "evil".toByteArray()
        val other = KeyPairGenerator.getInstance("Ed25519").generateKeyPair().private
        release("1.0.2", jar, signature = sign("1.0.2", sha256(jar), other))
        assertEquals(PluginUpdater.Result(false, error = "invalid_signature"), updater().install())
        assertFalse(target.exists())
    }

    @Test fun `refuse un JAR different de celui qui a ete signe`() {
        release("1.0.2", "signed".toByteArray(), served = "swapped".toByteArray())
        assertEquals(PluginUpdater.Result(false, error = "invalid_signature"), updater().install())
        assertFalse(target.exists())
    }

    @Test fun `refuse une version qui n'est pas plus recente`() {
        release("1.0.1", "same".toByteArray())
        assertEquals(PluginUpdater.Result(false, error = "not_newer"), updater().install())
        assertEquals(1, server.requestCount)
    }

    @Test fun `une version de dev accepte toute release`() {
        release("1.0.7", "jar".toByteArray())
        assertEquals(PluginUpdater.Result(true, "1.0.7"), updater("1.0.0-SNAPSHOT").install())
    }

    @Test fun `un plugin release refuse un build staging`() {
        release("1.0.9-staging", "jar".toByteArray())
        assertEquals(PluginUpdater.Result(false, error = "not_newer"), updater("1.0.1").install())
    }

    @Test fun `un plugin staging refuse une release prod`() {
        release("1.0.9", "jar".toByteArray())
        assertEquals(PluginUpdater.Result(false, error = "not_newer"), updater("1.0.1-staging").install())
    }

    @Test fun `un plugin staging suit le canal staging`() {
        release("1.0.9-staging", "jar".toByteArray())
        assertEquals(PluginUpdater.Result(true, "1.0.9-staging"), updater("1.0.1-staging").install())
    }

    @Test fun `aucune release publiee`() {
        server.enqueue(MockResponse().setResponseCode(404))
        assertEquals(PluginUpdater.Result(false, error = "no_release"), updater().install())
    }
}
