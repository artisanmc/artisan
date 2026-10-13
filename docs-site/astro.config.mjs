import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://artisanmc.net',
  base: '/wiki',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Artisan wiki',
      description: 'Build beautiful Minecraft inventory menus with a visual editor.',
      logo: { src: './src/assets/logo.svg', alt: '' },
      customCss: ['./src/styles/artisan.css'],
      components: { Header: './src/components/Header.astro' },
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.bunny.net' } },
        { tag: 'link', attrs: { rel: 'stylesheet', href: 'https://fonts.bunny.net/css?family=hanken-grotesque:400,500,600,700|ibm-plex-mono:400,500|inter:600,700,800&display=swap' } },
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Install on a Paper server', slug: 'getting-started/install-admin' },
          ],
        },
        {
          label: 'Editor',
          autogenerate: { directory: 'editor' },
        },
        {
          label: 'Developers',
          items: [
            { label: 'Overview', slug: 'developers' },
            { label: 'Depend on the API', slug: 'developers/setup' },
            { label: 'Data sources', slug: 'developers/data-sources' },
            { label: 'Modules', slug: 'developers/modules' },
            { label: 'Data models & config screens', slug: 'developers/data-models' },
            { label: 'API reference', slug: 'developers/api-reference' },
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
