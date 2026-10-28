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
      // Each group lists its directory; page order comes from `sidebar.order` in each page's frontmatter.
      sidebar: [
        { label: 'Getting started', autogenerate: { directory: 'getting-started' } },
        { label: 'Configuration', autogenerate: { directory: 'configuration' } },
        { label: 'Network', autogenerate: { directory: 'network' } },
        { label: 'Editor', autogenerate: { directory: 'editor' } },
        { label: 'Developers', autogenerate: { directory: 'developers' } },
        { label: 'Contributing', autogenerate: { directory: 'contributing' } },
      ],
    }),
  ],
});
