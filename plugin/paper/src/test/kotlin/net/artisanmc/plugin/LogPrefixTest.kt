package net.artisanmc.plugin

import java.util.logging.Handler
import java.util.logging.LogRecord
import java.util.logging.Logger
import kotlin.test.Test
import kotlin.test.assertEquals

class LogPrefixTest {
    @Test fun `the plugin logger prints its prefix once`() {
        val logger = Logger.getAnonymousLogger().apply { useParentHandlers = false }
        val lines = mutableListOf<String>()
        logger.addHandler(object : Handler() {
            override fun publish(record: LogRecord) { lines += record.message }
            override fun flush() {}
            override fun close() {}
        })
        LogPrefix.install(logger)
        logger.info("[Artisan] Minecraft 26.2 item icons ready.")
        logger.warning("no prefix here")
        logger.info("Server [Artisan] in the middle")
        assertEquals(listOf("Minecraft 26.2 item icons ready.", "no prefix here", "Server [Artisan] in the middle"), lines)
    }
}
