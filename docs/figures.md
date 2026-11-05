# Figures

The post column is about 900px wide on a laptop and about 330px on a phone. A
figure saved as one picture is scaled to fit that column, so text inside it ends
up 3–4× smaller on a phone than on a laptop. A dense paper figure becomes
unreadable, and a small diagram blown up to 900px gets text bigger than the
post's body text.

The site gives you three ways to avoid that:

| Your figure is…                                         | Use                                         |
| ------------------------------------------------------- | ------------------------------------------- |
| A plot or chart you have the numbers for                | **Chart** (`{{< plotly >}}`), drawn in the browser |
| A diagram, schematic, or table you would draw yourself | **Code figure** (`{{< diagram >}}`)         |
| A plot you only have as a picture (paper PNG, …)        | **Image figure** with `size` / `panels`     |

All render as a `<figure>` with a caption. Styles live in
`assets/css/figures.css`, and the markup comes from `layouts/partials/figure.html`,
`layouts/shortcodes/diagram.html` and `layouts/shortcodes/plotly.html`.

## Charts

Plots you have the data for are drawn in the browser by
[plotly.js](https://plotly.com/javascript/). Text in a chart is real page text
at a fixed 12px, so a chart reads the same on a phone and a laptop. Hovering (or
tapping) shows exact values, and bar and line charts with up to 40 categories
get a collapsed **Data** table, built when the site is built, so the numbers
also work without JavaScript and for screen readers.

A chart figure is a `{{< diagram >}}` holding an HTML legend and one or more
panels. Each panel (`.fig-plot`) is a card with a title, an optional subtitle
and a `{{< plotly >}}` chart, whose JSON is a plotly.js spec:

```markdown
{{< diagram size="large" caption="*Figure 1.* Caption." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box fig-key--blue"></i>Memcached</span>
  <span><i class="fig-key fig-key--box fig-key--red"></i>Segcache</span>
</div>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Single thread</div>
    <div class="fig-plot-sub">Higher is better</div>
    {{< plotly height="280" alt="What the chart shows, for screen readers" >}}
    {
      "unit": "MQPS",
      "decimals": 2,
      "xname": "Workload",
      "data": [
        {"type": "bar", "name": "Memcached", "color": "blue", "x": ["content", "user1"], "y": [2.73, 3.86]},
        {"type": "bar", "name": "Segcache", "color": "red", "x": ["content", "user1"], "y": [4.0, 5.53]}
      ],
      "layout": {"yaxis": {"title": {"text": "Throughput (MQPS)"}}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot"> ...a second panel... </figure>
</div>
{{< /diagram >}}
```

**Style is applied for you** by `assets/js/plotly-figures.js`: the page font,
soft horizontal grid lines, a baseline under the plot, no tick marks, rounded
bar ends, 2.25px lines, unified hover labels, a dotted crosshair on line
charts, and no zoom or toolbar (so phones can still scroll past a chart). Set
only what the chart needs: data, axis titles, ranges, tick values and formats,
reference lines (`shapes`) and direct labels (`annotations`).

- **Colours:** give each trace `"color"` as a palette name (`blue`, `red`,
  `green`, `amber`, `purple`, `magenta`, `teal`, `gold`, `yellow`, `gray`,
  `slate`, `muted`) or any CSS colour, and use the matching legend key class
  (`fig-key--blue`, ...). Keep one colour per series across all panels of a figure.
- **Legend:** an HTML `.fig-legend` above the panels (or inside a panel, under
  its title). Each entry's text must equal the trace `name` (or `legendgroup`)
  it stands for: entries then become toggles. Hovering an entry highlights that
  series in every chart of the figure, and clicking it hides or shows the series.
  Keys: `fig-key` (line), `fig-key fig-key--dash` (dashed line), `fig-key fig-key--box` (bar, area).
- **Axis titles:** a y-axis title is drawn horizontally above the plot, not
  rotated. Put "lower/higher is better" and similar notes in `.fig-plot-sub`.
- **Ticks:** prefer evenly spaced ticks (`dtick`, plus `tickformat`,
  `ticksuffix` such as `"×"`). With explicit `tickvals`, the renderer writes
  the labels itself (plotly.js would drop the suffix); set `ticktext` for
  anything else, e.g. `["1s", "1m", "15m", "1d"]`.
- **Few points, markers:** lines with up to 12 points get markers; longer lines
  (CDFs, time series) are plain lines. Override with `"mode"`.
- **Direct labels:** label line ends or reference lines with `annotations`
  rather than relying on colour alone; keep annotation text ink or gray. On a
  log axis, annotations take log10 values (`"x": 3` for 1,000) while `shapes`
  take data values.
- **Reference lines:** `shapes` with `"layer": "between"` sit above the grid
  and below the data (`"below"` hides them under the grid lines).
- **Bands** (a percentile range): two traces, the lower edge with
  `"line": {"width": 0}` and `"hoverinfo": "skip"`, and the upper edge with
  `"fill": "tonexty"`; give both the same `legendgroup` and `"table": false`.
- **Stacked areas:** traces with the same `"stackgroup"`.
- **Box plots:** `"type": "box"` with precomputed `q1`, `median`, `q3`,
  `lowerfence`, `upperfence` arrays (one value per box).
- **Heat maps:** `"type": "heatmap"` with `x`, `y`, `z` and a `colorscale`.
- **Sizes:** chart text does not scale with the chart, so give charts room:
  `size="medium"` for one panel, `size="large"` for two side by side,
  `size="wide"` for three or more (`fig-plots--3`). Panels stack on phones.
- **Site keys in the JSON:** `color` and `table` on a trace; `unit` (hover
  suffix), `decimals` (number format in hover and table), `xname` (the table's
  first column heading) and `table` (`false` for none, `true` to force one) on
  the spec. A trace with a `text` array shows that text instead of its value
  in hover labels and the table (e.g. `"> 1.3"` for a bar cut off by the axis).
- `layouts/_default/single.html` loads plotly.js (cartesian bundle: bar,
  scatter, box, heatmap, histogram and more; a pinned version from jsdelivr
  with an integrity hash) only on pages that contain a chart.

Example: `content/blog/segcache/index.md` (Figures 5 and 6).

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

No post uses `panels` at the moment: plots with data are charts (see above).
It remains the tool for a multi-panel figure you only have as a picture.

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
