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
