+++
date = '2026-07-30T14:34:12-04:00'
draft = false
title = 'When Bursty Traffic Makes LLM Inference Faster'
author = 'Akira van de Groenendaal'
tags = ['LLM', 'systems', 'serving']
summary = 'Bursty arrivals usually cause a drop in performance and are seen as headaches in production systems. In this blog, we investigate a phenomenon where burstiness actually improves performance, uncovering what conditions produce this effect.'
bio = 'Akira van de Groenendaal is a senior studying Computer Science at Carnegie Mellon University, currently doing research with the Harvard Systems Group under Prof. Juncheng Yang. He works on ML systems, with interests in workload analysis and the queueing dynamics of LLM inference.'
tldr = 'Burstier arrivals made LLM inference faster in my benchmarks, contradicting standard intuition—burstiness separates decode tokens from heavy prefills, reducing interference. However, that interference is largely attributable to a kernel optimization artifact, and the benefits of burstiness only appear when mixed batches are inefficient.'
+++

## Introduction

Bursty workloads have been giving computer scientists headaches for decades, and modern LLM serving is no different. Big bursts create instantaneous load and latency spikes, and there's a whole host of literature exploring how to deal with them.

The reason burstiness hurts, intuitively, is because we have the same mean arrival rate but requests are more likely to arrive very close together, or very far apart. To the server, it looks like it's getting flooded within a short window, followed by a dead period. The result is worse performance but the same long run utilization compared to a more regular workload.

So, when I was doing some routine vLLM benchmarking and found that as the arrivals got more bursty, latency decreased rather than increased, it was pretty surprising! Beyond contradicting standard intuition, this would have implications for how request routing should be done in production inference clusters. 

In this short blog, we'll explore the data that gives confidence to those results, but surfaces a confound that takes the project from the best thing since sliced bread to... the second best thing since sliced bread.
## Results: burstiness lowers latency

In this plot, we see that as the coefficient of variation of the interarrival times increases (more bursty), the median time per output token (TPOT) and end-to-end latency (E2EL) decrease. This was observed on both synthetic and realistic workloads, like ShareGPT and BurstGPT. Time to first token (TTFT) is much more config dependent, though we'd expect it to worsen due to the "clustering" of arrivals.

