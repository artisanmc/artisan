package net.artisanmc.modules.api.text;

import java.util.ArrayList;
import java.util.List;
import java.util.function.ToIntFunction;

/**
 * Where each piece of a frame goes ({@link OverlayApi#compose}): pure geometry, the same as the
 * editor's, checked by {@code testdata/overlay-layout-conformance.json}. Widths and image heights
 * come from the caller.
 */
final class OverlayPlan {

    /** An image ({@code content} its asset) or a row of text ({@code content} its MiniMessage), its left at x, its top at rise. */
    record Draw(boolean image, String content, int x, int rise) {}

    /** The draws in order, and the images of a slot whose height is unknown (not in the pack). */
    record Plan(List<Draw> draws, List<String> missing) {}

    private OverlayPlan() {}

    static Plan plan(OverlayLayout layout, OverlayContent content, ToIntFunction<String> widthOf,
                     ToIntFunction<String> heightOf) {
        List<Draw> draws = new ArrayList<>();
        List<String> missing = new ArrayList<>();
        for (OverlayLayout.Layer layer : layout.getLayers()) {
            switch (layer) {
                case OverlayLayout.Image image -> draws.add(new Draw(true, image.asset(), image.x(), -image.y()));
                case OverlayLayout.ImageSlot slot -> {
                    String asset = content.image(slot.slot());
                    if (asset == null) break;
                    int height = slot.anchor() == OverlayLayout.Anchor.BOTTOM ? heightOf.applyAsInt(asset) : 0;
                    if (height < 0) missing.add(asset);
                    else draws.add(new Draw(true, asset, slot.x(), OverlayLayout.slotRise(slot, height)));
                }
                case OverlayLayout.Text text -> {
                    List<String> rows = content.text(text.slot());
                    for (int i = 0; i < Math.min(text.lines(), rows.size()); i++) {
                        String row = rows.get(i);
                        if (row.isEmpty()) continue;
                        int free = text.width() - widthOf.applyAsInt(row);
                        int dx = switch (text.align()) {
                            case LEFT -> 0;
                            case CENTER -> free / 2;
                            case RIGHT -> free;
                        };
                        draws.add(new Draw(false, row, text.x() + dx, -(text.y() + i * text.row())));
                    }
                }
                case OverlayLayout.Rows list -> {
                    OverlayContent.Rows rows = content.rows(list.slot());
                    if (rows == null) break;
                    for (int k = 0; k < list.lines(); k++) {
                        int index = rows.top() + k;
                        if (index < 0 || index >= rows.rows().size()) continue;
                        int top = list.y() + k * list.row();
                        String row = rows.rows().get(index);
                        if (!row.isEmpty()) draws.add(new Draw(false, row, list.x(), -top));
                        OverlayLayout.Cursor cursor = list.cursor();
                        if (index == rows.selected() && cursor != null) {
                            draws.add(new Draw(true, cursor.asset(), list.x() + cursor.x(), -(top + cursor.y())));
                        }
                    }
                }
            }
        }
        return new Plan(draws, missing);
    }
}
