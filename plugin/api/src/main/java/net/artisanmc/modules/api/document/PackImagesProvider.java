package net.artisanmc.modules.api.document;

import java.util.List;
import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.text.OverlayLayout;
import org.jetbrains.annotations.Nullable;

/**
 * The images a Document of a kind asks the resource pack for, drawn at a height on the screen (a
 * HUD): the server-side twin of the editor kind's {@code pack.images} (editor SDK 1.13). Declared
 * with {@link DocumentKindDeclaration#withPackImages}.
 *
 * <p>Artisan calls it at each load, once per file of the kind ({@code <dir>/<id>.yml}, in path
 * order), and records the answers with the server's loaded state; the hub builds the pack from them,
 * without the editor. It must give what the editor kind's {@code pack.images} gives for the same
 * file, in the same order: two packs that differ make players download it again.
 *
 * <p>Called off the main thread, with no game access: a pure function of the files. A file whose
 * call throws adds no image; an answer with a blank asset, or a rise outside
 * {@code OverlayApi.MIN_RISE..MAX_RISE}, is skipped.
 *
 * @since 2.22.0
 */
@Beta
@FunctionalInterface
public interface PackImagesProvider {
    /**
     * @param document the file's YAML mapping, as {@link net.artisanmc.modules.api.project.ProjectContentApi#documents}
     *     reads it, with {@code id} set to its file name.
     * @param context the other files of the same Project.
     * @return the images, as {@link OverlayLayout#getPackImages} and {@link OverlayLayout#slotPackImage} give them.
     */
    List<OverlayLayout.PackImage> images(Map<String, Object> document, Context context);

    /** The other files of the Project the Document is in, each parsed once. */
    interface Context {
        /** The YAML of the file at {@code path} ({@code data/speakers.yml}), null when absent or unreadable. */
        @Nullable Object file(String path);

        /** The YAML files directly in {@code dir} ({@code speakers}), in path order. */
        List<DirFile> files(String dir);
    }

    /** A file of {@link Context#files}: its id (file name without extension) and its YAML. */
    record DirFile(String id, @Nullable Object value) {}
}
