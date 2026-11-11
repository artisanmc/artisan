package net.artisanmc.plugin.yaml

/**
 * A project file declares a `schema:` version this plugin does not read.
 *
 * The one read failure that stays **loud**: [ProjectReader] skips any other
 * broken file (logged, reported through `onSkip`) but lets this one fail the
 * reload, so a Project written for a newer plugin is never half-loaded. A
 * dedicated type, because a plain [IllegalArgumentException] is also what a
 * simple typo raises (`"10-".toInt()` throws a `NumberFormatException`), and
 * that must stay a per-file skip. Still an [IllegalArgumentException] for the
 * callers that caught the former type.
 */
class UnsupportedSchemaException(message: String) : IllegalArgumentException(message)
