import book from "@/assets/minecraft/items/book.png";
import compass from "@/assets/minecraft/items/compass.png";
import diamond from "@/assets/minecraft/items/diamond.png";
import diamondPickaxe from "@/assets/minecraft/items/diamond_pickaxe.png";
import diamondSword from "@/assets/minecraft/items/diamond_sword.png";
import emerald from "@/assets/minecraft/items/emerald.png";
import enderPearl from "@/assets/minecraft/items/ender_pearl.png";
import goldenApple from "@/assets/minecraft/items/golden_apple.png";
import map from "@/assets/minecraft/items/map.png";

const items = {
  book,
  compass,
  diamond,
  diamondPickaxe,
  diamondSword,
  emerald,
  enderPearl,
  goldenApple,
  map,
};
export type PixelItemName = keyof typeof items;

export function PixelItem({ name, className = "" }: { name: PixelItemName; className?: string }) {
  return (
    <img
      src={items[name]}
      width={32}
      height={32}
      alt=""
      draggable={false}
      className={`landing-pixel-item ${className}`}
    />
  );
}
