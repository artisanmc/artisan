import { type Slice, drawSliced, slicesAt } from "@/lib/pack/slice";
import { useEffect, useState } from "react";

/**
 * `image` as the pack draws a sliced image at `width` × `height` (`lib/pack/slice.ts`): corners
 * copied, edges and middle repeated. `null` when the margins do not hold at that size, or
 * without a canvas to draw on.
 */
export function slicedCanvas(
  image: HTMLImageElement,
  slice: Slice,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  const source = { width: image.naturalWidth, height: image.naturalHeight };
  if (!source.width || !source.height || !slicesAt(slice, source, width, height)) return null;
  const read = document.createElement("canvas");
  read.width = source.width;
  read.height = source.height;
  const from = read.getContext("2d");
  if (!from) return null;
  from.drawImage(image, 0, 0);
  const pixels = from.getImageData(0, 0, source.width, source.height);
  const drawn = drawSliced(
    { ...source, data: new Uint8Array(pixels.data.buffer) },
    slice,
    width,
    height,
  );
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const to = out.getContext("2d");
  if (!to) return null;
  const target = to.createImageData(width, height);
  target.data.set(drawn.data);
  to.putImageData(target, 0, 0);
  return out;
}

/**
 * The picture at `url` drawn sliced at `width` × `height`, as a data URL; `null` while it
 * loads, when there is nothing to resize (`slice` or a size missing), or when it cannot be
 * drawn: what shows the image then stretches it.
 */
export function useSlicedUrl(
  url: string | undefined,
  slice: Slice | undefined,
  width: number | undefined,
  height: number | undefined,
): string | null {
  const [drawn, setDrawn] = useState<string | null>(null);
  const { left, right, top, bottom } = slice ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const sliced = !!slice;
  useEffect(() => {
    setDrawn(null);
    if (!url || !sliced || !width || !height) return;
    let stale = false;
    const image = new Image();
    image.onload = () => {
      if (stale) return;
      try {
        const canvas = slicedCanvas(image, { left, right, top, bottom }, width, height);
        setDrawn(canvas ? canvas.toDataURL() : null);
      } catch {
        setDrawn(null);
      }
    };
    image.src = url;
    return () => {
      stale = true;
    };
  }, [url, sliced, left, right, top, bottom, width, height]);
  return drawn;
}
