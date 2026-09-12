package net.artisanmc.plugin.yaml

import net.artisanmc.modules.api.schemas.SchemaMigration
import net.artisanmc.plugin.model.MenuYaml

/** Existing appearances retain append semantics; replacement is explicit. */
class MenuV2ToV3 : SchemaMigration<MenuYaml> {
    override val from = "menu/v2"
    override val to = "menu/v3"
    override fun migrate(data: MenuYaml): MenuYaml = data.copy(schema = to)
}
