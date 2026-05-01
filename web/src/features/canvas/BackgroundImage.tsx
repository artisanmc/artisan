import { Image as KonvaImage } from "react-konva";
import useImage from "use-image";

interface BackgroundImageProps {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Konva Image bound to a (data-)URL via use-image. We render it inside the
 * menu Group, behind the slot grid, scaled to fill the grid area. While
 * loading, returns null so we don't get a flash of empty pixels.
 */
export function BackgroundImage({ url, x, y, width, height }: BackgroundImageProps) {
  const [image] = useImage(url);
  if (!image) return null;
  return (
    <KonvaImage
      image={image}
      x={x}
      y={y}
      width={width}
      height={height}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}
