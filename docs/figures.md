# Figures

The post column is about 900px wide on a laptop and about 330px on a phone. A
figure saved as one picture is scaled to fit that column, so text inside it ends
up 3–4× smaller on a phone than on a laptop. A dense paper figure becomes
unreadable, and a small diagram blown up to 900px gets text bigger than the
post's body text.

The site gives you two ways to avoid that:

| Your figure is…                                         | Use                                         |
| ------------------------------------------------------- | ------------------------------------------- |
| A diagram, schematic, or table you would draw yourself | **Code figure** (`{{< diagram >}}`)         |
| A plot or chart (matplotlib, paper PNG, …)              | **Image figure** with `size` / `panels`     |

Both render as a `<figure>` with a caption. Styles live in
`assets/css/figures.css`, and the markup comes from `layouts/partials/figure.html`
and `layouts/shortcodes/diagram.html`.

## Image figures

A markdown image on its own line becomes a figure. Its title (the quoted text)
becomes the caption:

```markdown
![Alt text describing the figure](plot.svg "Caption. *Markdown* works here.")
```

To set options, put them in `{...}` on the line **directly below** the image
(no blank line in between):

```markdown
![Alt text](results.png)
{caption="*Figure 3.* Caption text." size="wide" panels="0,0,540,500; 540,0,540,500"}
```

The `{{< figure >}}` shortcode takes the same options plus all of Hugo's
built-in ones (`src`, `alt`, `caption`, `title`, `link`, …):

```markdown
{{< figure src="images/plot.svg" size="medium" caption="Figure 1: ..." >}}
```

### `size`: how wide on a laptop

On a phone every figure is full column width. `size` caps the width on larger
screens:

| `size`    | Max width            | Good for                                                       |
| --------- | -------------------- | -------------------------------------------------------------- |
| (none)    | the image's own size | plots exported at the size you want them shown                 |
| `small`   | 480px                | small single-column paper figures (e.g. 3.3in PDF exports)     |
| `medium`  | 640px                |                                                                |
| `large`   | 768px                |                                                                |
| `full`    | column (900px)       | dense diagrams                                                 |
| `wide`    | up to 1200px         | dense multi-panel plots; extends past the text column on large screens |

A rule of thumb: pick the size at which text inside the figure looks about as
big as the caption text.

### `panels`: re-flow multi-panel images on phones

`panels` lists one crop box per panel as `x,y,width,height`, separated by `;`.
When the figure is narrower than 600px (phones), it shows these crops stacked,
one per row, instead of the whole image. On wider screens the original image is
shown unchanged. No extra files are needed: every crop is the same image file.

Coordinates are in the image's own units:

- **PNG / WebP / JPEG**: pixels. Open the image in an image viewer and read the
  x position of the white gap between panels.
- **SVG**: `viewBox` units, the numbers in `viewBox="0 0 W H"` at the top of
  the file. For matplotlib output these are points.

Tips:

- Use full-height crops (`y = 0`, `height` = image height) for side-by-side
  panels, so each crop keeps its axis labels and its "(a) …" subcaption.
- A legend shared by all panels can be its own crop, listed first. If it is
  very wide, split it into two crops of equal width so its text stays readable.
- Leave out a figure-wide title (matplotlib `suptitle`); the caption covers it.

Examples: `content/blog/a-year-in-llm-serving/index.md` (PNG, with a shared
legend) and `content/blog/burstiness-is-all-you-need/index.md` (matplotlib SVG,
2×3 grid).

## Code figures

For diagrams and tables, write the figure as HTML/CSS (plus inline SVG for
arrows or icons) inside the post. Text stays real text at a readable size, and
the layout can change with the available width. For example, three panels sit
side by side on a laptop and stack on a phone.

```markdown
{{< diagram alt="What the figure shows, for screen readers" caption="Caption." >}}
<style>
  .d-plan { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
  .d-plan > div { padding: .75rem; border: 1.5px solid #cbc8bc; border-radius: 6px; }
  /* Narrower than 36rem (576px): one column. */
  @container (max-width: 36rem) {
    .d-plan { grid-template-columns: 1fr; }
  }
</style>
<div class="d-plan">
  <div><b>Step 1</b><br>Collect</div>
  <div><b>Step 2</b><br>Plan</div>
  <div><b>Step 3</b><br>Apply</div>
</div>
{{< /diagram >}}
```

Parameters: `alt` (when set, screen readers read it instead of the inner text;
omit it for a table), `caption` (markdown), `size` (same values as above),
`class`, and `id`.

Rules:

- **Prefix every class and id** with a name unique to the figure (`.d-plan`).
  The `<style>` and SVG ids apply to the whole page.
- **Use `@container`, not `@media`, for breakpoints.** Each figure is a size
  container, so it reacts to the width it actually gets.
- **Do not use `prefers-color-scheme`.** The site is always light. A dark-mode
  rule would recolor the figure for readers whose OS is in dark mode.
- The inner code is inserted as-is. It is not markdown, so write `<b>` rather
  than `**`.
- CSS animations are switched off automatically for readers who ask for reduced
  motion.

**When the drawing cannot re-flow** (curved connectors, SVG animations), draw a
wide version and a narrow version in the same figure. Elements with class
`fig-wide-only` show when the figure is at least 720px wide, and elements with
`fig-narrow-only` show when it is narrower. The wide version can simply be the
existing image:

```html
<img class="fig-wide-only" src="architecture.svg" alt="" width="960" height="270">
<div class="d-arch fig-narrow-only"> ...a stacked HTML layout... </div>
```

Examples to copy from:

| Post                            | Figure                                    | Technique                              |
| ------------------------------- | ----------------------------------------- | -------------------------------------- |
| `make-model-precision-elastic`  | GPU memory in three stages                | grid → stacked rows; CSS subgrid alignment |
| `a-year-in-llm-serving`         | Round robin / sticky / cache-aware routing | 3 columns → stacked, small inline SVGs |
| `learning-augmented-heuristics` | Data plane / control plane                | side by side → stacked with a return arrow |
| `learning-augmented-heuristics` | 2×2 taxonomy, offline pre-training        | CSS grid                               |
| `fifo-is-all-you-need`          | FIFO, S3-FIFO, SIEVE                      | wide SVG + narrow HTML (CSS animation) |
| `segcache`                      | Expiration techniques                     | plain HTML table                       |
| `segcache`                      | Segcache design                           | 3 cards + connectors that turn vertical when stacked |

## Check it

Run `hugo server --buildDrafts` and look at the post at phone width (about
390px; use your browser's device toolbar) and at laptop width:

- Text inside every figure is readable on a phone without zooming.
- Nothing makes the page scroll sideways.
- On a laptop, the text inside a figure is not much bigger than the body text.
