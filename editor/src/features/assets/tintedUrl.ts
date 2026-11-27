import { tintColour, tinted } from "@/lib/pack/compose";
import { useEffect, useState } from "react";

/**
 * `image` multiplied by `colour` as the pack tints a layer (`tinted` of `lib/pack/compose.ts`);
 * `null` without a canvas to draw on.
 */
export function tintedCanvas(
  image: HTMLImageElement,
  colour: readonly [number, number, number],
): HTMLCanvasElement | null {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, width, height);
  const drawn = tinted({ width, height, data: new Uint8Array(pixels.data.buffer) }, colour);
  pixels.data.set(drawn.data);
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/**
 * The picture at `url` tinted with `colour` (`#rrggbb`), as a data URL; `null` while it loads,
 * without a colour, or when it cannot be drawn: what shows the image then shows it as drawn.
 */
export function useTintedUrl(url: string | undefined, colour: string | undefined): string | null {
  const [drawn, setDrawn] = useState<string | null>(null);
  useEffect(() => {
    setDrawn(null);
    const rgb = tintColour(colour);
    if (!url || !rgb) return;
    let stale = false;
    const image = new Image();
    image.onload = () => {
      if (stale) return;
      try {
        const canvas = tintedCanvas(image, rgb);
        setDrawn(canvas ? canvas.toDataURL() : null);
      } catch {
        setDrawn(null);
      }
    };
    image.src = url;
    return () => {
      stale = true;
    };
  }, [url, colour]);
  return drawn;
}
