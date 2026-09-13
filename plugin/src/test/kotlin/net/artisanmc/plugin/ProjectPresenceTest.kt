package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.provider.SyncedMenuProvider
import okhttp3.WebSocket
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ProjectPresenceTest {
    @Test
    fun `hello sends cached identity without acquiring project mutation lock`() {
        val server = MockWebServer()
        val hello = CountDownLatch(1)
        server.enqueue(MockResponse().withWebSocketUpgrade(object : ClosingWebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) { hello.countDown() }
        }))
        server.start()
        val roots = ProjectRoots(Files.createTempDirectory("artisan_presence").toFile())
        val provider = SyncedMenuProvider(roots, "test", server.url("/ws/plugin").toString(), null)
        try {
            synchronized(roots) {
                provider.load()
                assertTrue(hello.await(3, TimeUnit.SECONDS), "WS hello must not wait for a filesystem mutation")
            }
        } finally {
            provider.shutdown()
            server.shutdown()
        }
    }
}
