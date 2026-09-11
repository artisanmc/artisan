package net.artisanmc.plugin.yaml

import net.artisanmc.modules.api.schemas.SchemaMigration
import net.artisanmc.plugin.model.MenuYaml

/** V2 preserves legacy material expressions; explicit item bindings are opt-in. */
class MenuV1ToV2 : SchemaMigration<MenuYaml> {
    override val from = "menu/v1"
    override val to = "menu/v2"
    override fun migrate(data: MenuYaml): MenuYaml = data.copy(schema = to)
}
