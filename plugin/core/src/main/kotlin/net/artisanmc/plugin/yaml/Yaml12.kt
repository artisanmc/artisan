package net.artisanmc.plugin.yaml

import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.dataformat.yaml.YAMLParser

/**
 * The YAML reader of every file a server reads from a Project or a module: YAML 1.2 scalars,
 * as the editor's `yaml` reads them. Jackson's default (YAML 1.1) reads `on`, `off`, `yes`,
 * `no`, `y`, `n` (any case) as booleans: an enum value `on`, a lang line `Yes` turned into
 * `true`, while the editor showed the text. Here only `true` and `false` are booleans.
 *
 * A new factory per mapper: an `ObjectMapper` sets itself as its factory's codec.
 */
object Yaml12 {
    fun factory(): YAMLFactory = YAMLFactory.builder()
        .enable(YAMLParser.Feature.PARSE_BOOLEAN_LIKE_WORDS_AS_STRINGS)
        .build()
}
