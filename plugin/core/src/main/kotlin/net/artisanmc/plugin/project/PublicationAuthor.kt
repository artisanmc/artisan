package net.artisanmc.plugin.project

/**
 * Who published, and the Version the published draft was restored from, if any. [via] names the
 * AI app the player published through (ADR `mcp-server`): the Version reads "<player> via <app>".
 */
data class PublicationAuthor(val id: String, val name: String, val restoredFrom: String? = null, val via: String? = null)
