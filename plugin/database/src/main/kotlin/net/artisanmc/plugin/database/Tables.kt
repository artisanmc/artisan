package net.artisanmc.plugin.database

import java.io.File
import javax.sql.DataSource

/**
 * `database.table-prefix` of `environment.yml`: in front of every table of the suite, Artisan's
 * (`{prefix}servers`) and each plugin's (`{prefix}{module}_{table}`). Two installations share one
 * database by setting two prefixes. The default is the names from before the setting existed.
 */
object TablePrefix {
    const val DEFAULT = "artisan_"

    /** Concatenated into SQL, never bound: lower case (H2 folds, MySQL on Linux does not), 16 characters at most. */
    private val VALID = Regex("[a-z][a-z0-9_]{0,14}_")
    private val MODULE = Regex("[a-z][a-z0-9]{0,23}")

    /** First segments of Artisan's own tables: a module of that name would share them. */
    val RESERVED = setOf("schema", "servers", "server", "meta", "contents", "versions", "drafts", "draft", "editor", "cooldowns")

    fun validate(prefix: String): String {
        require(VALID.matches(prefix)) {
            "database.table-prefix '$prefix' in plugins/Artisan/environment.yml: expected lower-case letters, digits " +
                "and '_', starting with a letter, ending with '_', 16 characters at most (default '$DEFAULT')"
        }
        return prefix
    }

    /** `{prefix}{module}_`: one word, no `_`, so two modules never share a table name. */
    fun module(prefix: String, module: String): String {
        require(MODULE.matches(module)) { "Table namespace '$module': expected one lower-case word (letters and digits, 24 at most)" }
        require(module !in RESERVED) { "Table namespace '$module' is reserved: Artisan's own tables start with it" }
        return "$prefix${module}_"
    }

    /**
     * Refuses a prefix changed under a database already filled with the previous one: the new
     * names would be empty tables and every plugin would start over as if nothing was stored.
     * The prefix last used lives in [file]; it is (re)written once the check passes.
     */
    fun checkUnchanged(prefix: String, file: File, dataSource: DataSource) {
        val previous = file.takeIf { it.isFile }?.readText()?.trim()?.takeIf { it.isNotEmpty() }
        if (previous != null && previous != prefix) {
            val (old, new) = dataSource.connection.use { c ->
                SchemaMigrator.hasTable(c, ArtisanTables(previous).schemaVersion) to SchemaMigrator.hasTable(c, ArtisanTables(prefix).schemaVersion)
            }
            check(!old || new) {
                "database.table-prefix changed from '$previous' to '$prefix', and the database holds the tables of '$previous': " +
                    "the suite would start empty. Set it back, or rename the tables, or delete ${file.path} to start over under '$prefix'."
            }
        }
        if (previous != prefix) {
            file.parentFile?.mkdirs()
            file.writeText(prefix + "\n")
        }
    }
}

/** Artisan's own tables, indexes and constraints under a [TablePrefix]. */
class ArtisanTables(prefix: String) {
    val schemaVersion = "${prefix}schema_version"
    val servers = "${prefix}servers"
    val meta = "${prefix}meta"
    val contents = "${prefix}contents"
    val versions = "${prefix}versions"
    val serverState = "${prefix}server_state"
    val drafts = "${prefix}drafts"
    val draftReceipts = "${prefix}draft_receipts"
    val editorSessions = "${prefix}editor_sessions"
    val cooldowns = "${prefix}cooldowns"
    val cooldownsSubjectIndex = "${prefix}cooldowns_subject"
    val versionsProjectIndex = "${prefix}versions_project"
    val versionsFolderIndex = "${prefix}versions_folder"
    val versionsServerKey = "${prefix}versions_server"

    companion object {
        val DEFAULT = ArtisanTables(TablePrefix.DEFAULT)
    }
}
