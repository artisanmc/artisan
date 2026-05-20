import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Interfaze',
      description: 'Build beautiful Minecraft inventory menus with a visual editor.',
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Install on a Paper server', slug: 'getting-started/install-admin' },
          ],
        },
        {
          label: 'Editor',
          items: [
            { label: 'Overview', slug: 'editor' },
          ],
        },
        {
          label: 'Contributing',
          items: [
            { label: 'Overview', slug: 'contributing' },
          ],
        },
      ],
    }),
  ],
});
