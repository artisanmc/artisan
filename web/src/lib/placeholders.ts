/**
 * Legacy simple placeholder resolver — only handles `{name}` and `{name.path}`
 * by dotted lookup. Predates the full expression DSL added in Plan A
 * (see web/src/lib/expr/). Kept around for callers that don't yet pipe
 * through the full template renderer (Menu canvas live preview, etc.).
 *
 * Plan B will migrate those callers and then this file can be deleted.
 */
