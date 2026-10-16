package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.modules.api.ArtisanModule
import net.artisanmc.modules.api.command.CommandRegistry
import net.artisanmc.modules.api.datasource.DataSourceRegistry
import net.artisanmc.modules.api.event.ModuleEventBus
import net.artisanmc.modules.api.ModuleRegistry
import net.artisanmc.modules.api.schemas.SchemaRegistry
import net.artisanmc.plugin.provider.SyncedMenuProvider
import okhttp3.WebSocket
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.nio.file.Files
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Integration test: external registrant → presence seam.
 *
 * Proves: a simulated external `depend:[Artisan]` plugin obtains [ArtisanAPI] via
 * [org.bukkit.plugin.ServicesManager], calls `api.modules.register(module)` **after**
 * the WS `hello` handshake, and a `modules_changed` frame carrying that module
 * reaches the (mock) hub.
 *
 * Drives SyncedMenuProvider directly against MockWebServer, builds ArtisanAPI +
 * ModuleRegistry the same way ArtisanPlugin.buildApi does, then registers a "quests"
 * module post-hello.
 */
class ModuleRegistrationIntegrationTest {

    private val mapper = ObjectMapper()

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    /** A minimal stub module simulating an external `artisan-quests` plugin. */
    private fun questsModule() = object : ArtisanModule {
        override fun getId() = "quests"
        override fun getSchemaVersion() = "quests/v1"
        override fun onEnable(api: ArtisanAPI) {}
        override fun onDisable() {}
    }

    @Test
    fun `register post-hello produces modules_changed frame carrying the registered module`() {
        val packsDir = Files.createTempDirectory("artisan_modreg_").toFile()

        // Collect every frame sent by the provider so we can assert on them.
        val received = Collections.synchronizedList(mutableListOf<Map<*, *>>())
        // We need two latches:
        //   1. helloLatch  — the hub received the hello → we can register the module
        //   2. changedLatch — provider sent a modules_changed frame
        val helloLatch = CountDownLatch(1)
        val changedLatch = CountDownLatch(1)

        // Build the registry and API the same way ArtisanPlugin.buildApi does,
        // but wire onChange to call notifyModulesChanged on the provider we'll create.
        // We use a late-init var for the provider because ModuleRegistry.bind(onChange)
        // needs a reference to the provider, and the provider needs the registry supplier.
        var provider: SyncedMenuProvider? = null

        val registry = ModuleRegistry()
        // We need a real JavaPlugin for the ArtisanAPI constructor — use MockBukkit to load one.
        val artisanPlugin = MockBukkit.load(ArtisanPlugin::class.java)
        val api = ArtisanAPI.builder(
            artisanPlugin,
            DataSourceRegistry(),
            CommandRegistry(),
            ModuleEventBus(),
            SchemaRegistry(),
            registry,
            "1.0.0",
            object : net.artisanmc.modules.api.project.ProjectContentApi {
                override fun projectIds() = emptyList<String>()
                override fun list(projectId: String, dir: String) = emptyList<String>()
                override fun read(projectId: String, relPath: String): String? = null
                override fun hasContent(dir: String) = false
            },
        )
            .build()
        registry.bind(api) {
            // onChange fires whenever the active module list changes.
            provider?.notifyModulesChanged()
        }

        MockWebServer().use { server ->
            server.enqueue(MockResponse().withWebSocketUpgrade(object : ClosingWebSocketListener() {
                override fun onMessage(ws: WebSocket, text: String) {
                    val node = mapper.readTree(text)
                    when (node["type"]?.asText()) {
                        "hello" -> {
                            // Respond with a minimal hello_ack so the provider settles.
                            ws.send(mapper.writeValueAsString(mapOf(
                                "type"       to "hello_ack",
                                "session_id" to "sess_modreg",
                            )))
                            helloLatch.countDown()
                        }
                        "modules_changed" -> {
                            @Suppress("UNCHECKED_CAST")
                            received.add(mapper.readValue(text, Map::class.java) as Map<*, *>)
                            changedLatch.countDown()
                        }
                    }
                }
            }))
            server.start()

            provider = SyncedMenuProvider(
                roots            = net.artisanmc.plugin.project.ProjectRoots(packsDir),
                logger           = null,
                hub              = net.artisanmc.plugin.ws.HubLink(server.url("/ws/plugin").toString(), "secret", "survie"),
                announcement     = {
                    net.artisanmc.plugin.protocol.ServerAnnouncement(
                        modules = registry.active().map { net.artisanmc.plugin.protocol.ServerAnnouncement.module(it.id, "1.0.0") },
                    )
                },
            )
            provider!!.load()

            // Wait for hello to complete before registering the external module.
            assertTrue(helloLatch.await(5, TimeUnit.SECONDS), "hello not received within 5s")
            // Small settle so hello_ack is processed before we register.
            Thread.sleep(100)

            // --- External registrant seam ---
            // Simulate what artisan-quests would do:
            //   val api = server.servicesManager.getRegistration(ArtisanAPI::class.java)!!.provider
            //   api.modules.register(questsModule)
            // Here we use the api we built directly (same object that would be in ServicesManager).
            api.modules.register(questsModule())

            // Assert that a modules_changed frame arrives at the hub within 5s.
            assertTrue(changedLatch.await(5, TimeUnit.SECONDS),
                "Expected modules_changed frame within 5s after register(). Received frames: $received")

            val frame = received.firstOrNull { it["type"] == "modules_changed" }
            assertNotNull(frame, "modules_changed frame must be in received list")

            @Suppress("UNCHECKED_CAST")
            val installedModules = frame!!["installed_modules"] as? List<*>
            assertNotNull(installedModules, "modules_changed must carry installed_modules list")

            val moduleIds = installedModules!!
                .filterIsInstance<Map<*, *>>()
                .map { it["id"] as? String }
            assertTrue("quests" in moduleIds,
                "installed_modules must contain 'quests'. Got: $moduleIds")

            provider!!.unload()
        }
    }
}
