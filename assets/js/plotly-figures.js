/*
 * Draws the charts written with the {{< plotly >}} shortcode
 * (layouts/shortcodes/plotly.html) and applies the site's chart style, so a
 * post only carries its data and a few per-chart choices. See docs/figures.md.
 *
 * Loaded with `defer` after plotly.js by layouts/_default/single.html, only on
 * pages that contain a chart. If plotly.js does not load, each chart keeps its
 * text description and data table.
 */
(function () {
  'use strict';

  var charts = document.querySelectorAll('[data-plotly]');
  if (!charts.length || !window.Plotly) return;

  // Same tokens as assets/css/figures.css.
  var INK = '#1f2328';
  var MUTED = '#6b7280';
  var BORDER = '#e5e7eb';
  var GRID = '#eef0f3';
  var BASELINE = '#c4c9d1';
  var SPIKE = '#9ca3af';

  // Series colours by name (a trace's "color" may also be any CSS colour).
  // Categorical order checked for colour-vision deficiency on adjacent pairs.
  var PALETTE = {
    blue: '#2a78d6',
    red: '#e8502c',
    green: '#1baf7a',
    amber: '#eda100',
    purple: '#6250d6',
    magenta: '#d55181',
    teal: '#2d7a6c',
    gold: '#b8862f',
    yellow: '#e7bd38',
    gray: '#6b7280',
    slate: '#4b5563',
    muted: '#c3c8d0'
  };

  var FONT = window.getComputedStyle(document.body).fontFamily ||
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // Deep-merge plain objects; arrays and values from `over` replace `base`.
  function merge(base, over) {
    var out = {};
    var k;
    for (k in base) out[k] = base[k];
    for (k in over) {
      out[k] = isObject(base[k]) && isObject(over[k]) ? merge(base[k], over[k]) : over[k];
    }
    return out;
  }

  function colour(c) {
    return PALETTE[c] || c;
  }

  // rgba() for a hex colour, for fills and bands.
  function tint(c, alpha) {
    var hex = colour(c);
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function axis(isY) {
    return {
      automargin: true,
      fixedrange: true,           // no zoom or pan: page scrolling stays free on phones
      showgrid: isY,
      gridcolor: GRID,
      gridwidth: 1,
      zeroline: false,
      showline: !isY,             // a baseline under the plot, no line up the side
      linecolor: BASELINE,
      linewidth: 1,
      ticks: '',
      showspikes: false,          // line charts turn the crosshair back on
      tickfont: { size: 12, color: MUTED },
      title: { font: { size: 12, color: MUTED }, standoff: 10 },
      layer: 'below traces'
    };
  }

  var LAYOUT = {
    font: { family: FONT, size: 12, color: MUTED },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 4, r: 14, t: 30, b: 4 },    // automargin grows these to fit labels
    showlegend: false,                       // legends are HTML (.fig-legend)
    dragmode: false,
    hovermode: 'x unified',
    hoverdistance: 40,
    hoverlabel: {
      bgcolor: '#ffffff',
      bordercolor: BORDER,
      align: 'left',
      namelength: -1,
      font: { family: FONT, size: 12, color: INK }
    },
    bargap: 0.3,
    bargroupgap: 0.12,
    barcornerradius: 3,
    xaxis: axis(false),
    yaxis: axis(true)
  };

  var CONFIG = { responsive: true, displayModeBar: false, scrollZoom: false, doubleClick: false };

  function count(t) {
    return (t.y || t.x || []).length;
  }

  var COLORBAR = {
    thickness: 10,
    outlinewidth: 0,
    tickfont: { size: 12, color: MUTED },
    title: { font: { size: 12, color: MUTED } }
  };

  function dotsOnly(t) {
    return (t.type || 'scatter') === 'scatter' && t.mode === 'markers';
  }

  function styleTrace(t, spec) {
    var c = colour(t.color);
    var type = t.type || 'scatter';
    var base = {};
    var silent = t.hoverinfo === 'skip' || t.hoverinfo === 'none';
    if ((type === 'bar' || type === 'scatter') && !silent) {
      var value = t.text ? '%{text}' : (t.orientation === 'h' ? '%{x}' : '%{y}') + (spec.unit ? ' ' + spec.unit : '');
      base.hovertemplate = '%{fullData.name}: ' + value + '<extra></extra>';
    }
    if (type === 'bar') {
      base.marker = { color: c, line: { width: 0 } };
      base.textposition = 'none';            // text is for hover and the table
    } else if (type === 'scatter') {
      var few = count(t) <= 12;
      base.mode = few ? 'lines+markers' : 'lines';
      base.line = { color: c, width: 2.25, shape: 'linear' };
      base.marker = { color: c, size: 7, line: { color: '#ffffff', width: 1.5 } };
      if (t.stackgroup) {
        // Stacked areas: solid fills split by a thin surface-coloured line.
        base.mode = 'lines';
        base.fillcolor = tint(c, 0.9);
        base.line = { color: '#ffffff', width: 0.75 };
      } else if (t.fill && t.fill !== 'none') {
        // A band (e.g. a percentile range) drawn to the previous trace.
        base.mode = 'lines';
        base.fillcolor = tint(c, 0.16);
        base.line = { color: 'rgba(0,0,0,0)', width: 0 };
        base.hoverinfo = 'skip';
        delete base.hovertemplate;
      }
    } else if (type === 'heatmap') {
      base.colorbar = COLORBAR;
      base.hoverongaps = false;
    } else if (type === 'box') {
      base.line = { color: c, width: 1.5 };
      base.fillcolor = tint(c, 0.22);
      base.whiskerwidth = 0.5;
      base.boxpoints = false;
      base.hoverinfo = 'y';
    }
    if (type === 'scatter' && t.marker && t.marker.showscale) {
      base.marker = merge(base.marker || {}, { colorbar: COLORBAR });
    }
    var own = merge({}, t);
    delete own.color;               // site keys, not plotly.js attributes
    delete own.table;
    return merge(base, own);
  }

  // Number for a tick label: fixed decimals for ".Nf" formats, otherwise short
  // (1.5, 30, 2K, 10M on log axes or from 10,000 up).
  function tickLabel(v, ax) {
    var m = /^,?\.(\d+)f$/.exec(ax.tickformat || '');
    var text;
    if (m) {
      text = Number(v).toFixed(+m[1]);
    } else {
      var a = Math.abs(v);
      var short = function (x) { return String(Number(Number(x).toPrecision(6))); };
      text = short(v);
      if (ax.type === 'log' ? a >= 1e3 : a >= 1e4) {
        var units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
        for (var i = 0; i < units.length; i++) {
          if (a >= units[i][0]) { text = short(v / units[i][0]) + units[i][1]; break; }
        }
      }
    }
    return (ax.tickprefix || '') + text + (ax.ticksuffix || '');
  }

  // With explicit tick values, plotly.js drops tick prefixes/suffixes and
  // prints the labels with the hover format: write the labels out instead.
  function labelTicks(ax) {
    var vals = ax.tickvals;
    if (!Array.isArray(vals) || ax.ticktext || !(ax.ticksuffix || ax.tickprefix || ax.hoverformat)) return ax;
    if (!vals.every(function (v) { return typeof v === 'number'; })) return ax;
    return merge(ax, { ticktext: vals.map(function (v) { return tickLabel(v, ax); }) });
  }

  function styleLayout(spec, data) {
    var lines = data.some(function (t) { return (t.type || 'scatter') === 'scatter' && !dotsOnly(t); });
    var bars = data.some(function (t) { return t.type === 'bar'; });
    var horizontal = data.some(function (t) { return t.orientation === 'h'; });
    var points = data.length && data.every(function (t) { return t.type === 'heatmap' || dotsOnly(t); });

    // Defaults by chart type; the spec's own layout always has the last word.
    var base = merge(LAYOUT, {});
    if (lines && !bars) {
      // Line charts get a vertical crosshair while hovering.
      base.xaxis = merge(base.xaxis, {
        showspikes: true, spikemode: 'across', spikesnap: 'cursor',
        spikecolor: SPIKE, spikethickness: 1, spikedash: 'dot'
      });
    }
    if (points) {
      // Heat maps and dot plots: hover the nearest cell or dot.
      base.hovermode = 'closest';
    }
    if (horizontal) {
      // Horizontal bars and boxes: grid along x, categories read top to bottom.
      base.hovermode = 'y unified';
      base.xaxis = merge(base.xaxis, { showgrid: true, showline: false });
      base.yaxis = merge(base.yaxis, { showgrid: false, showline: true, autorange: 'reversed' });
    }
    var layout = merge(base, spec.layout || {});
    if (spec.decimals != null) {
      var valueAxis = horizontal ? 'xaxis' : 'yaxis';
      var va = layout[valueAxis];
      if (!va.hoverformat) layout[valueAxis] = merge(va, { hoverformat: ',.' + spec.decimals + 'f' });
    }
    ['xaxis', 'yaxis'].forEach(function (k) { layout[k] = labelTicks(layout[k]); });

    // The y-axis title reads horizontally above the plot instead of rotated.
    var yTitle = !horizontal && layout.yaxis.title && layout.yaxis.title.text;
    if (yTitle) {
      layout.yaxis = merge(layout.yaxis, { title: { text: '' } });
      layout.title = {
        text: yTitle,
        x: 0, xref: 'container', xanchor: 'left',
        y: 1, yref: 'container', yanchor: 'top',
        pad: { l: 2, t: 2 },
        font: { size: 12, color: MUTED }
      };
    } else if (!layout.title) {
      layout.margin = merge(layout.margin, { t: 10 });
    }
    return layout;
  }

  function seriesName(t) {
    return t.legendgroup || t.name;
  }

  function filled(t) {
    return !!t.stackgroup || (t.fill && t.fill !== 'none');
  }

  // The same colour with its alpha scaled by k.
  function fade(c, k) {
    var m = /rgba?\(([^)]*)\)/.exec(c || '');
    if (!m) return tint(c, k);
    var p = m[1].split(',');
    var a = p.length > 3 ? parseFloat(p[3]) : 1;
    return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + (a * k).toFixed(3) + ')';
  }

  // HTML legends drive the charts in their figure: hovering a series
  // highlights it, and clicking (or Enter/Space) hides or shows it.
  function wireLegends() {
    Array.prototype.forEach.call(document.querySelectorAll('.fig'), function (fig) {
      var plots = Array.prototype.slice.call(fig.querySelectorAll('[data-plotly]'))
        .filter(function (el) { return el.data; });
      if (!plots.length) return;
      plots.forEach(function (el) {
        el._siteFill = el._fullData.map(function (t) { return t.fillcolor; });
      });
      Array.prototype.forEach.call(fig.querySelectorAll('.fig-legend > span'), function (item) {
        var name = item.getAttribute('data-series') || item.textContent.trim();
        var targets = [];
        plots.forEach(function (el) {
          var idx = [];
          el.data.forEach(function (t, i) { if (seriesName(t) === name) idx.push(i); });
          if (idx.length) targets.push({ el: el, idx: idx });
        });
        if (!targets.length) return;

        item.classList.add('fig-legend-toggle');
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-pressed', 'true');
        item.title = 'Show or hide ' + name;

        function toggle() {
          var off = item.classList.toggle('is-off');
          item.setAttribute('aria-pressed', String(!off));
          targets.forEach(function (t) {
            Plotly.restyle(t.el, { visible: off ? 'legendonly' : true }, t.idx);
          });
        }
        // Dims the other series. plotly.js ignores trace opacity on filled
        // areas, so stacked areas and bands fade through their fill colour.
        function highlight(on) {
          plots.forEach(function (el) {
            var lineIdx = [], lineOpacity = [], fillIdx = [], fillColour = [];
            el.data.forEach(function (t, i) {
              var keep = !on || seriesName(t) === name;
              if (filled(t)) {
                fillIdx.push(i);
                fillColour.push(keep ? el._siteFill[i] : fade(el._siteFill[i], 0.22));
              } else {
                lineIdx.push(i);
                lineOpacity.push(keep ? 1 : 0.22);
              }
            });
            if (lineIdx.length) Plotly.restyle(el, { opacity: lineOpacity }, lineIdx);
            if (fillIdx.length) Plotly.restyle(el, { fillcolor: fillColour }, fillIdx);
          });
        }
        item.addEventListener('click', toggle);
        item.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
        item.addEventListener('mouseenter', function () { highlight(true); });
        item.addEventListener('mouseleave', function () { highlight(false); });
        item.addEventListener('focus', function () { highlight(true); });
        item.addEventListener('blur', function () { highlight(false); });
      });
    });
  }

  var pending = [];
  Array.prototype.forEach.call(charts, function (el) {
    var spec = JSON.parse(el.getAttribute('data-plotly'));
    var data = (spec.data || []).map(function (t) { return styleTrace(t, spec); });
    var layout = styleLayout(spec, data);
    el.textContent = '';
    el.classList.add('is-drawn');
    pending.push(Plotly.newPlot(el, data, layout, merge(CONFIG, spec.config || {})));
  });
  Promise.all(pending).then(wireLegends);
})();
