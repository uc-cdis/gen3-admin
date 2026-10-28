# Generator for docs/workshop/site/

The site in `../site/` is plain static HTML, and publishing it needs no build.
These scripts generate it, so that the sidebar, the previous and next links,
the heading anchors and the embedded search index stay consistent across pages.

| File | What |
|---|---|
| `build.mjs` | Renders every page into `../site/` (removing pages from earlier builds), writes `../site/assets/site.js` from `site.src.js` with the search index filled in, copies screenshots the pages use from `../img/` only when they are not already in `../site/assets/img/` (the copies there are blurred and must not be overwritten), and writes `.nojekyll`. |
| `lib.mjs` | Helpers (placeholders, buttons, fields, code blocks, banners, admonitions, screenshots, diagrams, timers, tables), the numbers the docs quote (`F`) and every external URL (`URL`). |
| `pages-start.mjs` | Overview, What is a CSOC?, Prerequisites. |
| `pages-tutorial.mjs` | The tutorial, one page per task, grouped by wizard step. |
| `pages-howto.mjs` | How-to guides. |
| `pages-concepts.mjs` | Architecture; Security, cost and responsibilities. |
| `pages-ref.mjs` | Wizard states, Troubleshooting, Glossary, Where things live. |
| `pages-more.mjs` | After the tutorial; For developers. |
| `ts.mjs` | Troubleshooting rows, the single source for each tutorial page and `reference/troubleshooting.html`. |
| `site.src.js` | Source of `assets/site.js`: navigation, search, table of contents, copy buttons, timers, and the diagram layouts (`SPECS`). |
| `check.mjs` | Checks that every internal link, anchor and image in `../site/` resolves. |

`../site/assets/site.css` is not generated; edit it in place.

## Regenerate

Needs Node.js 18 or later and no packages.

```bash
cd docs/workshop/site-src
node build.mjs     # writes ../site/
node check.mjs     # exits non-zero on a broken link, anchor or image
node --check ../site/assets/site.js
```

Then open `../site/index.html` in a browser.

## Structure

The docs follow the Diátaxis split:

- **Tutorial**: one path from an empty account to a CSOC and a first commons. Each page has the sections Goal, Steps, Expected result, What's happening and Troubleshooting. The sidebar groups the pages by wizard step (`group` in the page definition), so a reader on a given step finds its page.
- **How-to guides**: one task each (tear down, resume, allow an address, reset the password, self-managed DNS, DNS delegation).
- **Concepts**: what a CSOC is, the architecture, and security, cost and responsibilities.
- **Reference**: wizard states, troubleshooting, glossary, paths.

Keep implementation detail (script names, API paths, service names, record types) in `concepts/architecture.html`. A tutorial page's "What's happening" is a short plain-language summary, a diagram, and a link to the matching Architecture section.

## Style guide

