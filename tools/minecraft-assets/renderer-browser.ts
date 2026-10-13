import { renderToCanvas, preloadModels } from "../../editor/src/lib/mcModelRenderer";

declare global {
  interface Window {
    renderToCanvas: typeof renderToCanvas;
    preloadModels: typeof preloadModels;
  }
}

window.renderToCanvas = renderToCanvas;
window.preloadModels = preloadModels;
