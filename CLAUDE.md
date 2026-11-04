# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Hugo static site for the [Harvard Systems Group](https://systems.seas.harvard.edu/), deployed to GitHub Pages. Content is Markdown with TOML front matter (`+++` fences); the theme is a git submodule.

## Commands

```bash
git submodule update --init --recursive   # required once after clone (pulls the theme)
hugo server                                # local dev at http://localhost:1313
hugo server --buildDrafts                  # include draft = true pages
hugo --gc --minify                         # production build into public/ (matches CI)

hugo new content blog/[post-name]/index.md # new post as a page bundle (for posts with figures)
hugo new content blog/[post-name].md       # new post as a single file (no assets)
```

Note: Hugo **skips pages whose `date` is in the future**, and CI only builds on push — so a future `date` may never render on the live site. For new posts and seminars, set `date` to the current hour (today's date, current hour, minutes/seconds zeroed). Production build in CI uses Hugo extended **0.164.0**; match this if reproducing build issues.

## Deployment

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `master` (or manual dispatch). There is no test/lint step — the build must simply succeed. The custom domain is set by `CNAME`. `public/` is generated output; never edit it by hand (it is gitignored but a stale copy may exist locally).

## Architecture

**Theme override layer.** The `paper` theme lives in `themes/paper/` as a submodule (fork: `HarvardSys/hugo-paper`). Files in the repo-root `layouts/` **override** the theme's equivalents via Hugo's lookup order. Any layout under `layouts/` is a local customization; the theme's version in `themes/paper/layouts/` is the fallback. When changing rendering, decide deliberately whether to override in root `layouts/` (site-specific) or edit the theme submodule (upstream).

**Sections** (top-level dirs under `content/`, each with an `_index.md`): `blog`, `seminar`, `people`, `research`, `teaching`. `mainSections = ['blog']` in `hugo.toml` controls which section feeds the generic post lists. The nav menu and taxonomies (categories/tags/series) are also defined in `hugo.toml`.

**People page is data-driven, not content-driven.** `layouts/people/list.html` renders entirely from `data/people.yaml` (ignoring `content/people/`'s body). Each entry has `name`, `role`, and optional `title`, `weight`, `image`, `email`, `website`, `advisor`, `surname`. Rendering groups people by a hardcoded role order (`Directors`, `Faculty`, `Postdocs`, `PhD Students`) — a new role string will not appear until added to `$section_order` in that layout. Within a group, sort is by `weight` (default 99) then surname. Photos go in `static/images/people/` and are referenced as `/images/people/...`.

**Seminars** are regular content pages in `content/seminar/` (filename convention `YYYY-MM-DD-speaker-name.md`). Front matter drives display: `eventTime` (talk time, takes precedence over `date` for the displayed date), `speaker`, `location`, `summary`, plus the usual `date`/`draft`. The `layouts/partials/date-people.html` partial (overriding the theme's) renders the event/location/speaker icon row shown on seminar and blog listings.

When adding a new seminar, include: `title`, `eventTime`, `speaker`, `location`, and body sections for the **Abstract** and **Bio**. The `summary` front-matter field is a condensed summary of the abstract: keep it brief — one sentence of background/motivation drawn from the abstract, then one compact sentence naming the speaker by first name and the talk's main thrust — and don't default to em dashes; prefer commas/colons. Set `date` to the time of the current hour (never in the future, or Hugo will not render the page). `speaker` is `Name (Affiliation)`. Do not add mailing-list/contact boilerplate to the page — that is email-announcement text, not part of the seminar page. Refer to existing files in `content/seminar/` for the exact format.

**Figures** (see `docs/figures.md`). Standalone markdown images are rendered as `<figure>` by `layouts/_default/_markup/render-image.html`; the title becomes the caption, and options go in a block-attribute line directly below the image (`{size="wide" panels="..."}`; enabled by `wrapStandaloneImageWithinParagraph = false` and `parser.attribute.block = true` in `hugo.toml`). `layouts/shortcodes/figure.html` overrides Hugo's built-in `figure` with the same output. Both call `layouts/partials/figure.html`, which reads intrinsic size (raster `.Width`/`.Height`, or the SVG's `width`/`height`/`viewBox`) and renders `size` presets plus `panels` (crop boxes in image units, shown stacked when the figure is under 600px). `layouts/shortcodes/diagram.html` wraps figures written as HTML/CSS/SVG in the post body. Each figure is a CSS size container, so these use `@container` queries, and `fig-wide-only` / `fig-narrow-only` swap two drawings at 45rem. All styles are in `assets/css/figures.css`, linked from `layouts/_default/single.html`. The site is always light: figures must not use `prefers-color-scheme`. To check figures, look at ~390px and ~1440px widths.

**Homepage** `layouts/index.html` renders `content/_index.md` body, then the first 3 pages from the `seminar` section and first 5 from `blog`.

## Authoring conventions

See `docs/new-post.md` and `docs/post-checklist.md` for the full workflow. Key points:

- Posts with figures are **page bundles**: a directory with `index.md` and images alongside it. Prefer **SVG for diagrams, WebP for photos**.
- Set `draft = false` only when ready to publish; publish via PR to `master`.
- Provide a post summary with either a `summary` front-matter field or a `<!--more-->` break.
- Raw inline HTML in Markdown is enabled (`markup.goldmark.renderer.unsafe = true`); math rendering is on (`math = true`), and material-icons-outlined glyphs are used in layouts.
