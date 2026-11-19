import {
  type NexoItemModels,
  fetchNexoItemIcons,
  fetchNexoItemModels,
  fetchUserCustomItems,
  fetchUserItems,
} from "@/lib/api/userProjects";
import { renderGivenModels, renderToCanvas } from "@/lib/mcModelRenderer";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useUiStore } from "@/state/uiStore";
import { useEffect } from "react";
import { loadItemAtlas } from "./itemAtlas";
import { useTextureStore } from "./textureStore";

/**
 * The user and Project the store was last filled for. Coming back to a view with the same
 * ones keeps the library and the icons already drawn: nothing is fetched or drawn again.
 */
let filledFor: string | null = null;

/** 3D icons put in the store at once: every icon on screen redraws once per batch, not per model. */
const NEXO_MODEL_BATCH = 24;

/**
 * Draws the Nexo items' 3D models in the background and gives every item of a model its icon.
 * Only the models an item uses are drawn; a model that fails leaves its items their flat icon.
 */
async function drawNexoModels(
  given: NexoItemModels,
  isCurrent: () => boolean,
  store: (byMaterial: Record<string, string>, smooth: boolean) => void,
) {
  const itemsOf = new Map<string, string[]>();
  for (const [id, model] of Object.entries(given.items))
    itemsOf.set(model, [...(itemsOf.get(model) ?? []), id]);
  const models = Object.fromEntries(
    Object.entries(given.models).filter(([key]) => itemsOf.has(key)),
  );
  if (Object.keys(models).length === 0) return;
  const urls = Object.fromEntries(
    Object.entries(given.textures).map(([ref, png]) => [ref, `data:image/png;base64,${png}`]),
  );
  let batch: Record<string, string> = {};
  let drawn = 0;
  const flush = () => {
    if (drawn > 0 && isCurrent()) store(batch, true);
    batch = {};
    drawn = 0;
  };
  await renderGivenModels(
    models,
    urls,
    (key, src) => {
      for (const id of itemsOf.get(key) ?? []) batch[`nexo:${id}`] = src;
      if (++drawn >= NEXO_MODEL_BATCH) flush();
    },
    isCurrent,
  );
  flush();
}

/**
 * Initialises the texture store as soon as a principal AND a projectId are
 * available. Must be called from a component that is always mounted
 * (e.g. EditorPane), NOT from Library which is conditionally rendered per tab.
 *
 * Items are resolved via `/api/v1/user/projects/{projectId}/items`.
 *
 * `projectId` overrides the last active project — a module Config screen edits
 * a project without opening its canvas, and its item pickers still need the
 * library (ADR `module-config-screens`).
 */
export function useTextureInit(projectId?: string) {
  const lastActive = useUiStore((s) => s.lastActiveProjectId);
  const lastActiveProjectId = projectId ?? lastActive;
  const currentUser = useProjectPrincipalId(lastActiveProjectId ?? undefined);
  const setData = useTextureStore((s) => s.setData);
  const setRendered = useTextureStore((s) => s.setRendered);
  const setRenderedMany = useTextureStore((s) => s.setRenderedMany);
  const setLibraryItems = useTextureStore((s) => s.setLibraryItems);
  const setLibraryCustomData = useTextureStore((s) => s.setLibraryCustomData);
  const setLibraryBundleReady = useTextureStore((s) => s.setLibraryBundleReady);
  const setLibraryError = useTextureStore((s) => s.setLibraryError);

  useEffect(() => {
    const key = `${currentUser}|${lastActiveProjectId}`;
    const held = useTextureStore.getState();
    if (
      currentUser &&
      lastActiveProjectId &&
      filledFor === key &&
      held.libraryBundleReady &&
      held.libraryItems.length > 0 &&
      !held.libraryError
    )
      return;
    useTextureStore.getState().setAtlas(null);
    useTextureStore.setState({
      version: "",
      byMaterial: {},
      renderedByMaterial: {},
      smoothByMaterial: {},
      libraryItems: [],
      libraryCustomData: { serverKeyId: "", items: [] },
      libraryBundleReady: false,
      libraryError: false,
    });
    filledFor = null;
    if (!currentUser || !lastActiveProjectId) return;
    filledFor = key;
    // Not tied to this mount: icons drawing when the view is left still land in the store
    // for the next visit. Another user or Project (a new key, the user included) drops them.
    const isCurrent = () => filledFor === key;

    Promise.all([fetchUserItems(lastActiveProjectId), fetchUserCustomItems(lastActiveProjectId)])
      .then(async ([vanilla, custom]) => {
        if (!isCurrent()) return;
        // The first fetch may go out with the URL slug, before the project is
        // loaded: an error must not stick once the real id is resolved.
        setLibraryError(false);
        setData(vanilla.version, vanilla.items);
        setLibraryItems(vanilla.items);
        setLibraryCustomData(custom);
        // The embedded catalog ships pre-rendered icons (no model bundle to
        // preload). Nexo items get their texture from the server; the other
        // custom items are names only: they keep a placeholder.
        setLibraryBundleReady(true);
        // One request for every grid icon, instead of one per item through the editor tunnel.
        void loadItemAtlas(vanilla.version, vanilla.items, isCurrent);
        for (const item of vanilla.items) {
          if (!item.model) continue;
          renderToCanvas(item.model, vanilla.version, item.tints).then((src) => {
            if (src && isCurrent()) setRendered(item.id, src);
          });
        }
        if (custom.items.some((item) => item.id.startsWith("nexo:"))) {
          const flat = fetchNexoItemIcons(lastActiveProjectId).then((icons) => {
            if (!isCurrent()) return;
            const rendered: Record<string, string> = {};
            for (const [id, png] of Object.entries(icons))
              rendered[`nexo:${id}`] = `data:image/png;base64,${png}`;
            setRenderedMany(rendered);
          });
          // The flat icons first, then the 3D ones over them as they are drawn.
          void Promise.all([fetchNexoItemModels(lastActiveProjectId), flat]).then(([given]) =>
            drawNexoModels(given, isCurrent, setRenderedMany),
          );
        }
      })
      .catch((err) => {
        if (!isCurrent()) return;
        filledFor = null;
        console.warn("[library] items fetch failed", lastActiveProjectId, err);
        setLibraryError(true);
      });
  }, [
    currentUser,
    lastActiveProjectId,
    setData,
    setRendered,
    setRenderedMany,
    setLibraryItems,
    setLibraryCustomData,
    setLibraryBundleReady,
    setLibraryError,
  ]);
}
