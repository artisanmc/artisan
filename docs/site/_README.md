# Artisan user docs

Starlight Markdown pages, built two ways from this same folder:

- `docs-site/` serves them on artisanmc.net/wiki/;
- the artisanmc.net website copies this folder, at each release tag, under `/docs/artisan/`.

So that a page works under both, **links between pages are relative** (`../configuration/database/`),
never absolute (`/wiki/...`). `sidebar.yaml` names and orders the sidebar groups, one folder each.
Files starting with `_` are not pages.