{{< diagram size="wide" caption="Figure 1: Median/p90 TPOT and E2EL decrease ~50% between CV = 1 (Poisson process) and CV = 3.16 (very bursty arrivals) on BurstGPT. TTFT improves non-monotonically. Mean TPOT (not shown) improves 57% from 70 ms to 30 ms. Bands represent standard deviation across 6 replications at 1k requests." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--blue"></i>Mean of 6 runs</span>
  <span><i class="fig-key fig-key--box" style="--c: rgba(42, 120, 214, 0.2)"></i>±1 standard deviation</span>
</div>
<div class="fig-plots fig-plots--3">
  <figure class="fig-plot">
    <div class="fig-plot-title">Median TPOT</div>
    <div class="fig-plot-sub">Time per output token (ms); lower is better</div>
    {{< plotly height="230" alt="Median time per output token against arrival CV, the mean of 6 runs with a band of ±1 standard deviation: 61.1 ± 12.8 ms at CV 1; 42.3 ± 5.5 ms at CV 1.41; 29.2 ± 4.0 ms at CV 3.16." >}}
    {
      "unit": "ms",
      "decimals": 1,
      "xname": "Arrival CV",
      "data": [
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "mode": "lines", "x": [1, 1.41, 3.16], "y": [48.31, 36.84, 25.21], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [73.93, 47.81, 33.25], "table": false},
        {"type": "scatter", "name": "Mean of 6 runs", "color": "blue", "x": [1, 1.41, 3.16], "y": [61.12, 42.32, 29.23], "text": ["61.1 ± 12.8", "42.3 ± 5.5", "29.2 ± 4.0"], "hovertemplate": "%{fullData.name}: %{text} ms<extra></extra>"}
      ],
      "layout": {"hoverdistance": -1, "xaxis": {"title": {"text": "Arrival CV (more bursty →)"}, "range": [0.82, 3.34], "tickvals": [1, 1.41, 3.16], "ticktext": ["1", "1.41", "3.16"], "unifiedhovertitle": {"text": "CV = %{x}"}}, "yaxis": {"range": [20, 80], "dtick": 20}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Median E2EL</div>
    <div class="fig-plot-sub">End-to-end latency (s); lower is better</div>
    {{< plotly height="230" alt="Median end-to-end latency against arrival CV, the mean of 6 runs with a band of ±1 standard deviation: 19.0 ± 3.7 s at CV 1; 12.6 ± 1.5 s at CV 1.41; 8.7 ± 0.8 s at CV 3.16." >}}
    {
      "unit": "s",
      "decimals": 1,
      "xname": "Arrival CV",
      "data": [
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "mode": "lines", "x": [1, 1.41, 3.16], "y": [15.28, 11.03, 7.94], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [22.71, 14.08, 9.52], "table": false},
        {"type": "scatter", "name": "Mean of 6 runs", "color": "blue", "x": [1, 1.41, 3.16], "y": [18.99, 12.56, 8.73], "text": ["19.0 ± 3.7", "12.6 ± 1.5", "8.7 ± 0.8"], "hovertemplate": "%{fullData.name}: %{text} s<extra></extra>"}
      ],
      "layout": {"hoverdistance": -1, "xaxis": {"title": {"text": "Arrival CV (more bursty →)"}, "range": [0.82, 3.34], "tickvals": [1, 1.41, 3.16], "ticktext": ["1", "1.41", "3.16"], "unifiedhovertitle": {"text": "CV = %{x}"}}, "yaxis": {"range": [5, 25], "dtick": 5}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Median TTFT</div>
    <div class="fig-plot-sub">Time to first token (ms); lower is better</div>
    {{< plotly height="230" alt="Median time to first token against arrival CV, the mean of 6 runs with a band of ±1 standard deviation: 270 ± 61 ms at CV 1; 222 ± 28 ms at CV 1.41; 296 ± 28 ms at CV 3.16." >}}
    {
      "unit": "ms",
      "decimals": 0,
      "xname": "Arrival CV",
      "data": [
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "mode": "lines", "x": [1, 1.41, 3.16], "y": [209, 193.4, 268.5], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [331.1, 250.3, 323.5], "table": false},
        {"type": "scatter", "name": "Mean of 6 runs", "color": "blue", "x": [1, 1.41, 3.16], "y": [270, 221.9, 296], "text": ["270 ± 61", "222 ± 28", "296 ± 28"], "hovertemplate": "%{fullData.name}: %{text} ms<extra></extra>"}
      ],
      "layout": {"hoverdistance": -1, "xaxis": {"title": {"text": "Arrival CV (more bursty →)"}, "range": [0.82, 3.34], "tickvals": [1, 1.41, 3.16], "ticktext": ["1", "1.41", "3.16"], "unifiedhovertitle": {"text": "CV = %{x}"}}, "yaxis": {"range": [150, 350], "dtick": 50}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">p90 TPOT</div>
    <div class="fig-plot-sub">Time per output token (ms); lower is better</div>
    {{< plotly height="230" alt="90th-percentile time per output token against arrival CV, the mean of 6 runs with a band of ±1 standard deviation: 116.9 ± 22.8 ms at CV 1; 75.7 ± 9.4 ms at CV 1.41; 40.2 ± 6.2 ms at CV 3.16." >}}
    {
      "unit": "ms",
      "decimals": 1,
      "xname": "Arrival CV",
      "data": [
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "mode": "lines", "x": [1, 1.41, 3.16], "y": [94.16, 66.36, 33.97], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [139.7, 85.08, 46.34], "table": false},
        {"type": "scatter", "name": "Mean of 6 runs", "color": "blue", "x": [1, 1.41, 3.16], "y": [116.9, 75.72, 40.15], "text": ["116.9 ± 22.8", "75.7 ± 9.4", "40.2 ± 6.2"], "hovertemplate": "%{fullData.name}: %{text} ms<extra></extra>"}
      ],
      "layout": {"hoverdistance": -1, "xaxis": {"title": {"text": "Arrival CV (more bursty →)"}, "range": [0.82, 3.34], "tickvals": [1, 1.41, 3.16], "ticktext": ["1", "1.41", "3.16"], "unifiedhovertitle": {"text": "CV = %{x}"}}, "yaxis": {"range": [25, 150], "dtick": 25.0}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">p90 E2EL</div>
    <div class="fig-plot-sub">End-to-end latency (s); lower is better</div>
    {{< plotly height="230" alt="90th-percentile end-to-end latency against arrival CV, the mean of 6 runs with a band of ±1 standard deviation: 39.5 ± 5.7 s at CV 1; 29.7 ± 3.2 s at CV 1.41; 19.1 ± 2.8 s at CV 3.16." >}}
    {
      "unit": "s",
      "decimals": 1,
      "xname": "Arrival CV",
      "data": [
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "mode": "lines", "x": [1, 1.41, 3.16], "y": [33.81, 26.53, 16.24], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [45.17, 32.91, 21.87], "table": false},
        {"type": "scatter", "name": "Mean of 6 runs", "color": "blue", "x": [1, 1.41, 3.16], "y": [39.49, 29.72, 19.06], "text": ["39.5 ± 5.7", "29.7 ± 3.2", "19.1 ± 2.8"], "hovertemplate": "%{fullData.name}: %{text} s<extra></extra>"}
      ],
      "layout": {"hoverdistance": -1, "xaxis": {"title": {"text": "Arrival CV (more bursty →)"}, "range": [0.82, 3.34], "tickvals": [1, 1.41, 3.16], "ticktext": ["1", "1.41", "3.16"], "unifiedhovertitle": {"text": "CV = %{x}"}}, "yaxis": {"range": [10, 50], "dtick": 10}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">p90 TTFT</div>
    <div class="fig-plot-sub">Time to first token (ms); lower is better</div>
    {{< plotly height="230" alt="90th-percentile time to first token against arrival CV, the mean of 6 runs with a band of ±1 standard deviation: 975 ± 441 ms at CV 1; 477 ± 29 ms at CV 1.41; 553 ± 44 ms at CV 3.16." >}}
    {
      "unit": "ms",
      "decimals": 0,
      "xname": "Arrival CV",
      "data": [
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "mode": "lines", "x": [1, 1.41, 3.16], "y": [533.2, 447.5, 509], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "±1 standard deviation", "legendgroup": "±1 standard deviation", "showlegend": false, "color": "blue", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [1416, 506, 597.3], "table": false},
        {"type": "scatter", "name": "Mean of 6 runs", "color": "blue", "x": [1, 1.41, 3.16], "y": [974.7, 476.8, 553.1], "text": ["975 ± 441", "477 ± 29", "553 ± 44"], "hovertemplate": "%{fullData.name}: %{text} ms<extra></extra>"}
      ],
      "layout": {"hoverdistance": -1, "xaxis": {"title": {"text": "Arrival CV (more bursty →)"}, "range": [0.82, 3.34], "tickvals": [1, 1.41, 3.16], "ticktext": ["1", "1.41", "3.16"], "unifiedhovertitle": {"text": "CV = %{x}"}}, "yaxis": {"range": [250, 1500], "dtick": 250.0}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

In fact, burstiness generally helps most of the distribution, sometimes slightly hurting the tail (Fig. 2). 

{{< diagram size="medium" caption="Figure 2: TPOT estimated CDF on BurstGPT shows that burstier arrivals improve the whole distribution." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--dash" style="--c: #9d93ec; background: repeating-linear-gradient(90deg, var(--c) 0 6px, transparent 6px 8px, var(--c) 8px 10px, transparent 10px 12px)"></i>Low burstiness (CV = 1.0)</span>
  <span><i class="fig-key fig-key--dash" style="--c: #6250d6"></i>Medium burstiness (CV = 1.41)</span>
  <span><i class="fig-key" style="--c: #33248a"></i>High burstiness (CV = 3.16)</span>
</div>
<div class="fig-plots fig-plots--1">
  <figure class="fig-plot">
    <div class="fig-plot-title">TPOT distribution by burstiness</div>
    <div class="fig-plot-sub">Qwen3.5-9B on GH200, BurstGPT; left is better</div>
    {{< plotly height="300" alt="Cumulative distribution of time per output token for three burstiness levels. Burstier arrivals move the whole curve to the left: the median TPOT is 58 ms at CV 1.0, 40 ms at CV 1.41 and 27 ms at CV 3.16, and the 90th percentile is 113, 74 and 42 ms. About 4% of requests have a TPOT near 0 ms at every level. The CV 1.0 curve has the longest tail, up to 460 ms." >}}
    {
      "unit": "ms",
      "table": false,
      "data": [
        {"type": "scatter", "name": "Low burstiness (CV = 1.0)", "color": "#9d93ec", "x": [0.002561, 0.006304, 0.01005, 0.01379, 0.01566, 0.01604, 0.01641, 0.01678, 0.01716, 0.01753, 9.974, 13.63, 16.72, 18.42, 19.96, 21.36, 22.71, 23.94, 24.89, 26.22, 26.95, 27.63, 28.44, 29.09, 29.93, 30.63, 31.62, 32.21, 33.2, 34, 34.7, 35.51, 36.26, 37.18, 38.2, 38.72, 39.54, 40.49, 41.48, 42.37, 43.28, 44.03, 44.79, 45.63, 46.44, 47.26, 48.05, 48.93, 49.87, 50.82, 51.87, 52.58, 53.4, 54.35, 55.3, 56.63, 57.95, 58.82, 59.82, 60.77, 61.47, 62.36, 63.38, 64.23, 65.1, 65.97, 67.01, 68.11, 69.03, 69.99, 71.26, 72.31, 73.4, 74.26, 75.55, 76.8, 77.96, 78.91, 80.17, 81.27, 82.4, 83.55, 84.92, 86.28, 87.68, 89.19, 90.79, 91.98, 93.76, 95.32, 97.24, 99.51, 101.5, 103.9, 106.8, 109.4, 112.8, 116.5, 120.8, 125.8, 133.3, 140.3, 150.8, 168.4, 179.2, 192.6, 219.3, 260.5, 339.7, 359.3, 386.4, 409.2, 441.8, 459.7], "y": [0.0, 0.01, 0.02, 0.03, 0.035, 0.036, 0.037, 0.038, 0.039, 0.04, 0.045, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.975, 0.98, 0.985, 0.99, 0.995, 0.996, 0.997, 0.998, 0.999, 1.0], "hovertemplate": "%{fullData.name}: %{x:.1f} ms<extra></extra>", "table": false, "line": {"dash": "dashdot"}},
        {"type": "scatter", "name": "Medium burstiness (CV = 1.41)", "color": "#6250d6", "x": [0.002721, 0.006567, 0.01041, 0.01426, 0.01618, 0.01657, 0.01695, 0.01734, 0.01772, 2.812, 7.371, 9.266, 11.12, 12.7, 13.71, 14.59, 15.26, 15.69, 16.26, 16.81, 17.12, 17.58, 18.19, 18.66, 19.18, 19.79, 20.45, 21.4, 22.07, 22.94, 23.41, 23.8, 24.49, 24.93, 25.73, 26.42, 27.13, 27.71, 28.37, 29.03, 29.51, 30.2, 30.8, 31.63, 32.15, 32.82, 33.38, 34.16, 34.97, 35.61, 36.14, 36.8, 37.51, 38.19, 38.71, 39.19, 39.97, 40.68, 41.41, 42.04, 42.73, 43.38, 44.09, 44.77, 45.66, 46.14, 46.88, 47.43, 47.91, 49.04, 49.81, 50.66, 51.54, 52.21, 53.29, 53.92, 54.39, 54.89, 55.5, 56.38, 57.17, 57.85, 58.75, 59.6, 60.37, 61.31, 62.24, 63.23, 64.21, 65.36, 66.3, 67.27, 67.98, 69.44, 70.66, 72.13, 74.32, 77.07, 79.43, 82.52, 86.25, 90.91, 97.59, 107.3, 117.3, 121.6, 124.4, 134.7, 144.1, 148.7, 150.8, 164.6, 172.6, 208.3], "y": [0.0, 0.01, 0.02, 0.03, 0.035, 0.036, 0.037, 0.038, 0.039, 0.04, 0.045, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.975, 0.98, 0.985, 0.99, 0.995, 0.996, 0.997, 0.998, 0.999, 1.0], "hovertemplate": "%{fullData.name}: %{x:.1f} ms<extra></extra>", "table": false, "line": {"dash": "dash"}},
        {"type": "scatter", "name": "High burstiness (CV = 3.16)", "color": "#33248a", "x": [0.002465, 0.00659, 0.01072, 0.01484, 0.0169, 0.01732, 0.01773, 0.01814, 0.01855, 0.01897, 6.421, 7.337, 9.177, 10.36, 11.41, 12.31, 12.95, 13.48, 13.94, 14.42, 14.83, 15.23, 15.74, 16.2, 16.61, 17.04, 17.54, 18, 18.38, 18.8, 19.25, 19.61, 20.07, 20.44, 20.81, 21.17, 21.55, 22.02, 22.42, 22.69, 22.98, 23.31, 23.59, 23.89, 24.17, 24.39, 24.66, 24.9, 25.17, 25.37, 25.57, 25.79, 26.01, 26.21, 26.41, 26.62, 26.82, 27.02, 27.19, 27.42, 27.7, 27.93, 28.21, 28.45, 28.65, 28.84, 29.06, 29.32, 29.54, 29.74, 29.98, 30.24, 30.51, 30.78, 31.16, 31.56, 31.98, 32.33, 32.68, 33.09, 33.5, 33.94, 34.44, 35.05, 35.58, 36.26, 36.91, 37.52, 38.14, 38.71, 39.22, 39.63, 40.03, 40.44, 40.81, 41.23, 41.65, 42.18, 42.97, 44.32, 45.59, 47.73, 50.52, 56.54, 61.72, 68.06, 80.74, 90.45, 100, 110.2, 120.2, 128.7, 152.6, 220.2], "y": [0.0, 0.01, 0.02, 0.03, 0.035, 0.036, 0.037, 0.038, 0.039, 0.04, 0.045, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.975, 0.98, 0.985, 0.99, 0.995, 0.996, 0.997, 0.998, 0.999, 1.0], "hovertemplate": "%{fullData.name}: %{x:.1f} ms<extra></extra>", "table": false}
      ],
      "layout": {"hovermode": "y unified", "xaxis": {"title": {"text": "TPOT (ms)"}, "range": [-10, 480], "dtick": 100, "showspikes": false}, "yaxis": {"title": {"text": "Fraction of requests at or below"}, "range": [-0.01, 1.02], "tickvals": [0, 0.2, 0.4, 0.6, 0.8, 1], "ticktext": ["0", "0.2", "0.4", "0.6", "0.8", "1"], "showspikes": true, "spikemode": "across", "spikesnap": "cursor", "spikecolor": "#9ca3af", "spikethickness": 1, "spikedash": "dot", "unifiedhovertitle": {"text": "%{y:.1~%} of requests at or below"}}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

The appendix includes far more results, spanning multiple models, GPUs, and datasets, increasing our confidence that this behavior generalizes.
### A familiar explanation

Loosely, higher burstiness means the gaps between arrivals are more weighted to very small or very large values. We can then picture getting a clump of arrivals, followed by a quiet period where the engine performs a bunch of decode without interruption. It follows that we should expect more iterations which are exclusively decode, but more importantly, that decode tokens get separated from large prefills.

This hypothesis is supported by the data, which follows the trend shown in Fig. 3: higher burstiness increases the fraction of tokens that are part of decode-only iterations.

{{< diagram size="medium" caption="Figure 3: The fraction of output tokens in a decode-only iteration increases by 16.8 percentage points at high burstiness. (Qwen3.5-9B | GH200 | BurstGPT)" >}}
<div class="fig-plots fig-plots--1">
  <figure class="fig-plot">
    <div class="fig-plot-title">Tokens generated in decode-only iterations</div>
    <div class="fig-plot-sub">Share of all output tokens generated in iterations with no prefill</div>
    {{< plotly height="280" alt="Two bars: 71.2% of generated tokens are produced in decode-only iterations at low burstiness (CV 1.0), and 88.0% at high burstiness (CV 3.16), 16.8 percentage points more." >}}
    {
      "xname": "Burstiness",
      "data": [
        {"type": "bar", "name": "Generated tokens in decode-only iterations", "x": ["Low burstiness (CV = 1.0)", "High burstiness (CV = 3.16)"], "y": [71.22, 87.97], "text": ["71.2%", "88.0%"], "texttemplate": "%{text}", "textposition": "outside", "cliponaxis": false, "outsidetextfont": {"color": "#1f2328", "size": 12}, "marker": {"color": ["#9d93ec", "#33248a"]}}
      ],
      "layout": {"bargap": 0.6, "xaxis": {"tickmode": "array", "tickvals": ["Low burstiness (CV = 1.0)", "High burstiness (CV = 3.16)"], "ticktext": ["Low burstiness<br>(CV = 1.0)", "High burstiness<br>(CV = 3.16)"], "tickangle": 0}, "yaxis": {"title": {"text": "Share of generated tokens (%)"}, "range": [0, 100], "dtick": 20}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

Additionally, Fig. 4 confirms that prefills get compressed together, since we see that at high burstiness, mixed batches get larger and more prefill-heavy. 

{{< diagram size="medium" caption="Figure 4: Higher burstiness concentrates arrivals, leading to larger and prefill-dominant mixed batches. (Qwen3.5-9B | GH200 | BurstGPT)" >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box fig-key--blue"></i>Decode tokens</span>
  <span><i class="fig-key fig-key--box fig-key--red"></i>Prefill tokens</span>
</div>
<div class="fig-plots fig-plots--1">
  <figure class="fig-plot">
    <div class="fig-plot-title">Mixed iteration composition</div>
    <div class="fig-plot-sub">Iterations that contain both prefill and decode tokens</div>
    {{< plotly height="300" alt="Stacked bars of the mean number of tokens in a mixed iteration. At low burstiness (CV 1.0): 248 decode and 1,826 prefill tokens, 2,074 in total. At high burstiness (CV 3.16): 165 decode and 2,919 prefill tokens, 3,084 in total." >}}
    {
      "unit": "tokens",
      "decimals": 0,
      "xname": "Burstiness",
      "data": [
        {"type": "bar", "name": "Decode tokens", "color": "blue", "x": ["Low burstiness (CV = 1.0)", "High burstiness (CV = 3.16)"], "y": [247.5, 164.9], "text": ["248", "165"], "texttemplate": "%{y:,.0f}", "textposition": "none", "insidetextanchor": "middle", "insidetextfont": {"color": "#ffffff", "size": 12}, "marker": {"line": {"width": 1, "color": "#ffffff"}}, "hovertemplate": "%{fullData.name}: %{text} tokens<extra></extra>"},
        {"type": "bar", "name": "Prefill tokens", "color": "red", "x": ["Low burstiness (CV = 1.0)", "High burstiness (CV = 3.16)"], "y": [1826, 2919], "text": ["1,826", "2,919"], "texttemplate": "%{y:,.0f}", "textposition": "inside", "insidetextanchor": "middle", "insidetextfont": {"color": "#ffffff", "size": 12}, "marker": {"line": {"width": 1, "color": "#ffffff"}}, "hovertemplate": "%{fullData.name}: %{text} tokens<extra></extra>"},
        {"type": "scatter", "name": "Total", "mode": "markers+text", "x": ["Low burstiness (CV = 1.0)", "High burstiness (CV = 3.16)"], "y": [2074, 3084], "text": ["2,074", "3,084"], "marker": {"size": 1, "color": "rgba(0,0,0,0)", "line": {"width": 0}}, "texttemplate": "%{text} total", "textposition": "top center", "cliponaxis": false, "textfont": {"color": "#1f2328", "size": 12}, "hovertemplate": "Total: %{text} tokens<extra></extra>"}
      ],
      "layout": {"barmode": "stack", "bargap": 0.6, "uniformtext": {"mode": "hide", "minsize": 11}, "xaxis": {"tickmode": "array", "tickvals": ["Low burstiness (CV = 1.0)", "High burstiness (CV = 3.16)"], "ticktext": ["Low burstiness<br>(CV = 1.0)", "High burstiness<br>(CV = 3.16)"], "tickangle": 0}, "annotations": [{"x": 0.2, "y": 123.7725, "text": "248", "showarrow": false, "xanchor": "left", "yanchor": "middle", "xshift": 4, "font": {"size": 12, "color": "#1f2328"}}, {"x": 1.2, "y": 82.4555, "text": "165", "showarrow": false, "xanchor": "left", "yanchor": "middle", "xshift": 4, "font": {"size": 12, "color": "#1f2328"}}], "yaxis": {"title": {"text": "Mean tokens per mixed iteration"}, "range": [0, 3500], "dtick": 500, "tickformat": ",d"}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

Note that figures 1 through 4 use Qwen3.5-9B, so the effects there are GDN-related and not tied to the Flash Attention versioning discussed later.

It's widely accepted that mixing prefill and decode causes interference, hence slower iterations. This is one motivator behind PD disagg. It follows that if we create more exclusive decode iterations, we reduce the prefill-decode interference, making the average decode token cheaper and speeding up the engine.

Using these few numbers, we can also loosely recover the 57% TPOT reduction presented above. 

<details>
<summary>Show the derivation (optional)</summary>

At low burstiness, 71.2% of generated tokens experience small decode-only iterations averaging 26.05 ms, while 28.8% experience large mixed iterations averaging 156.98 ms. This gives an expected GPU-forward interval of 63.73 ms. At high burstiness, the corresponding mixture is 88% at 14.36 ms and 12% at 116.02 ms, giving 26.59 ms—a 58.3% reduction, close to the observed 57% mean TPOT improvement.

Additionally, while it may seem counter-intuitive that the 3084 token mixed batch is faster than the 2074 token one, note that it contains fewer decode tokens, which are more expensive than prefill tokens. This is shown in the linear fit of Fig. A1 (appendix).

</details>

In fact, the effect is twofold. We get TPOT benefits from:
1. Moving decode tokens out of large mixed iterations into smaller decode-only iterations, and 
2. Changing the composition of mixed iterations, making them faster on average due to prefill tokens being cheaper.

Great! So overall, more burstiness → less prefill-decode interference → lower latency... Right?
## Too good to be true...

To round out the study, we decided to profile at the kernel level and validate the effects of this interference. Commonly, people claim that because prefill is compute-bound and decode is memory-bound, these two workloads create more resource contention, making each token more expensive. Not to mention, prefill generally spikes the number of tokens in the batch, making the iteration slower and destabilizing TPOT. 

Fine. The phenomenon was quick to verify with a few nsys (Nsight Systems) runs, and the interference was confirmed: the cost per decode token was up to 4x higher in mixed batches compared to pure decode batches (Fig. 5), depending on the config.

{{< diagram size="medium" caption="Figure 5: Each decode token is ~2x more expensive in a mixed batch, per iteration (Llama-3.1-8B, vLLM, A100). In attention alone, each decode token is 4x more expensive in a mixed batch." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box fig-key--blue"></i>Decode-only batch</span>
  <span><i class="fig-key fig-key--box fig-key--red"></i>Mixed batch</span>
</div>
<div class="fig-plots fig-plots--1">
  <figure class="fig-plot">
    <div class="fig-plot-title">Cost per decode token</div>
    <div class="fig-plot-sub">Lower is better; labels give the mixed-batch cost as a multiple of the decode-only cost</div>
    {{< plotly height="300" alt="Horizontal bars of GPU time per decode token, decode-only batches against mixed batches, for Llama-3.1-8B on A100. Whole iteration: 65.6 against 156.6 µs (2.4 times); Attention: 29.2 against 116.6 µs (4.0 times); GEMM: 32.0 against 35.7 µs (1.1 times); Other: 4.4 against 4.3 µs (1.0 times)." >}}
    {
      "unit": "µs",
      "decimals": 1,
      "xname": "Component",
      "data": [
        {"type": "bar", "name": "Decode-only batch", "color": "blue", "orientation": "h", "x": [65.61, 29.21, 31.96, 4.433], "y": ["Whole iteration", "Attention", "GEMM", "Other"]},
        {"type": "bar", "name": "Mixed batch", "color": "red", "orientation": "h", "x": [156.6, 116.6, 35.72, 4.291], "y": ["Whole iteration", "Attention", "GEMM", "Other"], "customdata": ["2.4×", "4.0×", "1.1×", "1.0×"], "texttemplate": "%{customdata}", "textposition": "outside", "cliponaxis": false, "outsidetextfont": {"color": "#1f2328", "size": 12}}
      ],
      "layout": {"bargap": 0.25, "bargroupgap": 0.08, "xaxis": {"title": {"text": "GPU time per decode token (µs)"}, "range": [0, 190], "tickvals": [0, 40, 80, 120, 160]}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

It wouldn't be unreasonable to stop here, since the results line up with standard expectations. However, while I was super excited about this, 2-4x is too large a difference to accept at face value. 

Decode-only batches do run with CUDA Graphs, removing launch overhead, but the gains from that are negligible. If we look closer at the profiling results, the attention kernel's name and arguments differed between mixed and decode batches. Not unexpected, due to templating, but two things stood out:
1. In Gated DeltaNet (GDN) models (like Qwen3.5-9B), exclusive decode batches use a fast path fused recurrent delta rule, rather than the chunked delta rule used for mixed batches.
2. In Grouped Query Attention (GQA) models (like Llama-3.1-8B), exclusive decode batches run with the argument `packed=true`, while mixed ones run with `packed=false`. 

Rather than each token being inherently cheaper in a decode-only batch due to less resource contention, the "interference" in both cases is largely a kernel optimization artifact involving fast paths for decode batches. This is strongly suspected but not fully explained for GDN and confirmed for GQA. 

First, the Gated DeltaNet case. 

To be brief, GDN is a linear attention architecture which compresses past tokens into a fixed-size state, similar to RNNs. In our case, what we care about is the fact that decode is a super straightforward direct state update: look at the outputted token and update our memory. Prefill could be similarly easy: look at each token sequentially and update the memory state. However, this has no parallelism and wastes a lot of GPU resources, so current attention kernels use an approach called chunking to process sections of the prompt in parallel. 

At the time of writing, vLLM routes mixed batches through the chunked kernel, where even decode sequences are padded to 64 tokens to homogenize the dimensions, creating redundant work. Decode-only batches are routed through a fast path which takes advantage of the fact that all sequences have only 1 token to process. 

Under this regime, it makes sense that each decode token is artificially more expensive in a mixed batch. It seems like an easy fix would be to separate the decode and prefill tokens and launch separate kernels, inducing slight launch overhead but removing the redundant decode work. Trying this myself yielded extremely modest benefits, and doesn't explain the results we've observed so far, so I'm currently not sure what optimizations the GDN kernel is missing. However, I find it unlikely that a decode-only batch is inherently more efficient than a mixed batch in terms of `sec per decode token`. 

Second, let's look at GQA. 

In a "standard" transformer, each attention head computes its own K and V, creating a large memory footprint. In the GQA architecture, we have multiple attention heads share a smaller number of "KV heads". You're now probably thinking this reduced memory footprint should mean less memory to read on each forward pass, and you're correct! GQA's attention kernel can be optimized to read each KV head from HBM only once for the attention heads which share it, storing it in shared memory. 

This is referred to as "packing", and can be done regardless of whether a batch is mixed or exclusive. 

But, in the mixed batch path, FA2 does not perform this optimization, leading to the observed 4x slowdown on Llama-3.1-8B, in terms of attention cost per decode token. This should make sense since decode is generally memory-bound, and Llama-3.1-8B has 32 attention heads and 8 KV heads, leading to 4x reduced memory traffic. FA3 and FA4 both address that very issue and perform packing in both mixed and exclusive batches. 

This artifact is consistent with the profiling results of several published papers, which observe strained memory bandwidth during mixed batches. They generally brush this off as being caused by added prefill tokens, but redundantly loading KV heads would exacerbate this observation. Coincidentally, their configurations use a GQA model on an Ampere GPU, where vLLM defaults to FA2. Also, in papers that test it, the contention effects mostly disappear on a Hopper GPU, where FA3 is the default... hmm...

Anyway, some more measurements and access to an H200 confirmed that a majority of the "interference" in mixed batches was due to the underoptimized FA2 attention kernel, tested by benchmarking the same workload on H200 with FA2 and FA3 (Fig. 6). 

{{< diagram size="wide" caption="Figure 6: Burstiness improves TPOT using flash attention 2, but the trend reverses with flash attention 3 on the same hardware and workload." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--blue"></i>FlashAttention 2</span>
  <span><i class="fig-key fig-key--red"></i>FlashAttention 3</span>
  <span><i class="fig-key fig-key--box" style="--c: rgba(107, 114, 128, 0.2)"></i>Bands: ±1 standard deviation</span>
</div>
<div class="fig-plots fig-plots--3">
  <figure class="fig-plot">
    <div class="fig-plot-title">Mean TPOT</div>
    <div class="fig-plot-sub">Time per output token (ms); lower is better</div>
    {{< plotly height="230" alt="Mean TPOT against arrival CV on H200 with Llama-3.1-8B: FlashAttention 2 13.8 ms at CV 1, 12.5 ms at CV 1.41 and 11.9 ms at CV 3.16; FlashAttention 3 8.7 ms at CV 1, 8.9 ms at CV 1.41 and 9.8 ms at CV 3.16. Shaded bands show ±1 standard deviation across runs." >}}
    {
      "unit": "ms",
      "decimals": 1,
      "xname": "Arrival CV",
      "data": [
        {"type": "scatter", "name": "FlashAttention 2", "legendgroup": "FlashAttention 2", "showlegend": false, "color": "blue", "mode": "lines", "x": [1, 1.41, 3.16], "y": [12.27, 11.22, 10.27], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "FlashAttention 2", "legendgroup": "FlashAttention 2", "showlegend": false, "color": "blue", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [15.37, 13.69, 13.45], "table": false},
        {"type": "scatter", "name": "FlashAttention 2", "legendgroup": "FlashAttention 2", "color": "blue", "x": [1, 1.41, 3.16], "y": [13.82, 12.46, 11.86], "text": ["13.8 ± 1.5", "12.5 ± 1.2", "11.9 ± 1.6"], "hovertemplate": "%{fullData.name}: %{text} ms<extra></extra>"},
        {"type": "scatter", "name": "FlashAttention 3", "legendgroup": "FlashAttention 3", "showlegend": false, "color": "red", "mode": "lines", "x": [1, 1.41, 3.16], "y": [8.647, 8.664, 9.217], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "FlashAttention 3", "legendgroup": "FlashAttention 3", "showlegend": false, "color": "red", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [8.774, 9.084, 10.4], "table": false},
        {"type": "scatter", "name": "FlashAttention 3", "legendgroup": "FlashAttention 3", "color": "red", "x": [1, 1.41, 3.16], "y": [8.711, 8.874, 9.811], "text": ["8.7 ± 0.1", "8.9 ± 0.2", "9.8 ± 0.6"], "hovertemplate": "%{fullData.name}: %{text} ms<extra></extra>"}
      ],
      "layout": {"hoverdistance": -1, "xaxis": {"title": {"text": "Arrival CV (more bursty →)"}, "range": [0.82, 3.34], "tickvals": [1, 1.41, 3.16], "ticktext": ["1", "1.41", "3.16"], "unifiedhovertitle": {"text": "CV = %{x}"}}, "yaxis": {"range": [8, 16], "dtick": 2}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Median TPOT</div>
    <div class="fig-plot-sub">Time per output token (ms); lower is better</div>
    {{< plotly height="230" alt="Median TPOT against arrival CV on H200 with Llama-3.1-8B: FlashAttention 2 13.6 ms at CV 1, 12.6 ms at CV 1.41 and 11.7 ms at CV 3.16; FlashAttention 3 8.8 ms at CV 1, 9.0 ms at CV 1.41 and 9.8 ms at CV 3.16. Shaded bands show ±1 standard deviation across runs." >}}
    {
      "unit": "ms",
      "decimals": 1,
      "xname": "Arrival CV",
      "data": [
        {"type": "scatter", "name": "FlashAttention 2", "legendgroup": "FlashAttention 2", "showlegend": false, "color": "blue", "mode": "lines", "x": [1, 1.41, 3.16], "y": [12.17, 11.62, 10.04], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "FlashAttention 2", "legendgroup": "FlashAttention 2", "showlegend": false, "color": "blue", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [15.04, 13.52, 13.39], "table": false},
        {"type": "scatter", "name": "FlashAttention 2", "legendgroup": "FlashAttention 2", "color": "blue", "x": [1, 1.41, 3.16], "y": [13.61, 12.57, 11.72], "text": ["13.6 ± 1.4", "12.6 ± 1.0", "11.7 ± 1.7"], "hovertemplate": "%{fullData.name}: %{text} ms<extra></extra>"},
        {"type": "scatter", "name": "FlashAttention 3", "legendgroup": "FlashAttention 3", "showlegend": false, "color": "red", "mode": "lines", "x": [1, 1.41, 3.16], "y": [8.667, 8.725, 8.992], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "FlashAttention 3", "legendgroup": "FlashAttention 3", "showlegend": false, "color": "red", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [8.864, 9.18, 10.59], "table": false},
        {"type": "scatter", "name": "FlashAttention 3", "legendgroup": "FlashAttention 3", "color": "red", "x": [1, 1.41, 3.16], "y": [8.766, 8.952, 9.792], "text": ["8.8 ± 0.1", "9.0 ± 0.2", "9.8 ± 0.8"], "hovertemplate": "%{fullData.name}: %{text} ms<extra></extra>"}
      ],
      "layout": {"hoverdistance": -1, "xaxis": {"title": {"text": "Arrival CV (more bursty →)"}, "range": [0.82, 3.34], "tickvals": [1, 1.41, 3.16], "ticktext": ["1", "1.41", "3.16"], "unifiedhovertitle": {"text": "CV = %{x}"}}, "yaxis": {"range": [8, 16], "dtick": 2}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">p90 TPOT</div>
    <div class="fig-plot-sub">Time per output token (ms); lower is better</div>
    {{< plotly height="230" alt="p90 TPOT against arrival CV on H200 with Llama-3.1-8B: FlashAttention 2 17.5 ms at CV 1, 15.5 ms at CV 1.41 and 16.2 ms at CV 3.16; FlashAttention 3 9.5 ms at CV 1, 10.1 ms at CV 1.41 and 12.6 ms at CV 3.16. Shaded bands show ±1 standard deviation across runs." >}}
    {
      "unit": "ms",
      "decimals": 1,
      "xname": "Arrival CV",
      "data": [
        {"type": "scatter", "name": "FlashAttention 2", "legendgroup": "FlashAttention 2", "showlegend": false, "color": "blue", "mode": "lines", "x": [1, 1.41, 3.16], "y": [14.38, 12.79, 12.41], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "FlashAttention 2", "legendgroup": "FlashAttention 2", "showlegend": false, "color": "blue", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [20.55, 18.29, 20.08], "table": false},
        {"type": "scatter", "name": "FlashAttention 2", "legendgroup": "FlashAttention 2", "color": "blue", "x": [1, 1.41, 3.16], "y": [17.47, 15.54, 16.25], "text": ["17.5 ± 3.1", "15.5 ± 2.8", "16.2 ± 3.8"], "hovertemplate": "%{fullData.name}: %{text} ms<extra></extra>"},
        {"type": "scatter", "name": "FlashAttention 3", "legendgroup": "FlashAttention 3", "showlegend": false, "color": "red", "mode": "lines", "x": [1, 1.41, 3.16], "y": [9.254, 9.422, 10.92], "line": {"width": 0}, "hoverinfo": "skip", "hovertemplate": null, "table": false},
        {"type": "scatter", "name": "FlashAttention 3", "legendgroup": "FlashAttention 3", "showlegend": false, "color": "red", "fill": "tonexty", "x": [1, 1.41, 3.16], "y": [9.826, 10.78, 14.18], "table": false},
        {"type": "scatter", "name": "FlashAttention 3", "legendgroup": "FlashAttention 3", "color": "red", "x": [1, 1.41, 3.16], "y": [9.54, 10.1, 12.55], "text": ["9.5 ± 0.3", "10.1 ± 0.7", "12.6 ± 1.6"], "hovertemplate": "%{fullData.name}: %{text} ms<extra></extra>"}
      ],
      "layout": {"hoverdistance": -1, "xaxis": {"title": {"text": "Arrival CV (more bursty →)"}, "range": [0.82, 3.34], "tickvals": [1, 1.41, 3.16], "ticktext": ["1", "1.41", "3.16"], "unifiedhovertitle": {"text": "CV = %{x}"}}, "yaxis": {"range": [5, 25], "dtick": 5}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

When using FA3, higher burstiness still increased the fraction of exclusive decode iterations, but this had a minimal effect on TPOT. Any gains were outweighed by the TTFT penalties incurred from higher burstiness, worsening E2EL. 
## When does burstiness actually help?

When the difference in efficiency between exclusive and mixed batches is high, burstiness can produce significant improvements in TPOT and end-to-end latency. Some regimes where this holds are GQA models when using FA2, as well as linear attention models.

From an engineering standpoint, these results have implications for how one performs routing and load balancing in these situations. For example, we showed that "sticky" round robin and JSQ strongly outperform the standard versions (appendix). It's possible that other policies would benefit.

It also implies that when doing LLM inference-related benchmarking, the hardware and attention backend have effects beyond how fast your baseline is. In the beginning, I happily glossed over the fact that kernel versions, model architectures, and GPU generations can change runtime behavior. Though I did experiment with different models and as many GPUs as I could get my hands on, these runs happened to be correlated. Treating "model" and "hardware" each as a single variable isn't uncommon, but that choice bakes in a bunch of assumptions you might need to account for later. 

TL;DR, it turns out your model x GPU sweep might not be as robust as you thought.

To summarize, this fun investigation doubled as a lesson in measurement discipline. Throughout, I was advised by Prof. Yang and Alex to question every finding until I could fully explain it. Without that practice, we might have published interesting but ungeneralizable results, overclaiming their importance for LLM serving. Instead, I'll be better at verifying and interpreting my measurements in future projects. 

While bursty arrivals are justifiably scary, the work here shows that under the correct conditions, they can be used to improve performance. When decode-only batches are much more efficient than mixed ones, burstiness can be leveraged to improve TPOT and thus E2EL. 

*Thanks to Prof. Juncheng Yang and Alex Su for working with me, and for proofreading this post. Any comments can be sent to avdg \[at\] cmu \[dot\] edu.*
## Appendix

**To view the full data and reproduce the experiments**, see https://github.com/Ak33ra/burstiness-perf-repro. 

**A note on "burstiness":** in this blog, "burstiness" is taken to mean the coefficient of variation (CV) of the interarrival time distribution. It controls how variable the time between request arrivals is, where higher values mean more bursty. In the vLLM benchmarking CLI, interarrival time is sampled from a gamma distribution, and "burstiness" is a parameter which shapes that distribution, setting $\rm{CV} = 1/\sqrt{\text{burstiness}}$. When burstiness = 1.0 (CV = 1.0), traffic follows a Poisson process. At burstiness = 0.1 (CV = 3.16), traffic is highly bursty. The important thing to note is that when using the vLLM bench CLI, lower "burstiness" is actually higher variance, opposite of the intuitive meaning.

**Summary of configs/methods:**
- Datasets
	- Seeded random content w/ fixed input and output lengths
	- BurstGPT
	- ShareGPT
- Hardware
	- GH200
	- A100 (40GB, sxm4)
	- 1xH200 and 2xH200
- Models (all available on HuggingFace)
	- Qwen3.5-9B
	- Llama-3-70B
	- Llama-3.1-8B
	- Llama-3.2-1B
	- GLM-4.7-Flash
- Engines
	- forked vLLM, with and without the following:
		- CUDA Graphs
		- Chunked prefill
- Various mean arrival rates, commonly 20-40 req/s, targeting medium load.
- Various burstiness parameters, mainly 1.0, 0.5, and 0.1.
- 1000 requests for benchmarking, 250 requests for nsys/torch profiling. Profiled runs were not used for performance reports, due to observable overhead. 

**"Sticky" router:** To see whether we could leverage burstier arrivals to improve latency via routing decisions, I implemented a toy router which dispatches requests to real data-parallel vLLM backends. The code is available at https://github.com/Ak33ra/variance-router. 

The idea behind the "sticky" policies is to shape arrivals such that each node sees bursts. Given a base policy like round robin, we can make it sticky with the following adaptation:
- Up to $r$ requests which arrive within $t$ seconds of the previous request are routed to the same instance. Otherwise, the request is routed according to the base policy. 

We compared round robin (RR) and join-shortest-queue (JSQ) to their "sticky" variants, finding that the sticky policy had faster TPOT across the whole distribution, though it did inflate TTFT (Fig. A2 and A3).

**Figures:**

{{< diagram size="wide" caption="Figure A1: OLS fitting of iteration time vs prefill and decode token count. Each decode token is roughly 12x more expensive than each prefill token. gpu_forward_ms = 0.027829 * p_tokens + 0.340659 * d_tokens - 24.379055, with R-squared: 0.8462." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box" style="--c: #9d93ec; border-radius: 50%; width: 0.6rem; height: 0.6rem"></i>Low burstiness (CV = 1.0)</span>
  <span><i class="fig-key fig-key--box" style="--c: #33248a; border-radius: 50%; width: 0.6rem; height: 0.6rem"></i>High burstiness (CV = 3.16)</span>
  <span><i class="fig-key fig-key--dash" style="--c: #6b7280"></i>Fit: observed = predicted</span>
</div>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Observed versus predicted</div>
    <div class="fig-plot-sub">Fit: 0.0278 ms × prefill tokens + 0.341 ms × decode tokens − 24.4 ms; R² = 0.846</div>
    {{< plotly height="320" alt="Scatter of observed against predicted GPU-forward time for 1,289 mixed iterations, 793 at low burstiness and 496 at high burstiness, with the line where observed equals predicted. Up to about 300 ms the points follow the line closely; 49 low-burstiness iterations sit well above it, observed up to 687 ms where about 383 ms is predicted." >}}
    {
      "unit": "ms",
      "table": false,
      "data": [
        {"type": "scatter", "name": "Low burstiness (CV = 1.0)", "color": "#9d93ec", "mode": "markers", "x": [165.5, 39.4, -7.0, 121.3, 19.5, -0.7, -8.7, -11.0, -2.2, -11.7, 9.6, 111.6, 35.2, -7.6, 6.1, -0.7, -6.5, 0.1, 92.6, 84.1, 71.0, 31.4, 34.6, 31.7, 25.1, 220.5, 96.5, 37.6, -3.2, 2.3, 7.4, 11.0, -4.3, 54.0, 6.5, 41.3, 4.7, 15.1, 8.6, 76.1, 7.3, 23.9, -1.6, 22.2, -1.5, 7.5, 0.2, 9.8, 16.4, 40.2, 6.2, 11.1, 31.6, 70.8, 20.8, 3.7, 8.3, 23.2, 2.4, 3.5, 20.6, 5.6, 14.9, 60.1, 17.4, 16.1, 24.2, 15.7, 36.8, 7.1, 15.8, 10.2, 6.1, 15.1, 183.2, 26.5, 56.2, 52.9, 32.8, 25.7, 24.2, 15.2, 36.1, 99.5, 17.6, 82.8, 80.7, 30.9, 15.7, 18.3, 32.0, 174.4, 42.9, 193.9, 70.4, 54.7, 30.1, 76.7, 54.1, 88.4, 29.1, 122.7, 61.9, 30.8, 34.0, 29.5, 28.6, 29.3, 21.6, 37.2, 18.7, 22.1, 57.8, 41.8, 139.9, 41.1, 52.3, 54.8, 52.6, 99.5, 45.7, 22.4, 54.7, 96.9, 66.6, 92.8, 38.7, 69.8, 28.0, 40.3, 41.3, 31.9, 68.0, 37.3, 56.1, 31.6, 51.9, 29.8, 28.6, 31.0, 27.7, 175.9, 55.7, 77.4, 31.1, 113.7, 35.9, 72.1, 77.6, 59.7, 83.7, 73.7, 57.6, 53.2, 49.8, 42.2, 35.1, 61.8, 125.3, 66.8, 79.7, 86.0, 42.7, 46.3, 73.9, 65.1, 94.2, 61.4, 39.7, 105.4, 92.9, 54.3, 94.9, 64.7, 66.5, 59.7, 65.2, 40.8, 51.2, 65.9, 90.2, 65.2, 101.0, 45.6, 138.4, 94.9, 87.7, 90.6, 82.2, 46.3, 66.7, 70.6, 55.7, 88.5, 89.9, 56.4, 60.5, 59.6, 56.9, 74.6, 67.9, 60.5, 52.9, 152.3, 128.4, 103.6, 60.4, 114.6, 56.6, 61.9, 102.8, 83.5, 77.8, 64.4, 145.9, 99.4, 83.6, 81.9, 80.8, 75.3, 86.9, 131.5, 141.5, 151.4, 119.7, 75.7, 83.1, 83.8, 74.6, 72.6, 123.2, 64.5, 74.2, 81.5, 120.6, 70.5, 75.2, 113.3, 74.3, 89.2, 142.6, 116.2, 121.5, 68.3, 86.1, 79.5, 104.9, 113.2, 169.0, 125.7, 106.3, 177.2, 99.9, 114.8, 105.3, 88.9, 141.2, 90.9, 121.3, 89.6, 114.2, 126.6, 216.3, 111.7, 88.1, 105.1, 104.2, 93.4, 84.9, 85.6, 150.9, 79.0, 79.8, 86.0, 155.9, 102.2, 97.4, 137.2, 147.1, 297.5, 183.3, 300.6, 137.7, 117.5, 184.5, 122.0, 116.8, 138.0, 183.2, 270.6, 308.4, 246.9, 283.5, 246.8, 109.6, 223.4, 121.5, 100.9, 177.8, 123.6, 117.8, 159.3, 159.3, 128.1, 147.7, 128.2, 187.3, 157.0, 104.7, 168.4, 143.1, 165.2, 105.8, 165.5, 118.5, 169.3, 181.4, 151.3, 138.7, 124.5, 183.4, 187.1, 130.7, 197.3, 135.8, 117.1, 171.2, 114.4, 163.0, 124.0, 180.1, 157.6, 196.1, 156.6, 135.5, 143.3, 126.9, 136.2, 178.5, 143.3, 212.7, 201.7, 131.7, 140.2, 161.8, 175.3, 194.3, 295.6, 170.2, 209.0, 182.4, 239.3, 277.1, 154.0, 150.3, 152.5, 311.2, 187.2, 311.1, 183.2, 179.1, 190.5, 146.6, 220.2, 178.9, 182.4, 145.6, 181.9, 182.5, 186.4, 352.2, 258.3, 233.6, 356.3, 340.3, 227.4, 361.3, 242.0, 295.8, 328.9, 369.4, 302.3, 238.4, 350.1, 236.3, 378.2, 373.3, 316.0, 269.5, 376.0, 327.6, 391.6, 394.7, 397.2, 399.4, 372.7, 323.3, 294.4, 203.9, 209.2, 197.3, 91.1, 4.0, 220.5, 86.5, 69.4, 17.3, 13.7, 49.7, 81.5, 126.1, 1.8, 18.2, 63.2, 6.4, 94.3, 22.8, 6.9, 14.9, 23.8, 13.7, 10.3, 23.3, 45.4, 32.2, 12.2, 8.2, 26.0, 7.1, 38.1, 9.4, 100.9, 16.2, 42.3, 14.3, 17.5, 44.1, 22.5, 17.0, 41.1, 48.4, 6.6, 19.5, 16.6, 8.5, 18.0, 49.5, 8.1, 13.5, 10.6, 9.7, 10.3, 18.0, 36.7, 16.1, 21.9, 27.0, 234.3, 13.4, 68.9, 30.6, 42.3, 30.8, 42.8, 26.4, 33.9, 59.4, 16.5, 201.8, 26.6, 65.9, 30.3, 36.7, 107.4, 22.1, 26.7, 36.8, 16.6, 17.6, 97.9, 105.5, 65.3, 22.0, 19.3, 22.6, 58.3, 83.5, 62.1, 49.4, 102.6, 31.7, 111.5, 116.2, 37.9, 38.0, 78.7, 52.3, 33.0, 31.9, 27.9, 58.7, 112.1, 49.5, 40.0, 103.6, 25.7, 38.3, 37.1, 26.8, 50.3, 53.6, 36.1, 33.9, 44.6, 108.4, 27.8, 35.4, 43.4, 82.4, 52.9, 36.7, 53.1, 67.6, 40.5, 40.2, 31.4, 30.5, 101.1, 61.1, 61.4, 96.2, 46.7, 71.4, 49.7, 102.2, 64.5, 51.0, 94.6, 86.9, 47.2, 51.7, 98.6, 57.1, 52.2, 56.1, 58.4, 40.4, 37.9, 54.3, 55.7, 64.4, 83.7, 76.0, 94.7, 65.2, 44.5, 50.1, 43.6, 47.5, 43.2, 74.5, 132.1, 56.6, 81.8, 73.5, 48.8, 191.1, 123.8, 248.3, 60.1, 78.5, 50.7, 98.1, 52.7, 63.3, 62.8, 48.6, 79.0, 73.4, 89.7, 61.8, 61.1, 98.3, 93.1, 77.9, 95.1, 52.3, 56.5, 52.8, 84.0, 106.7, 71.5, 242.9, 177.3, 84.8, 273.7, 183.6, 105.8, 174.5, 157.5, 72.5, 89.2, 94.4, 66.2, 71.5, 80.5, 72.0, 85.6, 93.5, 87.2, 78.4, 65.8, 74.7, 89.9, 82.8, 156.2, 211.3, 142.7, 86.7, 81.3, 137.0, 123.0, 108.9, 73.0, 72.0, 74.0, 89.0, 98.9, 79.0, 111.4, 135.0, 198.8, 194.8, 157.5, 153.4, 126.6, 152.1, 237.0, 106.9, 181.1, 258.1, 135.7, 101.6, 161.6, 144.3, 97.5, 109.9, 99.0, 89.4, 131.7, 100.0, 123.4, 132.6, 99.4, 137.1, 117.9, 100.0, 106.9, 100.4, 107.8, 94.5, 128.6, 88.3, 196.2, 147.6, 182.3, 183.2, 206.5, 122.0, 128.1, 117.4, 112.9, 144.6, 115.1, 170.9, 143.8, 155.7, 120.3, 195.3, 151.0, 133.4, 119.0, 147.8, 150.7, 101.9, 107.0, 221.1, 168.7, 226.3, 177.7, 132.4, 151.1, 144.1, 150.4, 181.6, 178.8, 216.0, 117.9, 112.4, 170.3, 107.7, 148.2, 113.3, 133.3, 137.6, 114.2, 119.5, 140.2, 116.0, 140.8, 120.8, 139.0, 130.0, 126.5, 155.7, 164.5, 160.5, 136.8, 123.0, 117.0, 142.2, 154.7, 139.2, 176.8, 134.4, 239.1, 153.3, 200.7, 140.4, 126.1, 142.3, 134.4, 155.6, 184.4, 215.9, 197.8, 133.6, 125.9, 163.1, 184.2, 155.9, 132.5, 201.5, 129.0, 137.6, 168.4, 159.0, 177.5, 165.9, 157.7, 142.9, 160.1, 171.2, 255.4, 217.8, 345.6, 346.2, 347.8, 264.7, 200.1, 189.1, 167.4, 151.4, 173.2, 163.6, 172.6, 226.5, 216.0, 173.4, 260.0, 198.6, 239.5, 235.1, 255.7, 329.7, 364.1, 327.6, 282.6, 369.4, 370.3, 326.1, 322.8, 377.5, 380.0, 382.5, 385.4, 387.2, 388.5, 391.0, 392.5, 395.4, 397.2, 227.6], "y": [165.3, 58.8, 30.0, 122.9, 54.4, 54.7, 25.8, 29.3, 30.9, 29.1, 46.7, 115.1, 55.2, 24.9, 50.1, 29.4, 29.0, 26.8, 97.2, 95.9, 78.4, 51.0, 51.4, 55.0, 52.7, 210.0, 113.1, 54.0, 20.3, 25.1, 29.9, 48.6, 29.5, 66.6, 27.5, 55.1, 25.9, 48.9, 25.4, 83.5, 27.9, 54.0, 29.3, 48.0, 24.3, 25.3, 29.3, 26.0, 47.3, 50.8, 29.3, 29.3, 46.6, 77.9, 38.1, 24.5, 25.5, 47.9, 24.1, 24.6, 52.0, 24.7, 52.1, 67.5, 54.4, 50.4, 52.2, 30.3, 51.8, 29.2, 30.5, 31.0, 29.9, 29.7, 175.9, 42.7, 66.4, 63.4, 51.9, 50.7, 51.0, 30.4, 50.5, 99.9, 33.4, 85.3, 86.4, 44.5, 29.6, 31.1, 50.5, 167.7, 55.8, 185.4, 78.9, 63.5, 41.7, 79.9, 62.4, 92.4, 49.3, 117.6, 69.4, 48.8, 50.6, 44.7, 50.5, 51.1, 33.2, 50.8, 31.8, 33.0, 61.3, 50.0, 133.1, 51.9, 59.8, 60.3, 59.2, 100.1, 56.1, 34.6, 59.6, 97.3, 74.1, 92.9, 49.3, 71.7, 38.5, 47.5, 51.0, 40.9, 69.3, 46.0, 60.0, 40.2, 56.4, 39.1, 37.7, 39.2, 37.4, 162.6, 64.1, 77.5, 41.6, 109.9, 46.3, 72.5, 78.1, 63.9, 80.8, 74.4, 61.2, 57.5, 54.0, 48.7, 42.1, 62.5, 115.9, 70.3, 78.5, 85.2, 48.7, 50.7, 73.0, 67.2, 90.9, 63.2, 45.6, 98.6, 91.7, 57.6, 88.6, 66.2, 66.1, 60.3, 64.2, 46.3, 54.7, 64.9, 85.0, 66.0, 94.5, 49.6, 123.7, 90.2, 82.6, 85.5, 77.6, 49.2, 63.1, 69.4, 55.5, 81.2, 83.8, 56.8, 61.1, 58.4, 55.7, 69.8, 64.6, 58.9, 56.0, 137.0, 117.9, 95.9, 59.5, 102.4, 57.1, 59.4, 93.2, 77.9, 72.6, 61.2, 128.6, 93.0, 77.0, 75.0, 73.1, 69.0, 77.5, 116.9, 127.5, 133.2, 107.1, 70.6, 74.1, 76.2, 67.6, 66.1, 107.1, 60.9, 65.9, 72.3, 105.4, 65.5, 66.5, 98.3, 68.5, 77.7, 121.6, 102.6, 106.9, 63.6, 74.9, 72.4, 91.3, 98.7, 146.6, 111.8, 93.3, 153.3, 89.4, 98.9, 91.6, 77.7, 120.1, 80.8, 104.3, 78.6, 96.9, 108.7, 183.2, 98.3, 76.4, 90.8, 91.3, 80.3, 72.9, 74.7, 127.8, 70.9, 70.0, 76.8, 132.4, 88.1, 82.8, 114.5, 124.3, 254.5, 160.3, 260.8, 118.6, 99.4, 152.6, 103.0, 95.8, 112.9, 151.2, 227.8, 267.4, 208.0, 238.8, 208.2, 92.5, 183.0, 100.6, 81.3, 141.8, 101.1, 94.0, 127.5, 128.0, 104.9, 117.2, 103.0, 151.3, 127.7, 85.0, 136.8, 115.8, 133.1, 86.7, 134.4, 95.9, 134.9, 146.3, 123.3, 110.9, 98.8, 146.5, 150.8, 105.1, 159.3, 109.7, 94.1, 139.5, 91.3, 128.8, 98.9, 142.5, 126.2, 154.8, 124.7, 106.5, 113.4, 99.6, 106.2, 141.4, 113.9, 169.1, 161.4, 103.5, 107.1, 127.0, 135.9, 153.6, 238.2, 136.2, 164.9, 142.9, 189.7, 224.7, 121.5, 115.6, 116.4, 247.8, 148.2, 251.8, 145.4, 138.1, 145.8, 112.1, 169.7, 136.7, 142.1, 109.9, 137.9, 140.2, 144.3, 287.6, 205.2, 383.0, 493.9, 482.5, 559.5, 435.9, 337.9, 379.3, 566.7, 450.1, 395.1, 341.1, 523.7, 341.3, 462.3, 460.5, 449.5, 376.5, 469.0, 573.4, 490.0, 489.8, 594.9, 497.5, 476.2, 481.8, 411.5, 193.1, 204.6, 191.9, 100.5, 30.1, 211.2, 101.9, 83.9, 57.3, 57.8, 61.9, 89.1, 129.2, 23.2, 54.7, 72.3, 30.0, 97.0, 39.9, 25.3, 30.1, 50.0, 30.1, 25.9, 49.5, 57.8, 54.6, 29.9, 29.4, 55.4, 24.5, 57.6, 28.8, 103.0, 33.1, 56.2, 29.6, 50.3, 55.5, 54.8, 57.6, 57.1, 58.6, 29.5, 53.9, 30.4, 25.7, 31.0, 58.2, 26.7, 28.1, 26.5, 26.2, 26.4, 32.0, 55.7, 30.6, 48.7, 53.7, 219.2, 31.5, 75.2, 51.8, 55.8, 54.8, 54.2, 56.5, 53.9, 63.3, 30.4, 190.0, 42.0, 72.5, 43.6, 56.4, 100.6, 36.7, 37.5, 47.6, 31.0, 31.4, 91.1, 106.2, 71.8, 35.7, 32.4, 33.9, 62.5, 84.8, 67.6, 57.1, 101.9, 43.1, 108.0, 115.0, 48.3, 46.1, 79.0, 57.4, 42.2, 41.2, 37.6, 62.3, 110.5, 57.6, 91.6, 96.6, 36.9, 50.3, 59.2, 36.9, 55.8, 59.8, 56.7, 41.5, 52.4, 102.2, 39.6, 43.2, 48.7, 82.8, 59.8, 44.2, 56.6, 68.9, 49.8, 50.2, 40.0, 39.3, 92.8, 66.9, 64.1, 92.7, 52.9, 71.4, 54.7, 97.7, 67.7, 55.2, 89.9, 85.5, 51.9, 56.4, 93.4, 61.0, 55.2, 57.5, 59.7, 45.2, 44.9, 55.3, 57.8, 65.1, 80.8, 74.7, 91.6, 66.6, 50.3, 55.0, 48.7, 55.3, 46.6, 72.3, 123.1, 59.6, 77.6, 72.0, 51.5, 176.5, 117.8, 220.7, 64.8, 73.9, 54.2, 90.5, 55.0, 62.6, 61.2, 50.1, 73.1, 70.5, 82.3, 62.0, 59.6, 89.7, 87.1, 73.7, 86.7, 53.7, 58.2, 52.9, 79.1, 96.8, 71.6, 215.0, 156.3, 81.6, 242.4, 163.5, 98.2, 149.5, 137.8, 69.4, 79.4, 84.7, 62.1, 66.2, 71.9, 66.2, 76.2, 83.2, 78.3, 70.8, 61.7, 66.9, 79.4, 74.8, 135.7, 183.7, 125.3, 79.0, 71.6, 117.4, 107.9, 94.7, 66.9, 62.7, 67.0, 76.6, 85.9, 70.8, 94.8, 116.6, 172.0, 167.2, 136.1, 131.1, 108.1, 129.3, 200.0, 96.0, 152.7, 222.2, 118.5, 86.4, 133.6, 120.8, 84.4, 90.5, 85.7, 77.3, 107.8, 85.1, 100.6, 110.2, 83.8, 112.7, 98.6, 84.0, 87.1, 85.9, 91.2, 79.4, 105.4, 73.7, 163.8, 121.8, 151.5, 152.5, 172.4, 101.8, 104.3, 95.9, 91.5, 116.5, 93.5, 139.5, 117.4, 126.2, 97.8, 162.1, 125.3, 108.1, 96.7, 118.2, 123.0, 83.9, 84.4, 177.2, 138.0, 184.1, 147.7, 107.3, 120.9, 116.0, 119.5, 148.0, 144.9, 175.2, 95.6, 87.7, 137.6, 87.8, 116.5, 91.1, 105.0, 109.0, 92.8, 93.6, 110.6, 95.7, 111.2, 96.2, 109.0, 106.1, 99.4, 124.2, 132.0, 128.0, 110.5, 97.8, 92.8, 111.9, 122.9, 110.7, 139.2, 107.5, 193.4, 123.3, 161.4, 112.6, 99.0, 111.0, 105.9, 121.4, 145.7, 173.5, 159.1, 106.9, 97.8, 126.7, 145.9, 122.9, 102.2, 160.5, 102.4, 105.9, 130.9, 124.6, 137.8, 130.1, 122.3, 110.5, 123.3, 131.3, 202.5, 170.9, 284.5, 292.6, 289.5, 212.3, 156.9, 147.7, 128.9, 114.7, 132.8, 125.7, 131.0, 174.2, 310.5, 187.0, 348.3, 343.9, 332.5, 329.0, 348.6, 567.9, 444.8, 414.3, 374.8, 602.4, 450.1, 411.2, 480.0, 461.9, 461.1, 686.9, 475.0, 474.3, 667.2, 489.1, 490.3, 641.3, 523.2, 170.9], "marker": {"size": 6, "opacity": 0.5, "line": {"width": 0}}, "table": false, "hovertemplate": "<b>%{fullData.name}</b><br>Predicted %{x:.0f} ms, observed %{y:.0f} ms<extra></extra>"},
        {"type": "scatter", "name": "High burstiness (CV = 3.16)", "color": "#33248a", "mode": "markers", "x": [17.6, 38.1, -4.7, 44.7, -15.5, 2.7, 8.7, -8.5, -8.4, 115.0, 29.4, -4.7, -14.5, -17.2, -5.5, 4.2, 106.5, 30.1, -12.0, 1.7, -5.1, -10.9, 211.9, 129.6, 215.8, 217.0, 219.9, 222.4, 122.2, 11.3, 5.2, 22.3, 184.3, 6.1, 31.5, 191.6, 10.0, 47.2, 5.4, 48.8, 75.1, 12.8, 133.6, 102.5, 42.8, 163.5, 31.7, 182.7, 57.8, 56.3, 186.9, 111.5, 137.7, 52.8, 163.7, 56.9, 78.9, 49.7, 52.0, 73.4, 59.4, 238.0, 101.2, 84.1, 22.2, 22.1, 228.1, 223.8, 221.4, 27.2, 29.2, 131.9, 36.8, 56.9, 121.2, 45.2, 64.0, 148.2, 153.6, 34.2, 207.8, 106.9, 59.3, 86.1, 36.2, 140.5, 107.2, 255.2, 60.7, 216.6, 209.8, 182.9, 250.1, 67.3, 263.7, 207.1, 58.1, 43.0, 61.7, 261.5, 92.9, 53.1, 157.3, 139.8, 81.3, 84.8, 76.4, 218.2, 205.3, 145.6, 65.5, 63.5, 46.2, 128.0, 151.1, 43.4, 60.2, 265.2, 116.4, 66.1, 51.2, 43.0, 41.5, 50.9, 199.8, 46.3, 249.3, 165.6, 252.1, 254.3, 257.7, 259.9, 262.7, 90.4, 137.8, 264.0, 99.9, 245.5, 170.4, 66.7, 223.3, 79.3, 66.7, 114.7, 132.4, 227.4, 120.8, 67.4, 122.2, 173.9, 160.1, 199.5, 150.0, 283.4, 256.8, 91.5, 74.8, 97.8, 102.0, 212.3, 237.1, 146.3, 121.7, 84.6, 176.4, 170.7, 155.0, 110.0, 80.3, 102.6, 83.1, 212.5, 156.2, 188.4, 111.8, 171.8, 122.3, 168.2, 129.8, 92.7, 96.1, 64.8, 67.0, 121.0, 101.7, 83.0, 76.0, 92.6, 86.6, 144.9, 204.8, 144.3, 282.7, 122.4, 142.4, 235.0, 242.8, 262.8, 92.0, 271.8, 196.6, 278.4, 69.0, 218.8, 97.2, 140.0, 167.6, 143.6, 120.2, 81.2, 214.5, 96.6, 289.3, 193.7, 115.3, 72.7, 127.3, 164.4, 290.9, 133.0, 123.0, 77.8, 230.9, 102.0, 224.8, 83.0, 110.2, 88.3, 125.0, 102.7, 161.5, 86.5, 128.4, 278.9, 173.6, 188.6, 203.4, 160.3, 66.1, 137.5, 77.9, 7.8, 211.4, 126.5, 4.0, 24.4, 53.7, -12.3, -2.5, -4.0, 214.9, 80.0, 9.2, 35.7, 29.1, 42.6, 198.1, -5.5, 49.9, 136.1, 151.8, 1.4, 57.3, 147.6, 91.0, 105.1, 147.7, 230.2, 55.5, 16.4, 5.9, 23.4, 49.7, 8.4, 99.0, 23.0, 190.9, 216.6, 76.2, 106.4, 35.3, 56.8, 5.3, 8.3, 61.6, 41.9, 170.0, 108.3, 87.3, 196.8, 127.7, 200.6, 241.4, 43.0, 86.2, 35.1, 35.0, 93.9, 20.6, 47.5, 236.1, 93.2, 208.7, 107.6, 93.6, 61.1, 198.4, 64.7, 79.2, 140.1, 99.9, 36.2, 176.8, 140.3, 203.2, 42.5, 131.9, 35.1, 100.7, 35.4, 65.4, 219.9, 84.0, 37.5, 258.0, 259.9, 261.8, 202.4, 69.3, 53.0, 93.5, 185.1, 81.0, 123.0, 51.9, 74.3, 79.4, 70.2, 264.6, 175.1, 138.0, 67.3, 50.3, 105.6, 53.1, 74.5, 77.2, 99.2, 119.3, 176.7, 87.1, 72.9, 79.4, 156.2, 47.9, 81.6, 73.3, 51.1, 146.9, 41.1, 107.4, 244.3, 52.8, 93.9, 78.8, 39.3, 52.1, 96.1, 62.0, 115.8, 138.5, 125.2, 54.1, 231.0, 59.6, 46.4, 49.2, 79.7, 100.0, 53.7, 39.4, 119.4, 55.7, 179.8, 54.5, 68.4, 122.5, 144.8, 130.9, 70.1, 30.2, 79.4, 25.6, 28.6, 197.6, 43.3, 56.4, 122.0, 190.2, 72.1, 127.3, 102.2, 67.7, 102.1, 109.0, 232.9, 65.8, 123.8, 76.1, 43.5, 131.3, 102.1, 68.8, 99.1, 123.3, 133.2, 146.0, 36.4, 45.3, 81.4, 210.1, 220.5, 97.8, 198.9, 46.9, 54.4, 104.0, 46.7, 99.9, 58.6, 73.5, 102.0, 98.5, 46.0, 77.7, 264.6, 268.4, 193.0, 268.0, 270.9, 127.8, 47.6, 52.6, 91.1, 84.6, 196.9, 55.8, 60.8, 49.3, 50.5, 111.6, 73.0, 43.8, 126.6, 99.1, 58.8, 113.8, 143.2, 92.1, 100.6, 128.8, 135.5, 114.5, 39.2, 78.4, 39.4, 61.6, 257.4, 259.9, 261.8, 111.6, 65.9, 64.9, 63.6, 137.2, 43.6, 104.7, 165.5, 84.6, 225.2, 46.9, 53.6, 143.7, 150.0, 133.2, 55.9, 71.7, 146.0, 101.0, 263.0, 265.2, 267.4, 268.7, 144.0, 272.1, 169.5], "y": [60.1, 57.3, 58.0, 59.0, 29.4, 54.3, 55.4, 26.0, 29.2, 118.9, 53.9, 25.9, 25.7, 25.4, 28.9, 51.2, 111.2, 50.4, 13.7, 52.7, 25.7, 28.5, 200.5, 136.5, 214.8, 221.1, 212.5, 214.9, 125.9, 26.8, 29.7, 55.9, 168.1, 24.7, 58.2, 180.2, 26.8, 55.8, 24.0, 60.1, 79.5, 51.3, 130.1, 109.9, 57.4, 162.3, 49.4, 175.5, 65.5, 67.6, 176.2, 115.8, 136.6, 64.0, 158.2, 63.8, 84.9, 59.3, 61.7, 78.9, 67.4, 218.5, 105.6, 86.8, 35.7, 33.9, 208.3, 207.9, 203.2, 41.4, 38.9, 124.4, 53.2, 65.5, 114.4, 54.8, 67.0, 140.2, 142.0, 43.3, 186.8, 106.3, 63.7, 85.9, 44.7, 129.1, 104.6, 228.8, 67.3, 191.4, 187.0, 168.2, 226.1, 69.0, 233.4, 186.9, 62.2, 48.7, 60.9, 226.5, 91.4, 56.4, 139.7, 128.6, 80.0, 80.5, 73.2, 191.4, 185.8, 132.2, 66.2, 61.2, 50.8, 117.4, 136.7, 49.0, 62.5, 235.8, 110.0, 65.6, 55.4, 50.2, 54.4, 56.2, 181.7, 53.2, 225.7, 154.1, 229.7, 234.3, 232.4, 234.9, 240.7, 91.7, 125.5, 235.0, 97.9, 211.0, 154.9, 66.7, 195.8, 77.5, 65.5, 101.2, 117.3, 199.8, 111.5, 66.1, 107.1, 150.9, 139.4, 172.0, 132.3, 247.1, 225.3, 83.5, 66.9, 83.2, 86.9, 180.0, 204.7, 124.9, 104.7, 77.6, 153.3, 146.9, 135.7, 96.7, 75.0, 89.8, 76.0, 183.8, 138.2, 163.1, 99.2, 146.3, 108.5, 143.4, 112.1, 81.6, 84.3, 62.6, 61.0, 108.3, 91.1, 75.3, 68.6, 81.2, 79.4, 125.2, 179.1, 129.8, 246.2, 111.5, 125.5, 202.5, 215.6, 234.7, 88.0, 237.9, 175.9, 243.7, 68.2, 189.2, 90.1, 122.3, 146.8, 124.9, 106.6, 75.3, 183.4, 87.3, 247.8, 168.9, 99.9, 67.5, 110.6, 143.3, 253.3, 115.8, 106.8, 69.2, 195.6, 90.1, 190.3, 74.4, 94.1, 78.6, 109.0, 92.1, 138.7, 77.4, 113.1, 240.0, 151.2, 162.2, 174.0, 141.1, 63.0, 139.2, 93.0, 61.2, 196.2, 132.6, 52.9, 53.6, 63.4, 22.5, 25.3, 30.3, 206.4, 99.6, 53.4, 58.6, 54.3, 56.2, 194.4, 25.0, 63.2, 132.9, 148.8, 24.7, 67.0, 146.8, 99.4, 108.5, 147.6, 218.2, 69.3, 33.0, 24.3, 55.4, 56.8, 24.9, 97.3, 48.4, 183.0, 203.7, 88.3, 106.0, 49.4, 62.6, 24.1, 25.2, 67.9, 56.4, 162.8, 113.6, 91.3, 185.2, 129.2, 188.0, 224.6, 55.4, 85.5, 54.4, 53.0, 92.3, 33.8, 54.0, 215.0, 97.0, 191.2, 106.6, 91.7, 66.9, 175.7, 69.1, 78.7, 130.3, 95.9, 43.9, 167.6, 132.4, 185.9, 53.6, 120.7, 44.2, 95.1, 44.1, 66.8, 195.8, 85.5, 44.3, 228.2, 239.5, 238.2, 182.1, 70.7, 55.2, 86.5, 163.2, 79.9, 112.6, 55.2, 72.7, 75.9, 70.6, 233.2, 158.4, 123.6, 67.0, 56.5, 99.3, 58.8, 72.2, 75.4, 95.4, 111.2, 166.2, 87.4, 73.4, 76.4, 141.3, 54.9, 78.6, 72.2, 56.2, 132.7, 49.1, 105.4, 225.4, 63.1, 92.2, 80.8, 53.3, 58.5, 95.8, 68.4, 111.0, 132.1, 122.1, 60.9, 209.6, 67.6, 53.4, 56.2, 79.3, 98.4, 58.8, 53.3, 107.8, 60.7, 162.7, 60.5, 69.8, 116.1, 138.0, 125.8, 74.1, 39.5, 81.1, 38.1, 38.7, 176.4, 52.4, 61.1, 114.1, 175.2, 75.4, 120.7, 98.4, 70.8, 98.8, 107.5, 208.8, 68.5, 114.7, 75.1, 53.6, 120.7, 100.8, 72.0, 95.3, 116.4, 124.2, 138.3, 44.0, 53.2, 77.6, 187.6, 200.0, 96.2, 176.5, 51.8, 57.7, 93.7, 51.0, 90.4, 59.5, 73.0, 93.7, 93.6, 49.8, 74.4, 233.8, 247.1, 178.2, 236.6, 238.7, 117.7, 52.5, 55.0, 87.6, 82.8, 176.5, 61.5, 60.9, 51.0, 50.7, 102.9, 72.4, 49.4, 112.2, 92.6, 59.8, 102.2, 132.6, 89.1, 94.3, 118.6, 125.5, 108.7, 46.7, 74.6, 45.5, 64.9, 229.2, 235.2, 237.4, 107.3, 66.9, 66.1, 65.4, 124.2, 50.3, 95.3, 150.2, 83.3, 203.0, 52.7, 53.3, 129.9, 137.9, 123.5, 59.2, 71.2, 135.1, 97.7, 237.1, 236.7, 246.1, 239.7, 130.9, 240.1, 153.7], "marker": {"size": 6, "opacity": 0.5, "line": {"width": 0}}, "table": false, "hovertemplate": "<b>%{fullData.name}</b><br>Predicted %{x:.0f} ms, observed %{y:.0f} ms<extra></extra>"}
      ],
      "layout": {"hovermode": "closest", "hoverdistance": 12, "xaxis": {"title": {"text": "Predicted GPU-forward time (ms)"}, "range": [-20, 700], "dtick": 100, "showspikes": false}, "yaxis": {"title": {"text": "Observed GPU-forward time (ms)"}, "range": [-20, 700], "dtick": 100}, "shapes": [{"type": "line", "x0": -20, "y0": -20, "x1": 700, "y1": 700, "line": {"color": "#6b7280", "width": 1.25, "dash": "dash"}, "layer": "below"}]}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Residuals</div>
    <div class="fig-plot-sub">Observed minus predicted GPU-forward time</div>
    {{< plotly height="320" alt="Residuals, observed minus predicted, against predicted time. They drift from about +50 ms near 0 ms predicted to about −50 ms near 300 ms, a curved pattern the linear fit misses; 49 low-burstiness outliers have residuals between +75 and +332 ms." >}}
    {
      "unit": "ms",
      "table": false,
      "data": [
        {"type": "scatter", "name": "Low burstiness (CV = 1.0)", "color": "#9d93ec", "mode": "markers", "x": [165.5, 39.4, -7.0, 121.3, 19.5, -0.7, -8.7, -11.0, -2.2, -11.7, 9.6, 111.6, 35.2, -7.6, 6.1, -0.7, -6.5, 0.1, 92.6, 84.1, 71.0, 31.4, 34.6, 31.7, 25.1, 220.5, 96.5, 37.6, -3.2, 2.3, 7.4, 11.0, -4.3, 54.0, 6.5, 41.3, 4.7, 15.1, 8.6, 76.1, 7.3, 23.9, -1.6, 22.2, -1.5, 7.5, 0.2, 9.8, 16.4, 40.2, 6.2, 11.1, 31.6, 70.8, 20.8, 3.7, 8.3, 23.2, 2.4, 3.5, 20.6, 5.6, 14.9, 60.1, 17.4, 16.1, 24.2, 15.7, 36.8, 7.1, 15.8, 10.2, 6.1, 15.1, 183.2, 26.5, 56.2, 52.9, 32.8, 25.7, 24.2, 15.2, 36.1, 99.5, 17.6, 82.8, 80.7, 30.9, 15.7, 18.3, 32.0, 174.4, 42.9, 193.9, 70.4, 54.7, 30.1, 76.7, 54.1, 88.4, 29.1, 122.7, 61.9, 30.8, 34.0, 29.5, 28.6, 29.3, 21.6, 37.2, 18.7, 22.1, 57.8, 41.8, 139.9, 41.1, 52.3, 54.8, 52.6, 99.5, 45.7, 22.4, 54.7, 96.9, 66.6, 92.8, 38.7, 69.8, 28.0, 40.3, 41.3, 31.9, 68.0, 37.3, 56.1, 31.6, 51.9, 29.8, 28.6, 31.0, 27.7, 175.9, 55.7, 77.4, 31.1, 113.7, 35.9, 72.1, 77.6, 59.7, 83.7, 73.7, 57.6, 53.2, 49.8, 42.2, 35.1, 61.8, 125.3, 66.8, 79.7, 86.0, 42.7, 46.3, 73.9, 65.1, 94.2, 61.4, 39.7, 105.4, 92.9, 54.3, 94.9, 64.7, 66.5, 59.7, 65.2, 40.8, 51.2, 65.9, 90.2, 65.2, 101.0, 45.6, 138.4, 94.9, 87.7, 90.6, 82.2, 46.3, 66.7, 70.6, 55.7, 88.5, 89.9, 56.4, 60.5, 59.6, 56.9, 74.6, 67.9, 60.5, 52.9, 152.3, 128.4, 103.6, 60.4, 114.6, 56.6, 61.9, 102.8, 83.5, 77.8, 64.4, 145.9, 99.4, 83.6, 81.9, 80.8, 75.3, 86.9, 131.5, 141.5, 151.4, 119.7, 75.7, 83.1, 83.8, 74.6, 72.6, 123.2, 64.5, 74.2, 81.5, 120.6, 70.5, 75.2, 113.3, 74.3, 89.2, 142.6, 116.2, 121.5, 68.3, 86.1, 79.5, 104.9, 113.2, 169.0, 125.7, 106.3, 177.2, 99.9, 114.8, 105.3, 88.9, 141.2, 90.9, 121.3, 89.6, 114.2, 126.6, 216.3, 111.7, 88.1, 105.1, 104.2, 93.4, 84.9, 85.6, 150.9, 79.0, 79.8, 86.0, 155.9, 102.2, 97.4, 137.2, 147.1, 297.5, 183.3, 300.6, 137.7, 117.5, 184.5, 122.0, 116.8, 138.0, 183.2, 270.6, 308.4, 246.9, 283.5, 246.8, 109.6, 223.4, 121.5, 100.9, 177.8, 123.6, 117.8, 159.3, 159.3, 128.1, 147.7, 128.2, 187.3, 157.0, 104.7, 168.4, 143.1, 165.2, 105.8, 165.5, 118.5, 169.3, 181.4, 151.3, 138.7, 124.5, 183.4, 187.1, 130.7, 197.3, 135.8, 117.1, 171.2, 114.4, 163.0, 124.0, 180.1, 157.6, 196.1, 156.6, 135.5, 143.3, 126.9, 136.2, 178.5, 143.3, 212.7, 201.7, 131.7, 140.2, 161.8, 175.3, 194.3, 295.6, 170.2, 209.0, 182.4, 239.3, 277.1, 154.0, 150.3, 152.5, 311.2, 187.2, 311.1, 183.2, 179.1, 190.5, 146.6, 220.2, 178.9, 182.4, 145.6, 181.9, 182.5, 186.4, 352.2, 258.3, 233.6, 356.3, 340.3, 227.4, 361.3, 242.0, 295.8, 328.9, 369.4, 302.3, 238.4, 350.1, 236.3, 378.2, 373.3, 316.0, 269.5, 376.0, 327.6, 391.6, 394.7, 397.2, 399.4, 372.7, 323.3, 294.4, 203.9, 209.2, 197.3, 91.1, 4.0, 220.5, 86.5, 69.4, 17.3, 13.7, 49.7, 81.5, 126.1, 1.8, 18.2, 63.2, 6.4, 94.3, 22.8, 6.9, 14.9, 23.8, 13.7, 10.3, 23.3, 45.4, 32.2, 12.2, 8.2, 26.0, 7.1, 38.1, 9.4, 100.9, 16.2, 42.3, 14.3, 17.5, 44.1, 22.5, 17.0, 41.1, 48.4, 6.6, 19.5, 16.6, 8.5, 18.0, 49.5, 8.1, 13.5, 10.6, 9.7, 10.3, 18.0, 36.7, 16.1, 21.9, 27.0, 234.3, 13.4, 68.9, 30.6, 42.3, 30.8, 42.8, 26.4, 33.9, 59.4, 16.5, 201.8, 26.6, 65.9, 30.3, 36.7, 107.4, 22.1, 26.7, 36.8, 16.6, 17.6, 97.9, 105.5, 65.3, 22.0, 19.3, 22.6, 58.3, 83.5, 62.1, 49.4, 102.6, 31.7, 111.5, 116.2, 37.9, 38.0, 78.7, 52.3, 33.0, 31.9, 27.9, 58.7, 112.1, 49.5, 40.0, 103.6, 25.7, 38.3, 37.1, 26.8, 50.3, 53.6, 36.1, 33.9, 44.6, 108.4, 27.8, 35.4, 43.4, 82.4, 52.9, 36.7, 53.1, 67.6, 40.5, 40.2, 31.4, 30.5, 101.1, 61.1, 61.4, 96.2, 46.7, 71.4, 49.7, 102.2, 64.5, 51.0, 94.6, 86.9, 47.2, 51.7, 98.6, 57.1, 52.2, 56.1, 58.4, 40.4, 37.9, 54.3, 55.7, 64.4, 83.7, 76.0, 94.7, 65.2, 44.5, 50.1, 43.6, 47.5, 43.2, 74.5, 132.1, 56.6, 81.8, 73.5, 48.8, 191.1, 123.8, 248.3, 60.1, 78.5, 50.7, 98.1, 52.7, 63.3, 62.8, 48.6, 79.0, 73.4, 89.7, 61.8, 61.1, 98.3, 93.1, 77.9, 95.1, 52.3, 56.5, 52.8, 84.0, 106.7, 71.5, 242.9, 177.3, 84.8, 273.7, 183.6, 105.8, 174.5, 157.5, 72.5, 89.2, 94.4, 66.2, 71.5, 80.5, 72.0, 85.6, 93.5, 87.2, 78.4, 65.8, 74.7, 89.9, 82.8, 156.2, 211.3, 142.7, 86.7, 81.3, 137.0, 123.0, 108.9, 73.0, 72.0, 74.0, 89.0, 98.9, 79.0, 111.4, 135.0, 198.8, 194.8, 157.5, 153.4, 126.6, 152.1, 237.0, 106.9, 181.1, 258.1, 135.7, 101.6, 161.6, 144.3, 97.5, 109.9, 99.0, 89.4, 131.7, 100.0, 123.4, 132.6, 99.4, 137.1, 117.9, 100.0, 106.9, 100.4, 107.8, 94.5, 128.6, 88.3, 196.2, 147.6, 182.3, 183.2, 206.5, 122.0, 128.1, 117.4, 112.9, 144.6, 115.1, 170.9, 143.8, 155.7, 120.3, 195.3, 151.0, 133.4, 119.0, 147.8, 150.7, 101.9, 107.0, 221.1, 168.7, 226.3, 177.7, 132.4, 151.1, 144.1, 150.4, 181.6, 178.8, 216.0, 117.9, 112.4, 170.3, 107.7, 148.2, 113.3, 133.3, 137.6, 114.2, 119.5, 140.2, 116.0, 140.8, 120.8, 139.0, 130.0, 126.5, 155.7, 164.5, 160.5, 136.8, 123.0, 117.0, 142.2, 154.7, 139.2, 176.8, 134.4, 239.1, 153.3, 200.7, 140.4, 126.1, 142.3, 134.4, 155.6, 184.4, 215.9, 197.8, 133.6, 125.9, 163.1, 184.2, 155.9, 132.5, 201.5, 129.0, 137.6, 168.4, 159.0, 177.5, 165.9, 157.7, 142.9, 160.1, 171.2, 255.4, 217.8, 345.6, 346.2, 347.8, 264.7, 200.1, 189.1, 167.4, 151.4, 173.2, 163.6, 172.6, 226.5, 216.0, 173.4, 260.0, 198.6, 239.5, 235.1, 255.7, 329.7, 364.1, 327.6, 282.6, 369.4, 370.3, 326.1, 322.8, 377.5, 380.0, 382.5, 385.4, 387.2, 388.5, 391.0, 392.5, 395.4, 397.2, 227.6], "y": [-0.2, 19.4, 37.0, 1.6, 34.9, 55.4, 34.5, 40.3, 33.1, 40.9, 37.0, 3.5, 20.0, 32.5, 44.0, 30.1, 35.4, 26.7, 4.6, 11.8, 7.4, 19.6, 16.8, 23.3, 27.6, -10.5, 16.6, 16.4, 23.4, 22.8, 22.5, 37.5, 33.8, 12.6, 21.0, 13.8, 21.1, 33.8, 16.8, 7.4, 20.5, 30.1, 30.8, 25.8, 25.9, 17.8, 29.1, 16.2, 30.9, 10.5, 23.1, 18.2, 15.0, 7.1, 17.3, 20.8, 17.2, 24.7, 21.7, 21.1, 31.4, 19.1, 37.2, 7.4, 37.0, 34.3, 28.1, 14.6, 15.0, 22.0, 14.7, 20.8, 23.8, 14.6, -7.3, 16.1, 10.3, 10.5, 19.0, 25.0, 26.8, 15.2, 14.4, 0.5, 15.8, 2.6, 5.6, 13.6, 13.9, 12.8, 18.5, -6.7, 12.8, -8.5, 8.5, 8.8, 11.6, 3.2, 8.3, 4.0, 20.2, -5.2, 7.5, 18.0, 16.6, 15.2, 21.9, 21.8, 11.6, 13.6, 13.1, 10.9, 3.6, 8.3, -6.7, 10.8, 7.5, 5.5, 6.6, 0.6, 10.4, 12.2, 4.9, 0.4, 7.5, 0.0, 10.5, 1.9, 10.5, 7.2, 9.7, 9.0, 1.3, 8.7, 3.8, 8.6, 4.5, 9.3, 9.1, 8.2, 9.7, -13.3, 8.4, 0.1, 10.5, -3.8, 10.4, 0.4, 0.5, 4.2, -3.0, 0.7, 3.6, 4.3, 4.2, 6.5, 7.1, 0.7, -9.4, 3.5, -1.1, -0.8, 6.0, 4.5, -0.9, 2.1, -3.4, 1.8, 5.9, -6.8, -1.3, 3.3, -6.3, 1.4, -0.4, 0.7, -1.0, 5.4, 3.5, -1.0, -5.3, 0.8, -6.6, 4.0, -14.6, -4.6, -5.0, -5.1, -4.6, 2.9, -3.7, -1.2, -0.2, -7.4, -6.1, 0.4, 0.7, -1.1, -1.2, -4.8, -3.2, -1.7, 3.1, -15.3, -10.5, -7.7, -0.9, -12.2, 0.5, -2.5, -9.5, -5.7, -5.2, -3.3, -17.3, -6.4, -6.6, -6.9, -7.7, -6.4, -9.5, -14.6, -14.1, -18.2, -12.6, -5.1, -9.1, -7.6, -7.0, -6.6, -16.1, -3.6, -8.2, -9.2, -15.2, -5.0, -8.7, -15.0, -5.8, -11.4, -21.0, -13.6, -14.6, -4.7, -11.2, -7.1, -13.6, -14.5, -22.4, -13.9, -13.0, -24.0, -10.6, -15.9, -13.6, -11.2, -21.1, -10.1, -17.1, -11.0, -17.3, -17.8, -33.2, -13.3, -11.7, -14.2, -12.9, -13.0, -12.0, -10.9, -23.1, -8.1, -9.8, -9.2, -23.5, -14.0, -14.6, -22.8, -22.8, -43.1, -23.0, -39.8, -19.1, -18.0, -31.9, -19.0, -20.9, -25.1, -32.0, -42.9, -41.0, -38.9, -44.7, -38.6, -17.1, -40.4, -20.9, -19.6, -36.0, -22.6, -23.8, -31.8, -31.3, -23.2, -30.5, -25.1, -36.0, -29.3, -19.7, -31.5, -27.3, -32.1, -19.0, -31.1, -22.7, -34.5, -35.1, -28.1, -27.8, -25.7, -36.9, -36.2, -25.7, -38.1, -26.1, -23.1, -31.7, -23.1, -34.1, -25.1, -37.7, -31.4, -41.3, -31.9, -29.0, -30.0, -27.3, -30.0, -37.1, -29.4, -43.5, -40.3, -28.2, -33.1, -34.8, -39.4, -40.7, -57.4, -34.0, -44.0, -39.5, -49.6, -52.3, -32.5, -34.7, -36.1, -63.4, -39.0, -59.3, -37.8, -41.0, -44.7, -34.5, -50.5, -42.2, -40.4, -35.8, -44.0, -42.3, -42.1, -64.6, -53.1, 149.4, 137.7, 142.1, 332.0, 74.6, 95.9, 83.5, 237.8, 80.7, 92.8, 102.7, 173.6, 105.0, 84.2, 87.1, 133.5, 107.0, 93.0, 245.9, 98.4, 95.1, 197.7, 98.1, 103.5, 158.4, 117.1, -10.8, -4.6, -5.4, 9.4, 26.1, -9.2, 15.3, 14.5, 40.0, 44.2, 12.1, 7.6, 3.1, 21.5, 36.6, 9.1, 23.6, 2.7, 17.1, 18.5, 15.2, 26.2, 16.5, 15.7, 26.2, 12.4, 22.4, 17.6, 21.2, 29.4, 17.4, 19.5, 19.4, 2.2, 16.8, 13.8, 15.3, 32.8, 11.4, 32.3, 40.6, 16.0, 10.2, 22.9, 34.4, 13.9, 17.2, 13.0, 8.8, 18.6, 14.6, 15.9, 16.5, 16.1, 14.0, 19.0, 14.6, 26.8, 26.7, -15.1, 18.1, 6.2, 21.2, 13.5, 24.0, 11.4, 30.1, 20.1, 3.8, 13.9, -11.8, 15.4, 6.6, 13.3, 19.8, -6.8, 14.5, 10.9, 10.9, 14.4, 13.8, -6.7, 0.7, 6.5, 13.8, 13.1, 11.2, 4.2, 1.3, 5.5, 7.8, -0.7, 11.3, -3.5, -1.1, 10.4, 8.1, 0.2, 5.1, 9.1, 9.3, 9.7, 3.6, -1.6, 8.1, 51.7, -7.0, 11.2, 12.0, 22.1, 10.1, 5.6, 6.1, 20.6, 7.6, 7.8, -6.2, 11.7, 7.9, 5.3, 0.4, 6.9, 7.5, 3.5, 1.3, 9.3, 10.0, 8.6, 8.8, -8.3, 5.8, 2.7, -3.5, 6.2, 0.0, 5.1, -4.6, 3.1, 4.2, -4.7, -1.4, 4.6, 4.7, -5.2, 3.9, 3.0, 1.4, 1.2, 4.8, 7.0, 1.0, 2.1, 0.7, -2.9, -1.3, -3.1, 1.3, 5.8, 4.8, 5.1, 7.8, 3.4, -2.1, -9.0, 2.9, -4.1, -1.5, 2.7, -14.6, -6.1, -27.5, 4.7, -4.6, 3.4, -7.6, 2.3, -0.7, -1.6, 1.5, -5.9, -2.9, -7.4, 0.2, -1.4, -8.6, -6.0, -4.2, -8.4, 1.4, 1.7, 0.1, -4.9, -10.0, 0.1, -27.9, -21.0, -3.2, -31.3, -20.0, -7.6, -25.1, -19.7, -3.1, -9.8, -9.7, -4.1, -5.4, -8.6, -5.8, -9.3, -10.3, -8.9, -7.5, -4.1, -7.7, -10.5, -8.0, -20.5, -27.6, -17.5, -7.7, -9.8, -19.5, -15.1, -14.1, -6.1, -9.3, -6.9, -12.4, -13.1, -8.2, -16.6, -18.5, -26.8, -27.5, -21.5, -22.3, -18.5, -22.8, -37.0, -11.0, -28.4, -35.9, -17.1, -15.3, -28.0, -23.5, -13.1, -19.3, -13.3, -12.1, -23.9, -14.9, -22.8, -22.3, -15.6, -24.4, -19.3, -15.9, -19.9, -14.5, -16.6, -15.1, -23.2, -14.6, -32.4, -25.9, -30.8, -30.7, -34.0, -20.2, -23.9, -21.5, -21.4, -28.2, -21.5, -31.4, -26.4, -29.5, -22.5, -33.2, -25.7, -25.3, -22.3, -29.6, -27.7, -17.9, -22.6, -43.9, -30.6, -42.2, -29.9, -25.1, -30.2, -28.2, -30.9, -33.6, -34.0, -40.8, -22.3, -24.7, -32.7, -19.9, -31.7, -22.2, -28.4, -28.6, -21.4, -25.9, -29.6, -20.2, -29.7, -24.6, -30.1, -23.9, -27.1, -31.5, -32.5, -32.4, -26.2, -25.2, -24.1, -30.4, -31.8, -28.6, -37.7, -26.9, -45.6, -30.0, -39.4, -27.8, -27.1, -31.3, -28.5, -34.2, -38.7, -42.3, -38.6, -26.7, -28.1, -36.4, -38.4, -32.9, -30.4, -41.0, -26.7, -31.6, -37.5, -34.4, -39.8, -35.7, -35.4, -32.5, -36.8, -39.9, -52.9, -46.9, -61.1, -53.7, -58.3, -52.4, -43.2, -41.3, -38.5, -36.7, -40.5, -38.0, -41.6, -52.3, 94.5, 13.6, 88.3, 145.4, 93.0, 93.9, 92.9, 238.2, 80.7, 86.7, 92.3, 233.0, 79.8, 85.1, 157.2, 84.3, 81.1, 304.4, 89.7, 87.1, 278.7, 98.1, 97.7, 245.9, 126.0, -56.7], "marker": {"size": 6, "opacity": 0.5, "line": {"width": 0}}, "table": false, "hovertemplate": "<b>%{fullData.name}</b><br>Predicted %{x:.0f} ms, residual %{y:.0f} ms<extra></extra>"},
        {"type": "scatter", "name": "High burstiness (CV = 3.16)", "color": "#33248a", "mode": "markers", "x": [17.6, 38.1, -4.7, 44.7, -15.5, 2.7, 8.7, -8.5, -8.4, 115.0, 29.4, -4.7, -14.5, -17.2, -5.5, 4.2, 106.5, 30.1, -12.0, 1.7, -5.1, -10.9, 211.9, 129.6, 215.8, 217.0, 219.9, 222.4, 122.2, 11.3, 5.2, 22.3, 184.3, 6.1, 31.5, 191.6, 10.0, 47.2, 5.4, 48.8, 75.1, 12.8, 133.6, 102.5, 42.8, 163.5, 31.7, 182.7, 57.8, 56.3, 186.9, 111.5, 137.7, 52.8, 163.7, 56.9, 78.9, 49.7, 52.0, 73.4, 59.4, 238.0, 101.2, 84.1, 22.2, 22.1, 228.1, 223.8, 221.4, 27.2, 29.2, 131.9, 36.8, 56.9, 121.2, 45.2, 64.0, 148.2, 153.6, 34.2, 207.8, 106.9, 59.3, 86.1, 36.2, 140.5, 107.2, 255.2, 60.7, 216.6, 209.8, 182.9, 250.1, 67.3, 263.7, 207.1, 58.1, 43.0, 61.7, 261.5, 92.9, 53.1, 157.3, 139.8, 81.3, 84.8, 76.4, 218.2, 205.3, 145.6, 65.5, 63.5, 46.2, 128.0, 151.1, 43.4, 60.2, 265.2, 116.4, 66.1, 51.2, 43.0, 41.5, 50.9, 199.8, 46.3, 249.3, 165.6, 252.1, 254.3, 257.7, 259.9, 262.7, 90.4, 137.8, 264.0, 99.9, 245.5, 170.4, 66.7, 223.3, 79.3, 66.7, 114.7, 132.4, 227.4, 120.8, 67.4, 122.2, 173.9, 160.1, 199.5, 150.0, 283.4, 256.8, 91.5, 74.8, 97.8, 102.0, 212.3, 237.1, 146.3, 121.7, 84.6, 176.4, 170.7, 155.0, 110.0, 80.3, 102.6, 83.1, 212.5, 156.2, 188.4, 111.8, 171.8, 122.3, 168.2, 129.8, 92.7, 96.1, 64.8, 67.0, 121.0, 101.7, 83.0, 76.0, 92.6, 86.6, 144.9, 204.8, 144.3, 282.7, 122.4, 142.4, 235.0, 242.8, 262.8, 92.0, 271.8, 196.6, 278.4, 69.0, 218.8, 97.2, 140.0, 167.6, 143.6, 120.2, 81.2, 214.5, 96.6, 289.3, 193.7, 115.3, 72.7, 127.3, 164.4, 290.9, 133.0, 123.0, 77.8, 230.9, 102.0, 224.8, 83.0, 110.2, 88.3, 125.0, 102.7, 161.5, 86.5, 128.4, 278.9, 173.6, 188.6, 203.4, 160.3, 66.1, 137.5, 77.9, 7.8, 211.4, 126.5, 4.0, 24.4, 53.7, -12.3, -2.5, -4.0, 214.9, 80.0, 9.2, 35.7, 29.1, 42.6, 198.1, -5.5, 49.9, 136.1, 151.8, 1.4, 57.3, 147.6, 91.0, 105.1, 147.7, 230.2, 55.5, 16.4, 5.9, 23.4, 49.7, 8.4, 99.0, 23.0, 190.9, 216.6, 76.2, 106.4, 35.3, 56.8, 5.3, 8.3, 61.6, 41.9, 170.0, 108.3, 87.3, 196.8, 127.7, 200.6, 241.4, 43.0, 86.2, 35.1, 35.0, 93.9, 20.6, 47.5, 236.1, 93.2, 208.7, 107.6, 93.6, 61.1, 198.4, 64.7, 79.2, 140.1, 99.9, 36.2, 176.8, 140.3, 203.2, 42.5, 131.9, 35.1, 100.7, 35.4, 65.4, 219.9, 84.0, 37.5, 258.0, 259.9, 261.8, 202.4, 69.3, 53.0, 93.5, 185.1, 81.0, 123.0, 51.9, 74.3, 79.4, 70.2, 264.6, 175.1, 138.0, 67.3, 50.3, 105.6, 53.1, 74.5, 77.2, 99.2, 119.3, 176.7, 87.1, 72.9, 79.4, 156.2, 47.9, 81.6, 73.3, 51.1, 146.9, 41.1, 107.4, 244.3, 52.8, 93.9, 78.8, 39.3, 52.1, 96.1, 62.0, 115.8, 138.5, 125.2, 54.1, 231.0, 59.6, 46.4, 49.2, 79.7, 100.0, 53.7, 39.4, 119.4, 55.7, 179.8, 54.5, 68.4, 122.5, 144.8, 130.9, 70.1, 30.2, 79.4, 25.6, 28.6, 197.6, 43.3, 56.4, 122.0, 190.2, 72.1, 127.3, 102.2, 67.7, 102.1, 109.0, 232.9, 65.8, 123.8, 76.1, 43.5, 131.3, 102.1, 68.8, 99.1, 123.3, 133.2, 146.0, 36.4, 45.3, 81.4, 210.1, 220.5, 97.8, 198.9, 46.9, 54.4, 104.0, 46.7, 99.9, 58.6, 73.5, 102.0, 98.5, 46.0, 77.7, 264.6, 268.4, 193.0, 268.0, 270.9, 127.8, 47.6, 52.6, 91.1, 84.6, 196.9, 55.8, 60.8, 49.3, 50.5, 111.6, 73.0, 43.8, 126.6, 99.1, 58.8, 113.8, 143.2, 92.1, 100.6, 128.8, 135.5, 114.5, 39.2, 78.4, 39.4, 61.6, 257.4, 259.9, 261.8, 111.6, 65.9, 64.9, 63.6, 137.2, 43.6, 104.7, 165.5, 84.6, 225.2, 46.9, 53.6, 143.7, 150.0, 133.2, 55.9, 71.7, 146.0, 101.0, 263.0, 265.2, 267.4, 268.7, 144.0, 272.1, 169.5], "y": [42.5, 19.2, 62.7, 14.3, 44.9, 51.7, 46.7, 34.5, 37.6, 3.9, 24.4, 30.5, 40.1, 42.6, 34.5, 47.0, 4.7, 20.3, 25.7, 51.1, 30.8, 39.4, -11.4, 6.8, -1.0, 4.0, -7.4, -7.4, 3.7, 15.6, 24.5, 33.6, -16.2, 18.6, 26.7, -11.4, 16.8, 8.6, 18.6, 11.3, 4.3, 38.5, -3.5, 7.4, 14.6, -1.3, 17.7, -7.2, 7.8, 11.3, -10.7, 4.3, -1.1, 11.1, -5.6, 6.9, 6.0, 9.6, 9.7, 5.5, 8.0, -19.5, 4.4, 2.7, 13.5, 11.8, -19.8, -15.8, -18.3, 14.2, 9.8, -7.5, 16.5, 8.7, -6.8, 9.6, 2.9, -7.9, -11.6, 9.1, -20.9, -0.6, 4.4, -0.3, 8.5, -11.4, -2.5, -26.4, 6.6, -25.2, -22.9, -14.8, -24.0, 1.7, -30.2, -20.2, 4.1, 5.7, -0.7, -35.0, -1.5, 3.3, -17.5, -11.2, -1.3, -4.3, -3.3, -26.8, -19.5, -13.4, 0.7, -2.3, 4.6, -10.6, -14.4, 5.6, 2.3, -29.4, -6.4, -0.5, 4.2, 7.2, 12.9, 5.3, -18.1, 6.9, -23.6, -11.5, -22.4, -20.0, -25.3, -25.0, -22.0, 1.3, -12.4, -29.0, -2.1, -34.5, -15.5, -0.0, -27.5, -1.8, -1.2, -13.5, -15.1, -27.5, -9.3, -1.3, -15.1, -23.1, -20.7, -27.5, -17.7, -36.3, -31.4, -8.0, -7.9, -14.6, -15.1, -32.3, -32.4, -21.4, -17.0, -7.0, -23.0, -23.8, -19.2, -13.3, -5.3, -12.8, -7.2, -28.7, -18.0, -25.3, -12.6, -25.5, -13.8, -24.7, -17.7, -11.0, -11.8, -2.1, -6.0, -12.7, -10.7, -7.7, -7.5, -11.4, -7.2, -19.7, -25.8, -14.6, -36.6, -10.9, -16.9, -32.4, -27.2, -28.1, -4.0, -33.9, -20.8, -34.6, -0.8, -29.6, -7.1, -17.8, -20.7, -18.6, -13.6, -5.9, -31.1, -9.3, -41.5, -24.8, -15.4, -5.2, -16.7, -21.1, -37.5, -17.3, -16.2, -8.6, -35.4, -12.0, -34.5, -8.6, -16.1, -9.7, -16.0, -10.6, -22.7, -9.1, -15.3, -38.9, -22.4, -26.4, -29.4, -19.2, -3.1, 1.7, 15.2, 53.3, -15.2, 6.2, 49.0, 29.2, 9.7, 34.8, 27.8, 34.3, -8.5, 19.6, 44.2, 22.9, 25.2, 13.6, -3.7, 30.5, 13.3, -3.3, -3.0, 23.3, 9.7, -0.9, 8.3, 3.4, -0.1, -11.9, 13.8, 16.6, 18.4, 32.0, 7.0, 16.5, -1.7, 25.4, -7.9, -12.9, 12.0, -0.4, 14.1, 5.8, 18.7, 16.9, 6.3, 14.5, -7.3, 5.3, 4.0, -11.7, 1.5, -12.6, -16.9, 12.4, -0.6, 19.3, 17.9, -1.6, 13.1, 6.5, -21.1, 3.8, -17.5, -1.0, -1.8, 5.8, -22.6, 4.4, -0.5, -9.8, -4.0, 7.7, -9.2, -7.9, -17.3, 11.1, -11.2, 9.2, -5.6, 8.7, 1.4, -24.2, 1.6, 6.8, -29.9, -20.4, -23.6, -20.3, 1.4, 2.2, -7.0, -21.8, -1.0, -10.4, 3.3, -1.5, -3.5, 0.4, -31.4, -16.8, -14.4, -0.3, 6.2, -6.3, 5.7, -2.4, -1.8, -3.9, -8.1, -10.6, 0.3, 0.5, -3.0, -14.9, 7.0, -3.0, -1.1, 5.1, -14.2, 8.0, -2.0, -18.9, 10.3, -1.6, 2.0, 14.0, 6.4, -0.3, 6.4, -4.8, -6.4, -3.0, 6.8, -21.4, 8.0, 7.0, 7.0, -0.5, -1.6, 5.1, 13.9, -11.6, 5.0, -17.0, 6.1, 1.4, -6.4, -6.7, -5.1, 4.0, 9.3, 1.7, 12.5, 10.1, -21.2, 9.1, 4.7, -7.8, -15.0, 3.3, -6.6, -3.8, 3.1, -3.3, -1.5, -24.1, 2.7, -9.1, -1.0, 10.1, -10.7, -1.3, 3.1, -3.8, -6.9, -9.0, -7.7, 7.7, 7.9, -3.8, -22.5, -20.5, -1.6, -22.4, 4.9, 3.4, -10.4, 4.3, -9.6, 0.9, -0.5, -8.3, -4.9, 3.8, -3.3, -30.8, -21.2, -14.8, -31.5, -32.1, -10.0, 4.9, 2.4, -3.5, -1.8, -20.4, 5.8, 0.1, 1.7, 0.2, -8.6, -0.6, 5.6, -14.5, -6.5, 0.9, -11.6, -10.6, -3.0, -6.3, -10.2, -10.0, -5.8, 7.6, -3.8, 6.1, 3.3, -28.2, -24.7, -24.3, -4.3, 1.0, 1.1, 1.8, -13.1, 6.7, -9.5, -15.3, -1.4, -22.2, 5.7, -0.3, -13.8, -12.1, -9.7, 3.3, -0.5, -10.9, -3.3, -25.9, -28.5, -21.4, -29.0, -13.1, -32.0, -15.8], "marker": {"size": 6, "opacity": 0.5, "line": {"width": 0}}, "table": false, "hovertemplate": "<b>%{fullData.name}</b><br>Predicted %{x:.0f} ms, residual %{y:.0f} ms<extra></extra>"}
      ],
      "layout": {"hovermode": "closest", "hoverdistance": 12, "xaxis": {"title": {"text": "Predicted GPU-forward time (ms)"}, "range": [-40, 420], "dtick": 100, "showspikes": false}, "yaxis": {"title": {"text": "Residual (ms)"}, "range": [-90, 360], "dtick": 50}, "shapes": [{"type": "line", "xref": "paper", "x0": 0, "x1": 1, "y0": 0, "y1": 0, "line": {"color": "#6b7280", "width": 1.25, "dash": "dash"}, "layer": "below"}]}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

Although the fit in Fig. A1 is poor, likely because it doesn't account for quadratic attention costs, the trend is still as expected. Intuitively, each decode token in a sequence also has at least as much "attention" to compute as the prefill tokens which preceded it. Note that the numbers used in previous calculations are directly from the data rather than what this model predicts. 

{{< diagram size="medium" caption="Figure A2: TPOT ECDF comparing RR and JSQ to their sticky variants. In both cases, the variant improves the whole TPOT distribution." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--dash fig-key--blue"></i>RR</span>
  <span><i class="fig-key fig-key--blue"></i>Sticky RR</span>
  <span><i class="fig-key fig-key--dash fig-key--red"></i>JSQ</span>
  <span><i class="fig-key fig-key--red"></i>Sticky JSQ</span>
</div>
<div class="fig-plots fig-plots--1">
  <figure class="fig-plot">
    <div class="fig-plot-title">TPOT by routing policy</div>
    <div class="fig-plot-sub">Left is better</div>
    {{< plotly height="300" alt="Cumulative distribution of time per output token under four routing policies. The sticky variants lie to the left of round robin (RR) and join-shortest-queue (JSQ) over the whole range. Median TPOT is 16.1 ms for sticky RR against 25.5 ms for RR, and 15.6 ms for sticky JSQ against 21.9 ms for JSQ. The 99th percentiles are 22.2, 40.0, 27.1 and 33.9 ms." >}}
    {
      "unit": "ms",
      "table": false,
      "data": [
        {"type": "scatter", "name": "RR", "color": "blue", "x": [9.738, 9.893, 9.978, 9.989, 10.1, 10.14, 10.72, 10.83, 10.88, 10.91, 10.97, 11.02, 11.05, 11.08, 11.19, 11.23, 11.3, 11.93, 12.32, 12.6, 12.73, 13.04, 13.38, 13.56, 13.77, 14.02, 14.37, 14.69, 15.01, 15.41, 15.86, 16.24, 16.66, 17.07, 17.62, 17.91, 18.21, 18.55, 18.75, 19.03, 19.47, 19.75, 20.11, 20.34, 20.67, 20.97, 21.26, 21.62, 21.94, 22.2, 22.47, 22.72, 22.89, 23.06, 23.25, 23.44, 23.65, 23.85, 24, 24.13, 24.34, 24.52, 24.67, 24.86, 25.02, 25.14, 25.34, 25.51, 25.7, 25.93, 26.15, 26.35, 26.46, 26.65, 26.95, 27.2, 27.43, 27.66, 27.92, 28.09, 28.25, 28.46, 28.73, 28.92, 29.1, 29.26, 29.41, 29.57, 29.78, 29.92, 30.13, 30.26, 30.44, 30.57, 30.78, 30.99, 31.33, 31.57, 31.83, 32.19, 32.77, 33.13, 33.35, 33.74, 34.11, 34.46, 34.88, 35.31, 35.61, 35.73, 35.87, 36.09, 36.28, 36.32, 36.38, 36.4, 36.41, 36.44, 36.61, 36.85, 37.19, 37.52, 37.72, 38.21, 38.38, 38.89, 39.38, 40.05, 40.51, 41.38], "y": [0.0, 0.001, 0.002, 0.003, 0.004, 0.005, 0.01, 0.011, 0.012, 0.013, 0.014, 0.015, 0.016, 0.017, 0.018, 0.019, 0.02, 0.025, 0.03, 0.035, 0.04, 0.05, 0.06, 0.065, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.915, 0.92, 0.93, 0.935, 0.936, 0.937, 0.938, 0.939, 0.94, 0.945, 0.95, 0.955, 0.96, 0.965, 0.97, 0.975, 0.98, 0.985, 0.99, 0.995, 1.0], "hovertemplate": "%{fullData.name}: %{x:.1f} ms<extra></extra>", "table": false, "line": {"dash": "dash"}},
        {"type": "scatter", "name": "Sticky RR", "color": "blue", "x": [0.601, 4.416, 7.495, 7.814, 7.821, 7.911, 8.528, 8.645, 8.991, 9.001, 9.038, 9.083, 9.239, 9.248, 9.286, 9.29, 9.295, 9.473, 9.554, 9.693, 9.773, 9.948, 10.14, 10.2, 10.34, 10.52, 10.73, 10.96, 11.24, 11.35, 11.48, 11.56, 11.73, 11.83, 11.93, 12.05, 12.19, 12.37, 12.56, 12.71, 12.94, 13.11, 13.28, 13.46, 13.61, 13.87, 14.03, 14.15, 14.35, 14.46, 14.59, 14.71, 14.85, 14.99, 15.1, 15.23, 15.31, 15.41, 15.47, 15.52, 15.59, 15.69, 15.74, 15.79, 15.87, 15.96, 16.05, 16.11, 16.17, 16.27, 16.3, 16.38, 16.44, 16.54, 16.59, 16.68, 16.79, 16.87, 16.93, 17.03, 17.11, 17.21, 17.36, 17.48, 17.63, 17.74, 17.88, 17.95, 17.97, 18, 18.12, 18.18, 18.25, 18.36, 18.45, 18.56, 18.69, 18.83, 19.01, 19.09, 19.19, 19.27, 19.33, 19.47, 19.64, 19.74, 19.89, 20.12, 20.32, 20.38, 20.57, 20.96, 21.08, 21.08, 21.09, 21.18, 21.2, 21.23, 21.35, 21.37, 21.49, 21.61, 21.71, 21.75, 21.91, 21.95, 21.99, 22.2, 22.46, 22.65], "y": [0.0, 0.001, 0.002, 0.003, 0.004, 0.005, 0.01, 0.011, 0.012, 0.013, 0.014, 0.015, 0.016, 0.017, 0.018, 0.019, 0.02, 0.025, 0.03, 0.035, 0.04, 0.05, 0.06, 0.065, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.915, 0.92, 0.93, 0.935, 0.936, 0.937, 0.938, 0.939, 0.94, 0.945, 0.95, 0.955, 0.96, 0.965, 0.97, 0.975, 0.98, 0.985, 0.99, 0.995, 1.0], "hovertemplate": "%{fullData.name}: %{x:.1f} ms<extra></extra>", "table": false},
        {"type": "scatter", "name": "JSQ", "color": "red", "x": [6.984, 7.639, 7.738, 7.892, 8.109, 8.388, 9.984, 10.03, 10.1, 10.19, 10.27, 10.44, 10.46, 10.6, 10.66, 10.73, 10.8, 11.07, 11.24, 11.62, 12, 12.38, 12.66, 12.76, 12.81, 12.99, 13.2, 13.48, 13.74, 13.93, 14.1, 14.38, 14.54, 14.73, 14.92, 15.16, 15.34, 15.58, 15.88, 16.19, 16.44, 16.73, 17, 17.18, 17.41, 17.64, 17.88, 18.18, 18.41, 18.59, 18.78, 19.01, 19.28, 19.54, 19.78, 19.97, 20.18, 20.36, 20.52, 20.72, 20.85, 21.07, 21.2, 21.38, 21.51, 21.64, 21.76, 21.92, 22.03, 22.16, 22.29, 22.49, 22.61, 22.71, 22.79, 22.94, 23.09, 23.24, 23.38, 23.52, 23.64, 23.8, 23.99, 24.12, 24.26, 24.43, 24.58, 24.71, 24.83, 24.97, 25.14, 25.34, 25.52, 25.75, 25.96, 26.18, 26.3, 26.42, 26.51, 26.62, 26.73, 26.88, 27.06, 27.23, 27.45, 27.6, 27.65, 27.81, 28.13, 28.23, 28.36, 28.6, 28.8, 28.9, 28.94, 29.02, 29.05, 29.1, 29.35, 29.88, 30.89, 31.24, 31.56, 31.87, 32.22, 32.52, 33.28, 33.94, 34.41, 35.26], "y": [0.0, 0.001, 0.002, 0.003, 0.004, 0.005, 0.01, 0.011, 0.012, 0.013, 0.014, 0.015, 0.016, 0.017, 0.018, 0.019, 0.02, 0.025, 0.03, 0.035, 0.04, 0.05, 0.06, 0.065, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.915, 0.92, 0.93, 0.935, 0.936, 0.937, 0.938, 0.939, 0.94, 0.945, 0.95, 0.955, 0.96, 0.965, 0.97, 0.975, 0.98, 0.985, 0.99, 0.995, 1.0], "hovertemplate": "%{fullData.name}: %{x:.1f} ms<extra></extra>", "table": false, "line": {"dash": "dash"}},
        {"type": "scatter", "name": "Sticky JSQ", "color": "red", "x": [0.3709, 4.963, 6.513, 7.162, 7.337, 7.446, 7.913, 7.963, 8, 8.036, 8.118, 8.144, 8.158, 8.243, 8.277, 8.451, 8.647, 9.284, 9.537, 9.693, 9.773, 10.09, 10.23, 10.48, 10.51, 10.79, 11.05, 11.19, 11.35, 11.45, 11.55, 11.65, 11.8, 11.93, 12.05, 12.18, 12.26, 12.36, 12.48, 12.63, 12.75, 12.93, 13.11, 13.26, 13.38, 13.5, 13.64, 13.77, 13.85, 13.97, 14.12, 14.26, 14.43, 14.57, 14.66, 14.72, 14.82, 14.89, 14.96, 15.05, 15.13, 15.19, 15.28, 15.34, 15.44, 15.51, 15.56, 15.61, 15.66, 15.72, 15.78, 15.84, 15.91, 15.96, 16.01, 16.06, 16.11, 16.17, 16.23, 16.29, 16.35, 16.41, 16.47, 16.52, 16.6, 16.66, 16.72, 16.8, 16.87, 16.95, 17, 17.07, 17.13, 17.22, 17.33, 17.48, 17.66, 17.92, 18.08, 18.25, 18.46, 18.62, 18.78, 19.08, 19.19, 19.52, 19.87, 20.04, 20.34, 20.38, 20.66, 20.96, 21.44, 21.45, 21.47, 21.48, 21.5, 21.76, 22.72, 23.55, 24.52, 24.92, 25.83, 26.16, 26.31, 26.69, 27, 27.07, 27.71, 28.32], "y": [0.0, 0.001, 0.002, 0.003, 0.004, 0.005, 0.01, 0.011, 0.012, 0.013, 0.014, 0.015, 0.016, 0.017, 0.018, 0.019, 0.02, 0.025, 0.03, 0.035, 0.04, 0.05, 0.06, 0.065, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.915, 0.92, 0.93, 0.935, 0.936, 0.937, 0.938, 0.939, 0.94, 0.945, 0.95, 0.955, 0.96, 0.965, 0.97, 0.975, 0.98, 0.985, 0.99, 0.995, 1.0], "hovertemplate": "%{fullData.name}: %{x:.1f} ms<extra></extra>", "table": false}
      ],
      "layout": {"hovermode": "y unified", "xaxis": {"title": {"text": "TPOT (ms)"}, "range": [-1, 44], "dtick": 10, "showspikes": false}, "yaxis": {"title": {"text": "Fraction of requests at or below"}, "range": [-0.01, 1.02], "tickvals": [0, 0.2, 0.4, 0.6, 0.8, 1], "ticktext": ["0", "0.2", "0.4", "0.6", "0.8", "1"], "showspikes": true, "spikemode": "across", "spikesnap": "cursor", "spikecolor": "#9ca3af", "spikethickness": 1, "spikedash": "dot", "unifiedhovertitle": {"text": "%{y:.1~%} of requests at or below"}}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

{{< diagram size="medium" caption="Figure A3: TTFT ECDF comparing RR and JSQ to their sticky variants. The sticky router maintains a similar median TTFT but worsens the tail." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--dash fig-key--blue"></i>RR</span>
  <span><i class="fig-key fig-key--blue"></i>Sticky RR</span>
  <span><i class="fig-key fig-key--dash fig-key--red"></i>JSQ</span>
  <span><i class="fig-key fig-key--red"></i>Sticky JSQ</span>
</div>
<div class="fig-plots fig-plots--1">
  <figure class="fig-plot">
    <div class="fig-plot-title">TTFT by routing policy</div>
    <div class="fig-plot-sub">Left is better</div>
    {{< plotly height="300" alt="Cumulative distribution of time to first token under four routing policies. Medians are close, 89 to 99 ms, but the sticky variants have long tails: the 90th percentile is 636 ms for sticky RR and 471 ms for sticky JSQ, against 150 ms for RR and 165 ms for JSQ. The 99th percentile is about 3.2 s for both sticky policies, 2.7 s for JSQ and 190 ms for RR." >}}
    {
      "unit": "ms",
      "table": false,
      "data": [
        {"type": "scatter", "name": "RR", "color": "blue", "x": [24.23, 32.51, 35.85, 38.51, 40.92, 42.76, 44.26, 45.6, 46.98, 48.4, 49.76, 50.95, 52.11, 53.44, 54.91, 55.92, 56.98, 58.17, 59.42, 60.57, 61.95, 63.29, 64.53, 65.76, 67.06, 68.48, 69.93, 71.36, 72.69, 73.78, 74.92, 76.09, 77.25, 78.38, 79.51, 80.78, 81.89, 82.95, 84, 85.19, 86.33, 87.54, 88.78, 90.07, 91.27, 92.36, 93.47, 94.83, 96.12, 97.37, 98.63, 99.83, 100.9, 102.1, 103.2, 104.3, 105.5, 106.5, 107.6, 108.6, 109.4, 110.4, 111.6, 112.9, 114, 114.9, 115.7, 116.6, 117.7, 119, 120.2, 121.4, 122.5, 123.6, 124.9, 126.3, 127.6, 128.7, 129.9, 131.4, 133.1, 134.4, 135.7, 137, 138.6, 140.3, 141.9, 143.8, 145.5, 147.4, 149.7, 152.1, 155.2, 156.4, 157.8, 160.9, 164.3, 168.5, 173.3, 179.7, 190.5, 203.6, 252.7], "y": [0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.92, 0.925, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995, 1.0], "hovertemplate": "%{fullData.name}: %{x:.1f} ms<extra></extra>", "table": false, "line": {"dash": "dash"}},
        {"type": "scatter", "name": "Sticky RR", "color": "blue", "x": [22.8, 33.96, 39.29, 42.53, 44.74, 46.41, 47.64, 48.89, 50.88, 52.54, 54.08, 55.41, 56.71, 58.02, 59.34, 60.69, 61.89, 62.74, 63.62, 64.44, 65.37, 66.35, 67.47, 68.59, 69.61, 70.53, 71.46, 72.3, 72.98, 73.92, 75.07, 75.82, 76.76, 77.79, 78.55, 79.37, 80.23, 81.14, 82.08, 83.12, 84.33, 85.39, 86.32, 87.22, 88.19, 89.02, 90.07, 91, 91.86, 92.69, 93.51, 94.31, 95.3, 96.32, 97.16, 98.01, 98.87, 99.96, 101, 102.1, 103.2, 104.3, 105.6, 107, 108.4, 109.6, 110.8, 112.6, 114.4, 116.5, 117.9, 119.6, 121.8, 123.9, 125.8, 128.4, 132.2, 135.6, 140, 146, 152.3, 156.7, 165.4, 183.1, 207.1, 242.5, 293, 371.1, 456.6, 552.6, 635.8, 776.9, 988, 1091, 1238, 1615, 1920, 2207, 2509, 2805, 3160, 3405, 3781], "y": [0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.92, 0.925, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995, 1.0], "hovertemplate": "%{fullData.name}: %{x:.1f} ms<extra></extra>", "table": false},
        {"type": "scatter", "name": "JSQ", "color": "red", "x": [24.34, 31.83, 35.73, 38.68, 41.24, 42.98, 44.87, 46.35, 47.72, 48.83, 50.18, 51.42, 52.67, 53.87, 54.96, 56, 57.12, 58.2, 59.24, 60.27, 61.59, 62.76, 63.83, 64.78, 65.96, 67.02, 68.07, 69.39, 70.49, 71.45, 72.5, 73.6, 74.56, 75.66, 76.8, 77.85, 78.7, 79.66, 80.75, 81.78, 82.82, 83.9, 84.97, 86.02, 87.04, 88.08, 89.2, 90.15, 91.26, 92.38, 93.46, 94.67, 95.69, 96.73, 98.04, 99.11, 100.3, 101.5, 102.7, 103.6, 104.4, 105.5, 106.6, 107.5, 108.6, 109.8, 110.9, 111.9, 113.1, 114.3, 115.5, 116.7, 118, 119.3, 120.8, 122.1, 123.5, 125.5, 127.2, 129.3, 131.5, 133.4, 135.4, 137.8, 140.1, 143.4, 146.1, 150.8, 154.4, 159.8, 165.1, 172, 184.4, 192.6, 200.9, 244.2, 314.6, 463.8, 1034, 1742, 2698, 3282, 4012], "y": [0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.92, 0.925, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995, 1.0], "hovertemplate": "%{fullData.name}: %{x:.1f} ms<extra></extra>", "table": false, "line": {"dash": "dash"}},
        {"type": "scatter", "name": "Sticky JSQ", "color": "red", "x": [25.56, 35.92, 41.01, 43.34, 45.18, 46.74, 48.14, 49.84, 51.34, 52.44, 53.48, 54.65, 55.74, 56.87, 58.13, 59.37, 60.44, 61.55, 62.49, 63.34, 64.12, 64.94, 65.76, 66.62, 67.45, 68.2, 69, 69.83, 70.7, 71.47, 72.34, 73.15, 74.01, 74.86, 75.63, 76.42, 77.2, 78.11, 78.96, 79.69, 80.43, 81.15, 81.89, 82.66, 83.44, 84.23, 85.09, 85.97, 86.89, 87.81, 88.71, 89.49, 90.3, 91.14, 92.13, 93.09, 94.01, 95.06, 96.01, 96.84, 97.7, 98.57, 99.56, 100.7, 102, 103.2, 104.3, 105.5, 106.9, 108.5, 110.3, 111.8, 113.6, 115.3, 117.3, 119, 121.4, 123.6, 126.2, 130, 133.3, 137.4, 143, 149.4, 159.7, 169.1, 184.7, 214.9, 269.4, 378.6, 470.5, 666.6, 899.8, 1087, 1244, 1523, 1786, 2066, 2423, 2753, 3156, 3406, 4058], "y": [0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.6, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.7, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.92, 0.925, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 0.995, 1.0], "hovertemplate": "%{fullData.name}: %{x:.1f} ms<extra></extra>", "table": false}
      ],
      "layout": {"hovermode": "y unified", "xaxis": {"title": {"text": "TTFT (ms)"}, "range": [-60, 4200], "dtick": 1000, "tickformat": ",d", "showspikes": false}, "yaxis": {"title": {"text": "Fraction of requests at or below"}, "range": [-0.01, 1.02], "tickvals": [0, 0.2, 0.4, 0.6, 0.8, 1], "ticktext": ["0", "0.2", "0.4", "0.6", "0.8", "1"], "showspikes": true, "spikemode": "across", "spikesnap": "cursor", "spikecolor": "#9ca3af", "spikethickness": 1, "spikedash": "dot", "unifiedhovertitle": {"text": "%{y:.1~%} of requests at or below"}}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}
