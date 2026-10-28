import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// The pages live in docs/site/, next to the code they describe; artisanmc.net assembles the same folder.
export const collections = {
  docs: defineCollection({ loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: '../docs/site' }), schema: docsSchema() }),
};
