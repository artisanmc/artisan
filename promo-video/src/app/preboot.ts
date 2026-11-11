import { H, W } from "../size";

// Avant tout module de l'éditeur : ses stores lisent le navigateur à l'import.
try {
  localStorage.setItem("artisan.editor-address-banner.dismissed", "1");
  localStorage.setItem("i18nextLng", "en");
} catch {}
document.documentElement.dataset.theme = "dark";

// Plusieurs rendus tournent en parallèle sur la même origine : sans cela, le brouillon écrit par
// l'un ferait recharger le module dans les autres (l'éditeur synchronise ses onglets).
class SilentChannel extends EventTarget {
  onmessage = null;
  onmessageerror = null;
  constructor(readonly name: string) {
    super();
  }
  postMessage() {}
  close() {}
}
(window as unknown as { BroadcastChannel: unknown }).BroadcastChannel = SilentChannel;
window.addEventListener("storage", (event) => event.stopImmediatePropagation(), true);

// Les images que l'éditeur prend hors de son hub (têtes de joueurs) passent par le hub rejoué :
// le rendu ne dépend d'aucun site.
const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
if (src?.set && src.get) {
  const { set, get } = src;
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true,
    enumerable: true,
    get() {
      return get.call(this);
    },
    set(value: string) {
      window.dispatchEvent(new CustomEvent("promo:image", { detail: this }));
      set.call(this, typeof value === "string" ? value.replace(/^https:\/\/(mc-heads\.net\/)/, "/ext/$1") : value);
    },
  });
}

// React pose `src` par attribut : même détour.
const setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name: string, value: string) {
  if (this instanceof HTMLImageElement && name === "src") this.src = value;
  else setAttribute.call(this, name, value);
};

// Remotion rétrécit la fenêtre à 2×2 puis la rétablit autour de chaque capture. L'éditeur change de
// disposition sous 1024 px : il remonterait son canvas (textures rechargées, dialogues fermés) au
// milieu d'une scène. Pour lui, la fenêtre garde sa taille.
const nativeMatchMedia = window.matchMedia.bind(window);
window.matchMedia = (query: string): MediaQueryList => {
  const bound = /^\(\s*(min|max)-(width|height)\s*:\s*(\d+)px\s*\)$/.exec(query.trim());
  if (!bound) return nativeMatchMedia(query);
  const size = bound[2] === "width" ? W : H;
  const matches = bound[1] === "min" ? size >= Number(bound[3]) : size <= Number(bound[3]);
  const fixed = {
    matches,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  };
  return fixed as MediaQueryList;
};
window.addEventListener("resize", (event) => event.stopImmediatePropagation(), true);

// Même cause : un observateur de taille verrait la fenêtre de 2×2, puis un pixel de plus ou de
// moins. Le canvas se viderait pour se redessiner à l'image suivante, après la capture. Seuls les
// vrais changements de taille lui parviennent.
const NativeResizeObserver = window.ResizeObserver;
window.ResizeObserver = class extends NativeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    const seen = new WeakMap<Element, { w: number; h: number }>();
    super((entries, observer) => {
      if (window.innerWidth < W / 2) return;
      const changed = entries.filter((entry) => {
        const { width: w, height: h } = entry.contentRect;
        const last = seen.get(entry.target);
        if (last && Math.abs(last.w - w) < 2 && Math.abs(last.h - h) < 2) return false;
        seen.set(entry.target, { w, h });
        return true;
      });
      if (changed.length > 0) callback(changed, observer);
    });
  }
};
