package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Beta;

@Beta
@FunctionalInterface
public interface MenuClickListener {
    void onClick(MenuClickEvent event);
}
