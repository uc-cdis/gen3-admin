# tf-arch (vendored)

The plan parser and layout engine of
[tf-arch-diagram-generator](https://github.com/mchittineni/tf-arch-diagram-generator),
**v1.4.2**, copied unmodified from the npm tarball:

- tarball: `https://registry.npmjs.org/tf-arch-diagram-generator/-/tf-arch-diagram-generator-1.4.2.tgz`
- integrity: `sha512-PM4AhOP7g64PPiVWJ8fqc3n5UgN4LXe+ReiO+v4XTikg0plITMhC4XXWigJ3FEBKMws2xrHwqD5dTES5FDE+/w==`

Only `src/parser`, `src/canvas/layoutEngine.js` and `src/providers` are kept;
the viewer, CLI and samples are left out. It has no dependencies.

The code is MIT (`LICENSE`). The icons embedded in
`src/providers/*/officialIcons.js` are **not**: they belong to AWS, Google and
Microsoft and are used under their terms (`ICONS-NOTICE.md`) only to show each
vendor's own services in diagrams of the user's deployment, unmodified.

`scripts/runner/plan-diagram.mjs` runs it in the Terraform runner after each
plan. To update: download the new tarball, check its integrity and that it
still has no dependencies or install scripts, replace these files, and update
the version above.
