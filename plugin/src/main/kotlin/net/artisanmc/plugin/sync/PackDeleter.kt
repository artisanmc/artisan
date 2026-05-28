package net.artisanmc.plugin.sync

import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.logging.Logger

/**
 * Atomic-ish pack deletion via move-to-trash.
 *
 * Pack at `<packsDir>/<packId>/` is moved to `<packsDir>/.artisan-trash/<packId>-<timestamp>/`.
 * The `.artisan` prefix excludes the trash directory from BundleHasher (filename filter)
 * AND from BundleHasher.hashAll's pack iteration (dotfile-directory filter).
 *
 * No-op if the pack dir does not exist.
 */
class PackDeleter(
    private val packsDir: File,
    private val logger: Logger? = null,
) {
    private val tsFormat = DateTimeFormatter.ofPattern("yyyyMMddHHmmss").withZone(ZoneOffset.UTC)

    fun delete(packId: String) {
        val packDir = File(packsDir, packId)
        if (!packDir.exists()) return

        val trash = File(packsDir, ".artisan-trash").also { it.mkdirs() }
        val timestamp = tsFormat.format(Instant.now())
        val target = File(trash, "$packId-$timestamp")
        val ok = packDir.renameTo(target)
        if (!ok) {
            logger?.warning("Failed to move $packDir to $target — pack may be partially deleted")
        } else {
            logger?.info("Pack $packId moved to trash at ${target.absolutePath}")
        }
    }
}
