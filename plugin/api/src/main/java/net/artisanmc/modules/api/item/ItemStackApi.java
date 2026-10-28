package net.artisanmc.modules.api.item;

import java.util.Map;
import java.util.Set;
import net.artisanmc.modules.api.annotations.Stable;
import org.bukkit.inventory.ItemStack;

/**
 * Captured-item helpers for modules ({@code api.items}, ADR {@code captured-items-and-module-field-kit}):
 * the canonical wrapped serialization of a stack (what a project stores under {@code items/<id>.yml})
 * and the generic display descriptor (material, enriched to a recognized custom ref when possible;
 * head_texture, enchanted, count, name).
 *
 * <p>Since 2.4.0, an item spec as a module stores it in its Document: a map with the fields of a
 * menu button's appearance ({@code material}: a vanilla material, {@code item:<captured id>} or
 * {@code <namespace>:<id>} of a custom-items plugin; {@code title}, {@code lore}, {@code enchants},
 * {@code custom_model_data}, {@code count}…). {@link #build} makes its stack the way a menu does,
 * {@link #matches} says whether a player's stack is that item.
 */
@Stable
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

    /**
     * The stack of an item spec, or null when its material resolves to nothing (unknown material,
     * captured item or custom-items plugin absent). Text is MiniMessage, rendered without a player.
     * Since 2.4.0.
     */
    default ItemStack build(Map<String, ?> spec) {
        return null;
    }

    /**
     * Whether {@code stack} is the item of {@code spec} on every criterion of {@code comparisons}; an empty set
     * reads as {@link #defaultComparisons}. False when the spec builds nothing or the stack is
     * null or air. The amount is never compared. Since 2.4.0.
     */
    default boolean matches(Map<String, ?> spec, ItemStack stack, Set<ItemComparison> comparisons) {
        return false;
    }

    /**
     * The criteria a spec implies, read from the item it builds (a captured item included): the
     * custom item when it is one, else the material and {@link ItemComparison#CUSTOM_ITEM} (a custom
     * item built on that material is not it), plus each of name, lore, enchants and custom
     * model data the item carries, and always its wear (an item that cannot wear has none). What these leave out
     * (repair cost, hidden tags) is never compared unless {@link ItemComparison#EXACT} is asked.
     * Since 2.4.0.
     */
    default Set<ItemComparison> defaultComparisons(Map<String, ?> spec) {
        return Set.of(ItemComparison.MATERIAL, ItemComparison.CUSTOM_ITEM);
    }
}
