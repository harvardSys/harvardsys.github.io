/*
 * Draws the charts written with the {{< plotly >}} shortcode
 * (layouts/shortcodes/plotly.html). Each chart is an element with a
 * data-plotly attribute holding a plotly.js spec; the site's chart style is
 * applied here, so a post only carries its data and a few per-chart choices.
 *
 * Loaded with `defer` after plotly.js by layouts/_default/single.html, only on
 * pages that contain a chart. If plotly.js does not load, each chart keeps its
 * fallback text and the data table below it.
 */
(function () {
  'use strict';

  var charts = document.querySelectorAll('[data-plotly]');
  if (!charts.length || !window.Plotly) return;

  // Same tokens as assets/css/figures.css.
  var FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  var INK = '#1f2328';
  var INK_2 = '#4b5563';
  var LINE = '#d1d5db';
  var GRID = '#e5e7eb';
  var AXIS = '#9ca3af';

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

  function axis(grid) {
    return {
      automargin: true,
      fixedrange: true,           // no zoom or pan: page scrolling stays free on phones
      showgrid: grid,
      gridcolor: GRID,
      zeroline: false,
      showline: true,
      linecolor: AXIS,
      ticks: 'outside',
      ticklen: 3,
      tickcolor: AXIS,
      tickfont: { size: 12, color: INK_2 },
      title: { font: { size: 13, color: INK }, standoff: 10 }
    };
  }

  var LAYOUT = {
    font: { family: FONT, size: 12, color: INK_2 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 10, r: 10, t: 10, b: 10 },   // automargin grows these to fit labels
    showlegend: false,                       // legends are HTML (.fig-legend)
    dragmode: false,
    hovermode: 'x unified',
    hoverlabel: { bgcolor: '#ffffff', bordercolor: LINE, font: { family: FONT, size: 12, color: INK } },
    bargap: 0.2,
    bargroupgap: 0,
    xaxis: axis(false),
    yaxis: axis(true)
  };

  var CONFIG = { responsive: true, displayModeBar: false, scrollZoom: false, doubleClick: false };

  function styleTrace(t, unit) {
    var value = t.text ? '%{text}' : '%{y}' + (unit ? ' ' + unit : '');
    var base = { hovertemplate: '%{fullData.name}: ' + value + '<extra></extra>' };
    if (t.type === 'bar') {
      // A 1px surface edge keeps a 2px gap between adjacent bars.
      base.marker = { color: t.color, line: { color: '#ffffff', width: 1 } };
      base.textposition = 'none';            // text is for hover and the table
    } else {
      base.mode = 'lines+markers';
      base.line = { color: t.color, width: 2 };
      base.marker = { color: t.color, size: 7, line: { color: '#ffffff', width: 1 } };
    }
    var own = merge({}, t);
    delete own.color;
    return merge(base, own);
  }

  Array.prototype.forEach.call(charts, function (el) {
    var spec = JSON.parse(el.getAttribute('data-plotly'));
    var data = (spec.data || []).map(function (t) { return styleTrace(t, spec.unit); });
    var layout = merge(LAYOUT, spec.layout || {});
    if (spec.decimals != null && !layout.yaxis.hoverformat) {
      layout.yaxis = merge(layout.yaxis, { hoverformat: '.' + spec.decimals + 'f' });
    }
    el.textContent = '';
    Plotly.newPlot(el, data, layout, merge(CONFIG, spec.config || {}));
  });
})();
