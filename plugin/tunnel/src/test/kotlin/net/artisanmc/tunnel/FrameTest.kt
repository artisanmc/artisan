package net.artisanmc.tunnel

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class FrameTest {
    @Test
    fun `a frame survives encoding`() {
        val head = RequestHead("POST", "/api/v1/x?y=1", listOf(listOf("Host", "abc.tunnel.test"), listOf("Cookie", "a=b")))
        val frame = Frame.decode(Frame.json(Frame.Type.REQUEST, 42, head).encode())
        assertEquals(Frame.Type.REQUEST, frame.type)
        assertEquals(42, frame.stream)
        assertEquals(head, frame.json<RequestHead>())

        val bytes = byteArrayOf(0, -1, 7)
        assertContentEquals(bytes, Frame.decode(Frame(Frame.Type.REQUEST_BODY, Int.MAX_VALUE, bytes).encode()).payload)
    }

    @Test
    fun `the tunnel id is stable, short and depends on the secret`() {
        val id = Tunnel.id("secret-a")
        assertEquals(id, Tunnel.id("secret-a"))
        assertNotEquals(id, Tunnel.id("secret-b"))
        assertEquals(16, id.length)
        assertTrue(id.all { it in 'a'..'z' || it in '2'..'7' }, id)
    }

    @Test
    fun `names are short lowercase labels that cannot pass for an id`() {
        listOf("survie", "spartacube-survie", "mc1", "a".repeat(32)).forEach { assertTrue(Tunnel.validName(it), it) }
        listOf("ab", "Survie", "-survie", "survie-", "xn--abc", "sur.vie", "sur_vie", "a".repeat(33), Tunnel.id("x"))
            .forEach { assertTrue(!Tunnel.validName(it), it) }
    }

    @Test
    fun `a newer end's fields are skipped`() {
        val frame = Frame(Frame.Type.HELLO, 0, """{"url":"https://a.b","name":"x","later":1}""".toByteArray())
        assertEquals(Hello("https://a.b", "x"), frame.json<Hello>())
    }
}
