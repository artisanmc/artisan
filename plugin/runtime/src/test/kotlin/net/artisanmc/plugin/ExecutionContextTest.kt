package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.plugin.engine.ExecutionContext
import kotlin.test.*

class ExecutionContextTest {
    private lateinit var server: ServerMock
    @BeforeTest fun setup() { server = MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    @Test fun `resolvedArgs injects the viewing player as 'player'`() {
        val p = server.addPlayer("Steve")
        val ctx = ExecutionContext(player = p)
        assertSame(p, ctx.resolvedArgs["player"])
    }

    @Test fun `resolvedArgs never overrides a caller-provided 'player' arg`() {
        val p = server.addPlayer("Steve")
        val ctx = ExecutionContext(player = p, args = mapOf("player" to "custom"))
        assertEquals("custom", ctx.resolvedArgs["player"])
    }

    @Test fun `resolvedArgs keeps other args intact`() {
        val p = server.addPlayer("Steve")
        val ctx = ExecutionContext(player = p, args = mapOf("n" to 1))
        assertEquals(1, ctx.resolvedArgs["n"])
        assertSame(p, ctx.resolvedArgs["player"])
    }
}
