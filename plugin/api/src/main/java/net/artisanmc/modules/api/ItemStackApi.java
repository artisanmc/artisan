package net.artisanmc.modules.api;

import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.inventory.ItemStack;

/**
 * Captured-item helpers for modules ({@code api.items}, ADR {@code captured-items-and-module-field-kit}):
 * the canonical wrapped serialization of a stack (what a project stores under {@code items/<id>.yml})
 * and the generic display descriptor (material, enriched to a recognized custom ref when possible;
 * head_texture, enchanted, count, name).
 */
@Beta
public interface ItemStackApi {
    /** Inert default (tests / partial wiring). */
    ItemStackApi NOOP = new ItemStackApi() {
        @Override
        public String serialize(ItemStack stack) {
            return "";
        }

        @Override
        public Map<String, Object> describe(ItemStack stack) {
            return Map.of();
        }
    };

    String serialize(ItemStack stack);

    Map<String, Object> describe(ItemStack stack);
}
