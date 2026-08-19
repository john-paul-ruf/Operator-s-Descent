# Icons

Static SVG symbol sprite compiled from a curated subset of [lucide](https://lucide.dev/)
icons. `subset.json` lists the icon ids the game actually uses; the build
script imports the matching ESM icon modules from `node_modules/lucide/dist/esm/icons/`
and emits a single `assets/icons.svg` containing `<symbol id="…">…</symbol>`
nodes.

## Regenerating the sprite

```
npm run build:icons
```

Commit both `tools/icons/subset.json` and the regenerated `assets/icons.svg`.
Do not commit `node_modules/lucide/`.

## Adding icons

1. Add the lucide icon id to the appropriate group in `subset.json`.
2. Update the `ICON_IDS` set in `src/ui/icon.js` to match.
3. Run `npm run build:icons` and commit the updated sprite.
4. `tests/tools/build-pipelines.test.js` will verify the sprite contains
   every subset id and that the `ICON_IDS` set matches.

Lucide occasionally renames icons between versions. If the build script fails
with "Missing lucide icons", check `node_modules/lucide/dist/esm/icons/` for
the correct current name and update `subset.json` accordingly.
