/** The UI kit's base images (`kit.ts`) as the browser fetches them, by file. */
const KIT_URLS = import.meta.glob<string>("@/assets/kit/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

/** The URL of the image Artisan ships for a slot of the kit's base. */
export function kitImageUrl(id: string): string | undefined {
  return Object.entries(KIT_URLS).find(([path]) => path.endsWith(`/${id}.png`))?.[1];
}

/** The bytes of that image. A small one is inlined in the bundle as a `data:` URL, read here without a request. */
export async function kitImageBytes(id: string): Promise<Uint8Array> {
  const url = kitImageUrl(id);
  if (!url) throw new Error(`kit_image_missing:${id}`);
  const inlined = /^data:[^,]*;base64,(.*)$/.exec(url);
  if (inlined) return Uint8Array.from(atob(inlined[1] as string), (c) => c.charCodeAt(0));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`kit_image_missing:${id}`);
  return new Uint8Array(await response.arrayBuffer());
}
