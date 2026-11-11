package net.artisanmc.modules.api.menu;

import net.artisanmc.modules.api.annotations.Beta;

@Beta
@FunctionalInterface
public interface MenuCloseListener {
    void onClose(MenuCloseEvent event);
}
