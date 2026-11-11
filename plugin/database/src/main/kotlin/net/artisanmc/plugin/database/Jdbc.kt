package net.artisanmc.plugin.database

import java.security.MessageDigest
import java.sql.Connection

internal fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** [block] in one transaction on [c]: committed when it returns, rolled back when it throws. */
internal fun <T> transaction(c: Connection, block: () -> T): T {
    c.autoCommit = false
    try {
        return block().also { c.commit() }
    } catch (e: Exception) {
        c.rollback()
        throw e
    } finally {
        c.autoCommit = true
    }
}
