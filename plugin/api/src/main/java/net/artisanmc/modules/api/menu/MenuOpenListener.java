package net.artisanmc.modules.api.menu;

import net.artisanmc.modules.api.annotations.Beta;

@Beta
@FunctionalInterface
public interface MenuOpenListener {
    void onOpen(MenuOpenEvent event);
}