- **Audience.** Research-IT and research-computing engineers who run the CSOC, the leads who decide whether to adopt it, and the security and compliance reviewers who approve it. Assume AWS and Kubernetes literacy, not knowledge of Gen3 or of this repository.
- **Voice.** Full sentences in the present tense, addressed to the reader ("Press **Apply**"). No telegraphic fragments, no chains of colons, no exclamation marks.
- **Describe the product as it is.** No project history, no "now", "no longer", "new", "older", "dry run", "today", and no event or venue references. A literal UI label may be quoted even if it contains such a word.
- **Numbers.** Every number comes from `F` in `lib.mjs`, including timer bounds and the wizard's banner texts (`F.ui`), which are quoted exactly. Durations are a range with an en dash ("15–20 minutes") or a single value ("about 5 minutes"), never "about" with a range, and never "≈" or "roughly". Write digits and the word "minutes" ("1–5 minutes", not "one to five" or "min"). Say where each duration starts and ends ("from **Apply** until the wizard moves to the **Certificate** step"). Give every bound its unit and do not hedge twice ("normal up to 30 minutes", not "about 25; up to about 32"). Do not quote prices or cost estimates.
- **Facts.** Verify against the code before writing: `frontend/pages/bootstrap.jsx`, `frontend/lib/wizardState.ts`, `frontend/components/bootstrap/`, `scripts/runner/*.sh`, `api/internal/`, and gen3-terraform's `examples/csoc`. Quote numbers only from `F` in `lib.mjs`.
- **Links.** Use `ext(key, text)` with a URL from `URL` in `lib.mjs`. Add only URLs you have opened, and prefer an official top-level documentation page to a deep link.
- **Placeholders.** Never real values. Use `v(key)`; the keys and their rendered forms are `profile` `<your-aws-profile>`, `ssoprofile` `<your-sso-profile>`, `account` `<account-id>`, `region` `<your-region>`, `name` `<csoc-name>`, `zone` `<your-domain>`, `parentzone` `<parent-domain>`, `parent` `<parent-profile>`, `bucket` `<state-bucket>`, `email` `<admin-email>`, and the derived `portal`, `auth` and `commons`. Examples use `example.org`.
- **UI text.** Buttons with `btn()` and field labels with `fld()`, in the exact words on screen. Banner titles in bold, as the wizard shows them.
- **Troubleshooting tables** always have the columns *What you see*, *What it means*, *What to do* (`TS_COLS` in `ts.mjs`). Put each row in `ts.mjs` only.
- **Admonitions.** Note for useful context, Tip for a shortcut, Warning for a mistake that costs time, Danger for one that loses data, access or money.
- **Code.** Page text is JavaScript strings inside template literals: escape `'` as `\'` inside single-quoted strings, or use a template literal.

## Terminology

Use one term for each thing, as defined here.

| Term | Meaning | Notes |
|---|---|---|
| **bootstrap wizard**, the wizard | The local application at `localhost:3000/bootstrap`. | Not "the installer". |
| **CSOC** | The Gen3 Cloud Services Operations Center, as the wizard's Welcome page names it. | Expand once, on *What is a CSOC?* and in the glossary. |
| **CSOC portal**, the portal | The CSOC's web application, at `portal.<your-domain>`. | |
| Wizard step names | **Welcome**, **Setup**, **Review**, **Provision**, **Certificate**, **Install**, **Done**: the stepper labels. | Write "the **Install** step". The pages' own headings are "Environment Setup", "Review & Confirm", "Certificate & DNS" and "Install CSOC"; quote them only when describing that page. |
| **Provision** | The button on the **Review** step that registers the environment and starts the init and the plan; also the step that follows. | The infrastructure is created by **Apply**, not by Provision. |
| **Apply** | The button, and the run, that creates the infrastructure with Terraform. | |
| **Bootstrap CSOC** / the bootstrap | The button on the **Install** step, and the run it starts. | "Install" alone means the wizard step. Do not say "install run". |
| **Finish install** / the finish | The button on the **Install** step, and the run it starts. | |
| **Tear down** / the teardown | The button, and the sequence uninstall, destroy, zone, bucket. | "Uninstall" and "destroy" are its parts. |
| run | One operation in a runner container: init, plan, apply, bootstrap, finish, uninstall, destroy. | |
| environment | One CSOC as recorded in the state bucket. | |
| **Argo CD** | The product. | The wizard's labels say "ArgoCD"; quote labels as they are. |
| **Route 53**, **AWS Lambda** | The AWS service names. | Not "Route53", not "lambda". |
| parent domain, `<parent-domain>` | The domain your subdomain sits under. | |
| your subdomain, `<your-domain>`; the zone | The subdomain the CSOC's hostnames go under, and its Route 53 hosted zone. | |
| hostname | One full DNS name, such as `portal.<your-domain>`. | |
| outbound address | The cluster's public IP address, Squid's. | The wizard's labels say "egress IP"; quote them as they are. |
| allowlist; **Allowed addresses** | The address ranges the load balancer accepts; the form field. | |
| sign in, sign-in | The verb, and the noun or adjective. | Not "log in" except in quoted UI labels. |
