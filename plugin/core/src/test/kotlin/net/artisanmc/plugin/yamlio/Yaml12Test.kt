package net.artisanmc.plugin.yamlio

import com.fasterxml.jackson.databind.ObjectMapper
import kotlin.test.Test
import kotlin.test.assertEquals

class Yaml12Test {
    private val mapper = ObjectMapper(Yaml12.factory())

    @Test fun `YAML 1_1 boolean words stay text, as the editor reads them`() {
        val words = listOf("on", "off", "On", "OFF", "yes", "no", "Yes", "NO", "y", "n", "Y", "N")
        val read = mapper.readValue("values: [${words.joinToString()}]\nflag: on\n", Map::class.java)
        assertEquals(words, read["values"])
        assertEquals("on", read["flag"])
    }

    @Test fun `true and false are still booleans, a quoted word still text`() {
        val read = mapper.readValue("a: true\nb: False\nc: \"on\"\nd: 'yes'\n", Map::class.java)
        assertEquals(mapOf("a" to true, "b" to false, "c" to "on", "d" to "yes"), read)
    }
}
