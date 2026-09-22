export interface ImageButtonImage {
  asset: string;
  fit?: "contain" | "stretch" | "native";
  offset_x?: number;
  offset_y?: number;
}

export function imageButtonSize(width: number, height: number) {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0))
    throw new Error("Invalid image dimensions.");
  return { width: Math.ceil(width / 16), height: Math.ceil(height / 16) };
}

/** Coordinates in Minecraft pixels, shared by the canvas and resource pack. */
export function imageButtonGeometry(
  image: ImageButtonImage, sourceWidth: number, sourceHeight: number,
  areaWidth: number, areaHeight: number,
) {
  const ratio = image.fit === "native" ? 1 : Math.min(areaWidth / sourceWidth, areaHeight / sourceHeight);
  const width = image.fit === "stretch" ? areaWidth : Math.max(1, Math.round(sourceWidth * ratio));
  const height = image.fit === "stretch" ? areaHeight : Math.max(1, Math.round(sourceHeight * ratio));
  return {
    width, height,
    x: Math.floor((areaWidth - width) / 2) + (image.offset_x ?? 0),
    y: Math.floor((areaHeight - height) / 2) + (image.offset_y ?? 0),
  };
}
