package net.artisanmc.plugin.update

import net.artisanmc.plugin.update.ModuleUpdater.Outcome
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ModuleUpdaterTest {
    private val keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
    private val trusted = listOf(Base64.getEncoder().encodeToString(keys.public.encoded))
    private val server = MockWebServer()
    private lateinit var dir: File
    private lateinit var installed: File

    /** What the release serves: the jar's bytes and its release.json. */
    private var jar = jarOf("Rewards", "1.1.0")
    private var manifest = signed("Rewards", "1.1.0", jar)

    @BeforeTest
    fun setup() {
        dir = Files.createTempDirectory("updater").toFile()
        installed = File(dir, "Rewards-1.0.0.jar").apply { writeBytes(jarOf("Rewards", "1.0.0")) }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.path) {
                "/repos/me/rewards/releases/latest" -> MockResponse().setBody(
                    """{"assets":[{"name":"release.json","browser_download_url":"${server.url("/d/release.json")}"},
                       {"name":"Rewards-1.1.0.jar","browser_download_url":"${server.url("/d/rewards.jar")}"}]}""",
                )
                "/d/release.json" -> MockResponse().setBody(manifest)
                "/d/rewards.jar" -> MockResponse().setBody(Buffer().write(jar))
                else -> MockResponse().setResponseCode(404)
            }
        }
        server.start()
    }

    @AfterTest
    fun teardown() {
        server.shutdown()
        dir.deleteRecursively()
    }

    private fun updater(keys: List<String> = trusted) =
        ModuleUpdater(File(dir, "update"), keys, github = server.url("/").toString().trimEnd('/'))

    private val source get() = ModuleUpdater.Source("Rewards", "1.0.0", "me/rewards", installed)

    private fun jarOf(name: String, version: String): ByteArray = ByteArrayOutputStream().also { out ->
        ZipOutputStream(out).use { zip ->
            zip.putNextEntry(ZipEntry("plugin.yml"))
            zip.write("name: $name\nversion: '$version'\nmain: x.Main\nartisan-releases: me/rewards\n".toByteArray())
            zip.closeEntry()
        }
    }.toByteArray()

    private fun signed(plugin: String, version: String, bytes: ByteArray, sha: String = SignedRelease.sha256(bytes)): String {
        val signature = Signature.getInstance("Ed25519").run {
            initSign(keys.private)
            update(SignedRelease.message(plugin, version, sha))
            Base64.getEncoder().encodeToString(sign())
        }
        return """{"plugin":"$plugin","version":"$version","sha256":"$sha","signature":"$signature"}"""
    }

    @Test
    fun `a newer release is reported`() {
        assertEquals(Outcome.Available("Rewards", "1.0.0", "1.1.0"), updater().check(source))
    }

    @Test
    fun `a signed newer release is staged under the installed jar's name`() {
        val outcome = updater().stage(source)
        assertEquals(Outcome.Staged("Rewards", "1.1.0", File(dir, "update/Rewards-1.0.0.jar")), outcome)
        assertTrue(File(dir, "update/Rewards-1.0.0.jar").readBytes().contentEquals(jar))
        assertFalse(File(dir, "update/Rewards-1.0.0.jar.part").exists())
    }

    @Test
    fun `nothing is staged without a trusted key`() {
        assertEquals(Outcome.Failed("Rewards", "no_trusted_key"), updater(emptyList()).stage(source))
        val other = Base64.getEncoder().encodeToString(KeyPairGenerator.getInstance("Ed25519").generateKeyPair().public.encoded)
        assertEquals(Outcome.Failed("Rewards", "bad_signature"), updater(listOf(other)).stage(source))
        assertFalse(File(dir, "update").listFiles().orEmpty().any())
    }

    @Test
    fun `a jar other than the signed one is refused`() {
        jar = jarOf("Rewards", "1.1.0") + byteArrayOf(0)
        assertEquals(Outcome.Failed("Rewards", "bad_signature"), updater().stage(source))
    }

    @Test
    fun `a release signed for another plugin is refused`() {
        manifest = signed("Auctions", "1.1.0", jar)
        assertEquals(Outcome.Failed("Rewards", "mismatch"), updater().stage(source))
    }

    @Test
    fun `a signed jar whose descriptor says another version is refused`() {
        jar = jarOf("Rewards", "1.2.0")
        manifest = signed("Rewards", "1.1.0", jar)
        assertEquals(Outcome.Failed("Rewards", "mismatch"), updater().stage(source))
        assertFalse(File(dir, "update").listFiles().orEmpty().any())
    }

    @Test
    fun `an older or equal release is not staged`() {
        jar = jarOf("Rewards", "1.0.0")
        manifest = signed("Rewards", "1.0.0", jar)
        assertEquals(Outcome.UpToDate("Rewards", "1.0.0"), updater().check(source))
        assertEquals(Outcome.Failed("Rewards", "not_newer"), updater().stage(source))
    }

    @Test
    fun `a repository without releases says so`() {
        assertEquals(Outcome.Failed("Rewards", "no_release"), updater().check(source.copy(repo = "me/none")))
    }

    @Test
    fun `a jar names its releases in its descriptor`() {
        assertEquals("me/rewards", ModuleUpdater.descriptor(installed)?.getString(ModuleUpdater.RELEASES_KEY))
    }
}
