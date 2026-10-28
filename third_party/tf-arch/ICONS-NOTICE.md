# Third-party icon assets — NOT covered by this project's MIT license

The SVG files in this directory were downloaded by `npm run icons:update` and
remain the property of their respective owners. The project's [MIT
license](../../LICENSE) covers this repository's own source code only; it does
**not** grant you any rights to these icons.

| Set | Owner | Sourced via | Terms of use |
|---|---|---|---|
| AWS Architecture Icons | Amazon Web Services, Inc. | [aws-icons.com](https://aws-icons.com/) | <https://aws.amazon.com/architecture/icons/> |
| Google Cloud Icons | Google LLC / Alphabet Inc. | [gcpicons.com](https://gcpicons.com/) | <https://cloud.google.com/icons> |
| Microsoft Azure Architecture Icons | Microsoft Corporation | [az-icons.com](https://az-icons.com/) | <https://learn.microsoft.com/en-us/azure/architecture/icons/> |

## What this means in practice

Each vendor publishes its own terms, and they are broadly similar. Read the
linked pages before relying on any of this, but in summary they generally:

- **allow** using the icons in architecture diagrams, documentation and
  presentations that describe deployments on that vendor's cloud;
- **forbid** modifying, recolouring or distorting the icons;
- **forbid** using them in a way that implies the vendor endorses, sponsors or
  is affiliated with your product;
- **forbid** using them to represent a competitor's service, and
- **forbid** redistributing the icon sets as an icon library or similar
  standalone offering.

The raw sets in this directory are **excluded from the published npm package**
(see the `files` field in `package.json`). They are tracked here as the source
of truth, refreshed by the semiannual `update-icons` workflow.

The diagrams render with a **subset of these official icons** (~100 of the
~1,100 files — only the services the resource map knows about), embedded into
the generated `src/providers/*/officialIcons.js` modules by
`npm run icons:build`. The artwork is embedded verbatim; the generator only
strips XML metadata and namespaces internal `id`/`class` identifiers so many
icons can coexist in one SVG document. Those embedded SVGs remain the property
of their vendors under the terms above — the MIT license does not cover them.
Each icon is used solely to represent its own vendor's service in
architecture diagrams of the user's deployment, which is the use the vendor
terms are written to allow.

If you would rather not keep vendor assets in your fork's history, delete this
directory, add `assets/icons/` to `.gitignore`, and run the updater with
`--out` pointing somewhere local.

## Provenance

`manifest.json` records, for each set: the source URL, the upstream `ETag` and
`Last-Modified`, the icon count, and a SHA-256 of every file. Run
`npm run icons:check` to verify the files on disk still match it.
