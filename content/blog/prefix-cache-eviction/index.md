+++
title = 'When Fancy Eviction Fails: Rethinking Cache Replacement for LLM Prefix Reuse'
date = 2026-11-07T18:00:00-05:00
author = 'Yiyu Liu'
draft = false
tags = ['LLM', 'caching', 'cache-eviction', 'KV-cache', 'serving', 'systems']
showToc = true
summary = 'We evaluated 14 cache eviction algorithms on two production LLM traces. None of them beat LRU. Here is why, and what does help.'

tldr = 'Prefix-cache reuse comes almost entirely from the steady pacing of active sessions, so recency predicts it well and thirteen more advanced eviction algorithms give LRU nothing. The remaining gap to the offline optimum is not a ranking problem: it comes from one-hit prompts, from misses that cost different amounts of compute, and from a few huge sessions. Keep LRU and add one signal at a time for whichever of those a deployment actually has.'
+++

Agentic and multi-turn LLM traffic is long, and it grows with every turn: each step resends the whole conversation so far. In the FreeInference trace, the median request inside a multi-turn session reaches 66,605 tokens, compared to 3,386 tokens across all requests, and sequence length reaches 111K tokens at the 90th percentile.

Prefill is what makes that expensive. Each uncached token attends to every earlier token in the full-attention layers, so cost grows faster than linearly in sequence length, and Mixture-of-Experts (MoE) models make attention an even larger share. Prefix caching is what avoids the work: serving engines keep cached key-value (KV) state in fixed-length blocks, typically 16 tokens; a request reuses the KV state of its longest cached prefix and prefills only the rest, so in an agent loop every step reuses the KV state of all earlier steps.

But the cache is small next to the traffic it serves. One 16-token block of Qwen3-Coder-30B KV state is 1.5 MiB, so a 24 GiB per-replica cache holds 16,384 blocks, or 262K tokens: about four of those median multi-turn requests. The engine is therefore evicting almost continuously, and every block it drops is prefill it may have to redo.

Both vLLM and SGLang make that choice with LRU, which ranks on recency alone. Decades of cache-replacement research have produced algorithms that beat LRU, and on web and block-storage workloads ARC, LIRS, LHD, S3-FIFO, and W-TinyLFU all do. We tested 14 online eviction algorithms on two production LLM traces. None of them beat LRU. Nor is the prefix-cache workload simply easy: Belady's offline optimum is 8.1 points above LRU at 24 GiB on FreeInference, so there is real headroom that no online algorithm reaches. The interesting question is therefore not which algorithm ranks highest, but what the workload is doing that defeats all of them.

## Fancy eviction does not beat LRU

We evaluate standard and specialized cache replacement algorithms on production LLM inference traces across a range of cache capacities. This part measures whether the more complex online algorithms improve hit ratio over default LRU, and how close any of them comes to Belady's offline optimum.

### How we tested

In our paper, [When Fancy Eviction Fails: Rethinking Cache Replacement For LLM Prefix Reuse](https://arxiv.org/abs/2609.28870), we evaluated 14 online algorithms alongside Belady's offline optimum across two production traces, [FreeInference](https://freeinference.org/) and [Chutes](https://chutes.ai/), totaling over 20 billion processed tokens. We simulated per-replica GPU HBM (24 to 120 GiB) and global pool tiers (0.25 to 12 TiB) using [PrefixSim](https://github.com/cacheMon/PrefixSim), an open-source simulator built on libCacheSim that enforces request-level residency: all blocks of a request must be resident at the same time during its prefill.

| | FreeInference | Chutes |
| --- | ---: | ---: |
| Requests | 327.5K | 515.8K |
| In multi-turn sessions | 34.3% | 26.1% |
| Span | 7.0 days | 130.9 days |
| Tokens processed | 10.5B | 9.7B |
| Unique tokens | 0.63B | 2.23B |
| Average request | 32.0K tokens | 18.7K tokens |

The 14 algorithms group by what they rank on: recency (LRU), quick demotion (ARC, SIEVE, S3-FIFO, S4-FIFO, LIRS), analytic modeling (LHD), frequency (LFU, W-TinyLFU), learned replacement (LeCaR, LRB, 3LCache), and prefix-cache-specific heuristics (Workload-aware, AsymCache).

### What the results show

Across this grid, no online algorithm reliably outperforms default LRU.

{{< diagram size="wide" caption="*Figure 1.* Block hit ratio relative to LRU, in percentage points, at four cache sizes on both traces. Anything left of the line is worse than LRU. LFU runs off the scale: it is 9.5 to 38.2 points below LRU on FreeInference and 25.7 to 34.0 points below on Chutes. LRU's own hit ratio is 0.611, 0.839, 0.918 and 0.938 on FreeInference and 0.635, 0.702, 0.727 and 0.759 on Chutes; exact values for every bar are in the data table under each panel." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box fig-key--red"></i>24 GiB</span>
  <span><i class="fig-key fig-key--box fig-key--amber"></i>48 GiB</span>
  <span><i class="fig-key fig-key--box fig-key--teal"></i>96 GiB</span>
  <span><i class="fig-key fig-key--box fig-key--blue"></i>1 TiB</span>
</div>
<div class="fig-plots fig-plots--1">
  <figure class="fig-plot">
    <div class="fig-plot-title">FreeInference</div>
    <div class="fig-plot-sub">Right of the line is better than LRU</div>
    {{< plotly height="520" alt="Horizontal bars of block hit ratio relative to LRU on the FreeInference trace, at 24, 48, 96 GiB and 1 TiB. ARC, SIEVE, S3-FIFO, S4-FIFO, LIRS, LHD, LeCaR, 3LCache, Workload-aware and AsymCache all sit within 1.3 points of zero at every size. LRB is up to 4.9 points below LRU, W-TinyLFU falls to 17.0 points below at 1 TiB, and LFU runs off the left edge of the scale. Belady is the only series meaningfully above zero, by 8.1 points at 24 GiB falling to 0.2 points at 1 TiB." >}}
    {
      "unit": "pts",
      "decimals": 2,
      "xname": "Algorithm",
      "data": [
        {"type": "bar", "orientation": "h", "name": "24 GiB", "color": "red", "y": ["ARC", "SIEVE", "S3-FIFO", "S4-FIFO", "LIRS", "LHD", "LFU", "W-TinyLFU", "LeCaR", "LRB", "3LCache", "Workload-aware", "AsymCache", "Belady"], "x": [0.58, 0.56, 1.02, 1.05, 0.31, 1.28, -9.52, -0.37, 0.7, -3.18, 0.61, 0.3, 0.0, 8.13]},
        {"type": "bar", "orientation": "h", "name": "48 GiB", "color": "amber", "y": ["ARC", "SIEVE", "S3-FIFO", "S4-FIFO", "LIRS", "LHD", "LFU", "W-TinyLFU", "LeCaR", "LRB", "3LCache", "Workload-aware", "AsymCache", "Belady"], "x": [0.45, 0.05, -0.29, -0.07, 0.21, 0.54, -30.82, -2.39, 0.23, -4.9, -0.18, -0.02, 0.0, 5.02]},
        {"type": "bar", "orientation": "h", "name": "96 GiB", "color": "teal", "y": ["ARC", "SIEVE", "S3-FIFO", "S4-FIFO", "LIRS", "LHD", "LFU", "W-TinyLFU", "LeCaR", "LRB", "3LCache", "Workload-aware", "AsymCache", "Belady"], "x": [0.19, 0.02, -0.52, -0.27, -0.17, 0.14, -38.21, -5.13, 0.05, -2.31, -0.42, -0.28, 0.0, 1.62]},
        {"type": "bar", "orientation": "h", "name": "1 TiB", "color": "blue", "y": ["ARC", "SIEVE", "S3-FIFO", "S4-FIFO", "LIRS", "LHD", "LFU", "W-TinyLFU", "LeCaR", "LRB", "3LCache", "Workload-aware", "AsymCache", "Belady"], "x": [0.03, 0.03, 0.0, 0.05, -0.28, 0.0, -34.86, -16.99, 0.02, -0.19, -0.03, -0.07, 0.0, 0.21]}
      ],
      "layout": {
        "barmode": "group",
        "xaxis": {"title": {"text": "Hit ratio vs. LRU (percentage points)"}, "range": [-12, 9], "dtick": 3, "zeroline": false},
        "yaxis": {"categoryorder": "array", "categoryarray": ["ARC", "SIEVE", "S3-FIFO", "S4-FIFO", "LIRS", "LHD", "LFU", "W-TinyLFU", "LeCaR", "LRB", "3LCache", "Workload-aware", "AsymCache", "Belady"]},
        "shapes": [{"type": "line", "x0": 0, "x1": 0, "yref": "paper", "y0": 0, "y1": 1, "layer": "between", "line": {"color": "#1f2328", "width": 1.5}}]
      }
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Chutes</div>
    <div class="fig-plot-sub">Right of the line is better than LRU</div>
    {{< plotly height="520" alt="Horizontal bars of block hit ratio relative to LRU on the Chutes trace, at 24, 48, 96 GiB and 1 TiB. LHD, ARC, LeCaR, 3LCache, Workload-aware and AsymCache all sit within 0.9 points of zero. S3-FIFO is up to 5.2 points below LRU, SIEVE, S4-FIFO, LIRS and LRB up to 3.4 points below, W-TinyLFU is 8.8 to 20.7 points below, and LFU runs off the left edge of the scale. Belady is 8.0 points above LRU at 24 GiB falling to 1.0 point at 1 TiB." >}}
    {
      "unit": "pts",
      "decimals": 2,
      "xname": "Algorithm",
      "data": [
        {"type": "bar", "orientation": "h", "name": "24 GiB", "color": "red", "y": ["ARC", "SIEVE", "S3-FIFO", "S4-FIFO", "LIRS", "LHD", "LFU", "W-TinyLFU", "LeCaR", "LRB", "3LCache", "Workload-aware", "AsymCache", "Belady"], "x": [-0.02, -2.92, -4.32, -3.04, -0.97, 0.53, -25.7, -8.94, -0.13, -2.85, -0.42, -0.88, -0.01, 7.96]},
        {"type": "bar", "orientation": "h", "name": "48 GiB", "color": "amber", "y": ["ARC", "SIEVE", "S3-FIFO", "S4-FIFO", "LIRS", "LHD", "LFU", "W-TinyLFU", "LeCaR", "LRB", "3LCache", "Workload-aware", "AsymCache", "Belady"], "x": [-0.06, -2.44, -5.15, -1.6, -2.18, 0.33, -32.01, -8.81, -0.14, -2.08, -0.52, -0.54, -0.01, 4.54]},
        {"type": "bar", "orientation": "h", "name": "96 GiB", "color": "teal", "y": ["ARC", "SIEVE", "S3-FIFO", "S4-FIFO", "LIRS", "LHD", "LFU", "W-TinyLFU", "LeCaR", "LRB", "3LCache", "Workload-aware", "AsymCache", "Belady"], "x": [0.06, -1.25, -3.07, -0.7, -3.43, 0.3, -33.97, -10.65, 0.04, -0.7, -0.1, -0.34, 0.0, 3.32]},
        {"type": "bar", "orientation": "h", "name": "1 TiB", "color": "blue", "y": ["ARC", "SIEVE", "S3-FIFO", "S4-FIFO", "LIRS", "LHD", "LFU", "W-TinyLFU", "LeCaR", "LRB", "3LCache", "Workload-aware", "AsymCache", "Belady"], "x": [0.07, -0.06, -0.23, -0.01, -2.47, 0.1, -32.34, -20.67, 0.09, -0.75, -0.09, -0.19, 0.0, 1.02]}
      ],
      "layout": {
        "barmode": "group",
        "xaxis": {"title": {"text": "Hit ratio vs. LRU (percentage points)"}, "range": [-12, 9], "dtick": 3, "zeroline": false},
        "yaxis": {"categoryorder": "array", "categoryarray": ["ARC", "SIEVE", "S3-FIFO", "S4-FIFO", "LIRS", "LHD", "LFU", "W-TinyLFU", "LeCaR", "LRB", "3LCache", "Workload-aware", "AsymCache", "Belady"]},
        "shapes": [{"type": "line", "x0": 0, "x1": 0, "yref": "paper", "y0": 0, "y1": 1, "layer": "between", "line": {"color": "#1f2328", "width": 1.5}}]
      }
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

**Most algorithms reproduce LRU.** Six of them, ARC, LHD, LeCaR, 3LCache, Workload-aware and AsymCache, stay within 1.3 points of LRU at every evaluated cache size on both traces; LRB is the learned algorithm that is clearly worse, 4.9 points below LRU at 48 GiB on FreeInference. The largest gain any online algorithm achieves over LRU anywhere in the grid is +1.28 points by LHD on FreeInference.

**Quick-demotion algorithms are trace-dependent.** Algorithms that quickly discard one-hit items match LRU on some distributions, but fall behind on others: S3-FIFO is 1.0 point above LRU at 24 GiB on FreeInference while being 5.2 points below LRU at 48 GiB on Chutes. SIEVE, S4-FIFO, and LIRS behave the same way.

**Frequency-based algorithms collapse.** Explicit frequency ranking fails catastrophically on prefix caches: LFU falls 38.2 points below LRU at 96 GiB on FreeInference, dropping completely off the scale of the figure.

**The gap to Belady is large and is widest in a tight cache.** Belady's offline optimum beats LRU by 8.1 points on FreeInference in the smallest cache. Better replacement decisions exist in capacity-constrained regimes, but existing online heuristics fail to capture them.

## What makes a prefix cache different

The prefix-cache workload has structural properties that classic eviction algorithms do not model. This part measures them, and they explain why the algorithms above do no better than recency alone.

### Sessions set the pace

Prefix reuse comes almost entirely from the next turn of an active session. When a user interacts with a model or an agent executes a tool loop, requests arrive at a steady, regular pace set by tool calls and typing, and the intervals have low variance: median intra-session reuse interval is 8.2 seconds, and 99.7% of reuse gaps are under 22 minutes. Across block types, median reuse intervals are 10.0 seconds for system prompts and 11.2 seconds for multi-turn history, with 99th percentiles of 1,000 seconds and 562 seconds.

Lifetimes are session-bounded. Over multi-turn sessions in FreeInference, median session duration is 55 seconds, the 90th percentile is 14 minutes, and the 99th percentile is about 4 hours. When a session ends, its conversational blocks are never touched again. In FreeInference, 53.0% of distinct blocks are accessed exactly once, so their lifetime is zero. Of the blocks reused at least once, 77.7% have a lifetime under 30 minutes. Measured over all distinct blocks of each trace, the 90th-percentile block lifetime is 2,000 seconds (33 minutes) on FreeInference, compared to 307,000 seconds (3.6 days) on the CloudPhysics block-storage trace and 1.54 million seconds (17.8 days) on the Wikipedia 2019 web trace. Recency works because a recent access reliably indicates an ongoing session.

Reuse intervals show the same contrast. On FreeInference, the 90th-percentile reuse interval is 64.9 seconds and the 99th percentile is 729 seconds (12 minutes), compared to a 90th percentile of 91,700 seconds (25 hours) on Wikipedia and 307,000 seconds (3.6 days) on CloudPhysics.

{{< diagram size="large" caption="*Figure 2.* Object lifetime and reuse interval, as cumulative distributions over the prefix cache (FreeInference), a block-storage trace (CloudPhysics) and a web trace (Wikipedia 2019). The prefix-cache 90th-percentile lifetime is 2,000 seconds, against 3.6 days for block storage and 17.8 days for web; its 90th-percentile reuse interval is 64.9 seconds, against 25 hours for web and 3.6 days for block storage. Every curve starts at the share of objects accessed exactly once, which is similar across the three (53.0%, 54.1%, 56.1%)." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--red"></i>LLM prefix cache</span>
  <span><i class="fig-key fig-key--slate"></i>Block storage</span>
  <span><i class="fig-key fig-key--blue"></i>Web</span>
</div>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Object lifetime</div>
    <div class="fig-plot-sub">First access to last access</div>
    {{< plotly height="300" alt="Cumulative distribution of object lifetime on a log time axis for three traces. Every curve starts at the share of objects accessed exactly once: 53.0 percent for the LLM prefix cache, 54.1 percent for block storage, 56.1 percent for web. The prefix-cache curve then rises steeply and reaches its 90th percentile at 2,000 seconds, while block storage reaches its 90th percentile at 307,000 seconds and web at 1.54 million seconds." >}}
      {
        "table": false,
        "unit": "",
        "decimals": 3,
        "data": [
          {"type": "scatter", "name": "LLM prefix cache", "color": "red", "x": [0.103, 0.154, 0.23, 0.345, 0.516, 0.772, 1.15, 1.73, 2.59, 3.87, 5.79, 8.66, 13.0, 19.4, 29.0, 43.4, 64.9, 97.2, 145.0, 218.0, 325.0, 487.0, 729.0, 1090.0, 1630.0, 2440.0, 3650.0, 5460.0, 8180.0, 12200.0, 18300.0, 27400.0, 41000.0, 61300.0, 91700.0, 137000.0, 205000.0, 307000.0, 460000.0, 688000.0, 1030000.0, 1540000.0, 2300000.0, 2820000.0], "y": [0.5303, 0.5303, 0.5304, 0.5305, 0.5317, 0.5359, 0.5372, 0.5385, 0.5459, 0.55, 0.556, 0.5642, 0.5762, 0.5907, 0.6107, 0.6353, 0.6642, 0.6943, 0.7264, 0.7582, 0.7903, 0.8171, 0.8461, 0.8701, 0.8918, 0.9159, 0.9363, 0.9518, 0.9665, 0.9725, 0.9785, 0.9861, 0.9911, 0.994, 0.9966, 0.9978, 0.9989, 0.9993, 0.9998, 1.0, 1.0, 1.0, 1.0, 1.0]},
          {"type": "scatter", "name": "Block storage", "color": "slate", "x": [0.103, 0.154, 0.23, 0.345, 0.516, 0.772, 1.15, 1.73, 2.59, 3.87, 5.79, 8.66, 13.0, 19.4, 29.0, 43.4, 64.9, 97.2, 145.0, 218.0, 325.0, 487.0, 729.0, 1090.0, 1630.0, 2440.0, 3650.0, 5460.0, 8180.0, 12200.0, 18300.0, 27400.0, 41000.0, 61300.0, 91700.0, 137000.0, 205000.0, 307000.0, 460000.0, 688000.0, 1030000.0, 1540000.0, 2300000.0, 2820000.0], "y": [0.5409, 0.5409, 0.5409, 0.5409, 0.5409, 0.5409, 0.5409, 0.5409, 0.541, 0.5411, 0.5412, 0.5414, 0.5415, 0.5417, 0.5419, 0.5423, 0.5425, 0.5429, 0.5434, 0.5439, 0.5444, 0.5451, 0.5459, 0.5467, 0.5477, 0.5481, 0.5487, 0.5493, 0.5498, 0.5508, 0.5512, 0.5514, 0.555, 0.5563, 0.5716, 0.6836, 0.7681, 0.9955, 0.9988, 1.0, 1.0, 1.0, 1.0, 1.0]},
          {"type": "scatter", "name": "Web", "color": "blue", "x": [0.103, 0.154, 0.23, 0.345, 0.516, 0.772, 1.15, 1.73, 2.59, 3.87, 5.79, 8.66, 13.0, 19.4, 29.0, 43.4, 64.9, 97.2, 145.0, 218.0, 325.0, 487.0, 729.0, 1090.0, 1630.0, 2440.0, 3650.0, 5460.0, 8180.0, 12200.0, 18300.0, 27400.0, 41000.0, 61300.0, 91700.0, 137000.0, 205000.0, 307000.0, 460000.0, 688000.0, 1030000.0, 1540000.0, 2300000.0, 2820000.0], "y": [0.5607, 0.5607, 0.5607, 0.5607, 0.5607, 0.5607, 0.5625, 0.5625, 0.5631, 0.5635, 0.5641, 0.5646, 0.5653, 0.5662, 0.5672, 0.5682, 0.5693, 0.5706, 0.5717, 0.5727, 0.5737, 0.5745, 0.5754, 0.5763, 0.5772, 0.5781, 0.579, 0.5803, 0.5816, 0.5832, 0.5856, 0.5884, 0.5921, 0.5976, 0.6066, 0.6165, 0.6317, 0.6532, 0.6807, 0.7242, 0.7923, 0.9036, 1.0, 1.0]}
        ],
        "layout": {"xaxis": {"title": {"text": "Seconds (log scale)"}, "type": "log", "range": [-1, 6.48], "tickvals": [1, 60, 3600, 86400, 604800], "ticktext": ["1s", "1min", "1h", "1d", "1wk"]}, "yaxis": {"title": {"text": "CDF over distinct objects"}, "range": [0, 1.02], "dtick": 0.25}}
      }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Reuse interval</div>
    <div class="fig-plot-sub">Gap between consecutive accesses</div>
    {{< plotly height="300" alt="Cumulative distribution of the gap between consecutive accesses to the same object, on a log time axis, for three traces. The prefix-cache curve is far to the left: its 90th percentile is 64.9 seconds and its 99th percentile 729 seconds, against a 90th percentile of 91,700 seconds for web and 307,000 seconds for block storage." >}}
      {
        "table": false,
        "unit": "",
        "decimals": 3,
        "data": [
          {"type": "scatter", "name": "LLM prefix cache", "color": "red", "x": [0.103, 0.154, 0.23, 0.345, 0.516, 0.772, 1.15, 1.73, 2.59, 3.87, 5.79, 8.66, 13.0, 19.4, 29.0, 43.4, 64.9, 97.2, 145.0, 218.0, 325.0, 487.0, 729.0, 1090.0, 1630.0, 2440.0, 3650.0, 5460.0, 8180.0, 12200.0, 18300.0, 27400.0, 41000.0, 61300.0, 91700.0, 137000.0, 205000.0, 307000.0, 460000.0, 688000.0, 1030000.0, 1540000.0, 2300000.0, 2820000.0], "y": [0.0016, 0.0021, 0.0027, 0.0033, 0.0044, 0.0083, 0.0197, 0.054, 0.1082, 0.1835, 0.2927, 0.4527, 0.6175, 0.7359, 0.8136, 0.8691, 0.905, 0.9352, 0.9571, 0.9703, 0.9811, 0.9865, 0.9903, 0.9929, 0.9946, 0.9959, 0.9966, 0.9972, 0.9977, 0.9981, 0.9986, 0.9991, 0.9994, 0.9997, 0.9998, 0.9999, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]},
          {"type": "scatter", "name": "Block storage", "color": "slate", "x": [0.103, 0.154, 0.23, 0.345, 0.516, 0.772, 1.15, 1.73, 2.59, 3.87, 5.79, 8.66, 13.0, 19.4, 29.0, 43.4, 64.9, 97.2, 145.0, 218.0, 325.0, 487.0, 729.0, 1090.0, 1630.0, 2440.0, 3650.0, 5460.0, 8180.0, 12200.0, 18300.0, 27400.0, 41000.0, 61300.0, 91700.0, 137000.0, 205000.0, 307000.0, 460000.0, 688000.0, 1030000.0, 1540000.0, 2300000.0, 2820000.0], "y": [0.0096, 0.0096, 0.0096, 0.0096, 0.0096, 0.0096, 0.0181, 0.0181, 0.0273, 0.0352, 0.0518, 0.0706, 0.0982, 0.1343, 0.1917, 0.2239, 0.2588, 0.2879, 0.312, 0.3347, 0.3547, 0.3662, 0.3722, 0.3756, 0.3773, 0.3786, 0.381, 0.384, 0.3866, 0.3891, 0.3913, 0.3935, 0.3998, 0.405, 0.4287, 0.583, 0.698, 0.9989, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]},
          {"type": "scatter", "name": "Web", "color": "blue", "x": [0.103, 0.154, 0.23, 0.345, 0.516, 0.772, 1.15, 1.73, 2.59, 3.87, 5.79, 8.66, 13.0, 19.4, 29.0, 43.4, 64.9, 97.2, 145.0, 218.0, 325.0, 487.0, 729.0, 1090.0, 1630.0, 2440.0, 3650.0, 5460.0, 8180.0, 12200.0, 18300.0, 27400.0, 41000.0, 61300.0, 91700.0, 137000.0, 205000.0, 307000.0, 460000.0, 688000.0, 1030000.0, 1540000.0, 2300000.0, 2820000.0], "y": [0.0162, 0.0162, 0.0162, 0.0162, 0.0162, 0.0162, 0.0281, 0.0281, 0.0346, 0.0397, 0.0479, 0.0579, 0.069, 0.0849, 0.1032, 0.1238, 0.1481, 0.1772, 0.2087, 0.2439, 0.2828, 0.3248, 0.37, 0.4201, 0.4696, 0.5203, 0.5717, 0.6221, 0.6699, 0.7147, 0.7566, 0.7953, 0.8311, 0.8661, 0.9013, 0.926, 0.9484, 0.9657, 0.9796, 0.99, 0.9967, 0.9998, 1.0, 1.0]}
        ],
        "layout": {"xaxis": {"title": {"text": "Seconds (log scale)"}, "type": "log", "range": [-1, 6.48], "tickvals": [1, 60, 3600, 86400, 604800], "ticktext": ["1s", "1min", "1h", "1d", "1wk"]}, "yaxis": {"title": {"text": "CDF over reuses"}, "range": [0, 1.02], "dtick": 0.25}}
      }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

**Takeaway:** Recency works because reuse is paced by active sessions.

### Frequency measures the past, not the next turn

Frequency fails as an eviction ranking key because access counts measure past session progress rather than when the next turn arrives. Turn arrival is paced by typing and tool calls. A block accessed 20 times and one accessed 3 times are equally likely to be touched in the next ten seconds. On web and block traces, higher frequency predicts a shorter reuse interval: the median falls across five orders of magnitude on Wikipedia (from 460,000 seconds down to 2.6 seconds) and from 250,000 seconds down to under a second on CloudPhysics. On the prefix cache, the median reuse interval is flat between 8.7 and 15.8 seconds across every frequency bin from 2 to 13,000 accesses, with the 25th-to-75th percentile band remaining between 4.7 and 29 seconds. LFU retains blocks from completed sessions and starves active ones.

Frequency is useful only for deciding what to admit, and the blocks that are never reused are the ones to keep out. The probability that a block is reused again jumps from 69.4% after its first access to 88.7% after its second, and stays above 92% from four accesses onward. On the web trace, the reuse probability starts at 43.5% and rises gradually to 80.4% after four accesses; on block storage, it drops from 24.7% to 4.1% before rising unevenly. Frequency can filter single-turn prompts before they consume long-term cache capacity.

{{< diagram size="large" caption="*Figure 3.* Median reuse interval against frequency, and the probability of another reuse against the accesses a block has had so far. On FreeInference the median reuse interval is flat between 8.7 and 15.8 seconds across every frequency bin, while on the web trace it falls from 460,000 seconds to 2.6 seconds. Reuse probability on FreeInference jumps from 69.4% after one access to 88.7% after two. Three block-storage bins sit on the panel's floor, which is that trace's one-second timestamp resolution." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--red"></i>LLM prefix cache</span>
  <span><i class="fig-key fig-key--slate"></i>Block storage</span>
  <span><i class="fig-key fig-key--blue"></i>Web</span>
</div>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Reuse interval vs. frequency</div>
    <div class="fig-plot-sub">Band: 25th to 75th percentile</div>
    {{< plotly height="300" alt="Median reuse interval against a block's frequency, with a 25th to 75th percentile band, on log axes. The LLM prefix-cache line is flat between 8.7 and 15.8 seconds across every frequency bin from 2 accesses to 13,000 accesses, with a narrow band inside 4.7 to 29 seconds. The web line falls across five orders of magnitude, from 460,000 seconds at about 2 accesses to 2.6 seconds at about 75,000 accesses. The block-storage line falls from 250,000 seconds to under a second over few populated bins." >}}
      {
        "table": false,
        "unit": "s",
        "decimals": 2,
        "data": [
          {"type": "scatter", "name": "LLM prefix cache", "color": "red", "legendgroup": "LLM prefix cache", "table": false, "x": [2.37, 4.22, 7.5, 13.3, 23.7, 42.2, 75.0, 133.0, 237.0, 422.0, 750.0, 1330.0, 2370.0, 4220.0, 7500.0, 13300.0], "y": [4.73, 4.73, 4.73, 4.73, 4.73, 8.66, 8.66, 8.66, 8.66, 4.73, 8.66, 8.66, 8.66, 4.73, 8.66, 8.66], "line": {"width": 0}, "hoverinfo": "skip", "showlegend": false},
          {"type": "scatter", "name": "LLM prefix cache", "color": "red", "legendgroup": "LLM prefix cache", "table": false, "x": [2.37, 4.22, 7.5, 13.3, 23.7, 42.2, 75.0, 133.0, 237.0, 422.0, 750.0, 1330.0, 2370.0, 4220.0, 7500.0, 13300.0], "y": [97.2, 53.1, 29.0, 29.0, 29.0, 29.0, 29.0, 29.0, 29.0, 15.8, 29.0, 29.0, 29.0, 29.0, 29.0, 29.0], "fill": "tonexty", "showlegend": false},
          {"type": "scatter", "name": "LLM prefix cache", "color": "red", "legendgroup": "LLM prefix cache", "x": [2.37, 4.22, 7.5, 13.3, 23.7, 42.2, 75.0, 133.0, 237.0, 422.0, 750.0, 1330.0, 2370.0, 4220.0, 7500.0, 13300.0], "y": [15.8, 15.8, 15.8, 8.66, 15.8, 15.8, 15.8, 15.8, 15.8, 8.66, 15.8, 15.8, 15.8, 8.66, 15.8, 15.8]},
          {"type": "scatter", "name": "Block storage", "color": "slate", "legendgroup": "Block storage", "table": false, "x": [2.37, 4.22, 7.5, 13.3, 23.7, 42.2, 75.0, 133.0, 237.0, 422.0, 750.0, 1330.0, 7500.0], "y": [137000.0, 29.0, 29.0, 29.0, 29.0, 15.8, 8.66, 0.001, 0.001, 0.001, 97.2, 178.0, 0.001], "line": {"width": 0}, "hoverinfo": "skip", "showlegend": false},
          {"type": "scatter", "name": "Block storage", "color": "slate", "legendgroup": "Block storage", "table": false, "x": [2.37, 4.22, 7.5, 13.3, 23.7, 42.2, 75.0, 133.0, 237.0, 422.0, 750.0, 1330.0, 7500.0], "y": [460000.0, 137000.0, 596.0, 97.2, 97.2, 53.1, 29.0, 8.66, 97.2, 0.001, 325.0, 596.0, 4.73], "fill": "tonexty", "showlegend": false},
          {"type": "scatter", "name": "Block storage", "color": "slate", "legendgroup": "Block storage", "x": [2.37, 4.22, 7.5, 13.3, 23.7, 42.2, 75.0, 133.0, 237.0, 422.0, 750.0, 1330.0, 7500.0], "y": [251000.0, 178.0, 178.0, 29.0, 53.1, 29.0, 15.8, 0.001, 2.59, 0.001, 97.2, 325.0, 0.001]},
          {"type": "scatter", "name": "Web", "color": "blue", "legendgroup": "Web", "table": false, "x": [2.37, 4.22, 7.5, 13.3, 23.7, 42.2, 75.0, 133.0, 237.0, 422.0, 750.0, 1330.0, 2370.0, 4220.0, 7500.0, 13300.0, 23700.0, 42200.0, 75000.0], "y": [75000.0, 75000.0, 41000.0, 22400.0, 12200.0, 6680.0, 3650.0, 2000.0, 1090.0, 596.0, 325.0, 178.0, 178.0, 97.2, 29.0, 29.0, 8.66, 4.73, 0.001], "line": {"width": 0}, "hoverinfo": "skip", "showlegend": false},
          {"type": "scatter", "name": "Web", "color": "blue", "legendgroup": "Web", "table": false, "x": [2.37, 4.22, 7.5, 13.3, 23.7, 42.2, 75.0, 133.0, 237.0, 422.0, 750.0, 1330.0, 2370.0, 4220.0, 7500.0, 13300.0, 23700.0, 42200.0, 75000.0], "y": [841000.0, 460000.0, 460000.0, 251000.0, 137000.0, 75000.0, 41000.0, 22400.0, 12200.0, 6680.0, 3650.0, 2000.0, 1090.0, 596.0, 325.0, 178.0, 97.2, 53.1, 8.66], "fill": "tonexty", "showlegend": false},
          {"type": "scatter", "name": "Web", "color": "blue", "legendgroup": "Web", "x": [2.37, 4.22, 7.5, 13.3, 23.7, 42.2, 75.0, 133.0, 237.0, 422.0, 750.0, 1330.0, 2370.0, 4220.0, 7500.0, 13300.0, 23700.0, 42200.0, 75000.0], "y": [460000.0, 251000.0, 137000.0, 75000.0, 75000.0, 22400.0, 12200.0, 6680.0, 3650.0, 3650.0, 2000.0, 1090.0, 596.0, 325.0, 178.0, 97.2, 29.0, 15.8, 2.59]}
        ],
        "layout": {"xaxis": {"title": {"text": "Frequency (accesses per object, log scale)"}, "type": "log", "range": [0.3, 5.1], "tickvals": [1, 10, 100, 1000, 10000]}, "yaxis": {"title": {"text": "Median reuse interval (s)"}, "type": "log", "range": [-3.1, 6.1], "tickvals": [0.001, 0.1, 10, 1000, 100000]}}
      }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Probability of another reuse</div>
    <div class="fig-plot-sub">Given the accesses so far</div>
    {{< plotly height="300" alt="Probability that an object is accessed again, against the number of accesses it has had so far, on a log x axis. For the LLM prefix cache the probability is 0.694 after one access and 0.887 after two, dips to 0.785 at three, and stays above 0.92 from four accesses onward. The web curve rises gradually from 0.435 after one access to 0.804 after four. The block-storage curve starts at 0.247, drops to 0.041 after two accesses, and rises unevenly after that." >}}
      {
        "table": false,
        "unit": "",
        "decimals": 3,
        "data": [
          {"type": "scatter", "name": "LLM prefix cache", "color": "red", "x": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 70, 100, 150, 200], "y": [0.6942, 0.8869, 0.7851, 0.9227, 0.9229, 0.923, 0.9587, 0.9451, 0.9585, 0.9503, 0.9425, 0.9823, 0.9802, 0.9799, 0.989, 0.98, 0.9806, 0.9957, 0.9657, 0.9717, 0.9947]},
          {"type": "scatter", "name": "Block storage", "color": "slate", "x": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12], "y": [0.2467, 0.0414, 0.2713, 0.3054, 0.7345, 0.7183, 0.7723, 0.8244, 0.9164, 0.9326, 0.9301]},
          {"type": "scatter", "name": "Web", "color": "blue", "x": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 70, 100, 150, 200, 300, 500], "y": [0.4349, 0.6591, 0.7562, 0.8036, 0.8399, 0.8632, 0.8807, 0.8932, 0.904, 0.9129, 0.9259, 0.9393, 0.9526, 0.96, 0.9665, 0.9746, 0.9784, 0.9846, 0.9881, 0.992, 0.9935, 0.9947, 0.9976]}
        ],
        "layout": {"xaxis": {"title": {"text": "Frequency so far (accesses per object, log scale)"}, "type": "log", "range": [-0.05, 3.05], "tickvals": [1, 10, 100, 1000]}, "yaxis": {"title": {"text": "P(reused again)"}, "range": [0, 1.02], "dtick": 0.25}}
      }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

**Takeaway:** Frequency measures past session length and mispredicts future access timing.

### Misses do not all cost the same

Everything up to this point has been evaluated by hit ratio, assuming that every cache miss costs the same. But in a prefix cache, deeper blocks cost far more to recompute than shallow ones. Each uncached token attends to all earlier tokens in full-attention layers, including cached ones, so recomputing a block behind a long prefix requires far more compute. Two algorithms with the same hit ratio can cost different amounts of compute and different TTFT.

We evaluate eviction with the compute-savings ratio: TFLOPs saved by hits divided by total TFLOPs, under a cost model for Qwen3-Coder-30B. Hit ratio is the special case where every block costs the same. Belady is no longer optimal under compute savings.

Differentiating recomputation costs is possible because cache residency is separate from prefix matching. A cached block is reusable whenever its entire preceding token sequence matches the request. If an eviction algorithm drops blocks from the middle of a prefix, the engine recomputes only the missing blocks; deeper cached blocks after the gap remain hits. Eviction therefore does not have to work from the tail of a prefix. The cache can keep deep, expensive blocks and drop shallow, cheap ones.

**Takeaway:** Recomputation cost grows with prefix depth, and middle gaps can be recomputed while deeper cached blocks stay hits.

### A few sessions hold most of the bytes

Session footprints are extremely skewed: the median session holds 45 blocks (0.07 GiB), while the top 10% of sessions hold 76.2% of all KV bytes, the top 1% hold 20.3%, and the largest single session reaches 234 GiB.

Plotting the concentration of KV bytes across sessions underscores this disparity: the curve sits far above the diagonal that equally sized sessions would produce, with the top 5% of sessions holding 56.3% of all KV bytes. The vast majority of sessions consume minimal memory, while a small tail of extended multi-turn interactions dominates the cache footprint.

{{< diagram size="medium" caption="*Figure 4.* Share of all KV bytes held by the largest sessions on FreeInference, largest first. The dotted diagonal is what equally sized sessions would give: the top 1% of sessions hold 20.3% of all KV bytes, the top 5% hold 56.3%, and the top 10% hold 76.2%." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--red"></i>Measured</span>
  <span><i class="fig-key fig-key--dash fig-key--muted"></i>Equal-sized sessions</span>
</div>
<figure class="fig-plot">
  {{< plotly height="320" alt="Share of all KV bytes held by the largest sessions, with sessions ordered largest first on a log x axis. The measured curve rises far above the dotted diagonal that equal-sized sessions would follow: the top 1 percent of sessions hold 20.3 percent of all KV bytes, the top 5 percent hold 56.3 percent, and the top 10 percent hold 76.2 percent." >}}
    {
      "table": false,
      "unit": "",
      "decimals": 3,
      "data": [
        {"type": "scatter", "name": "Equal-sized sessions", "color": "muted", "table": false, "x": [0.0001, 0.0001334, 0.0001778, 0.0002371, 0.0003162, 0.0004217, 0.0005623, 0.0007499, 0.001, 0.001334, 0.001778, 0.002371, 0.003162, 0.004217, 0.005623, 0.007499, 0.01, 0.01334, 0.01778, 0.02371, 0.03162, 0.04217, 0.05623, 0.07499, 0.1, 0.1334, 0.1778, 0.2371, 0.3162, 0.4217, 0.5623, 0.7499, 1.0], "y": [0.0001, 0.0001334, 0.0001778, 0.0002371, 0.0003162, 0.0004217, 0.0005623, 0.0007499, 0.001, 0.001334, 0.001778, 0.002371, 0.003162, 0.004217, 0.005623, 0.007499, 0.01, 0.01334, 0.01778, 0.02371, 0.03162, 0.04217, 0.05623, 0.07499, 0.1, 0.1334, 0.1778, 0.2371, 0.3162, 0.4217, 0.5623, 0.7499, 1.0], "line": {"dash": "dot", "width": 1.5}, "hoverinfo": "skip"},
        {"type": "scatter", "name": "Measured", "color": "red", "x": [1.35e-05, 1.79e-05, 2.24e-05, 3.14e-05, 4.04e-05, 5.83e-05, 6.28e-05, 6.73e-05, 9.42e-05, 0.000144, 0.000197, 0.000242, 0.000283, 0.000381, 0.000682, 0.00207, 0.00331, 0.00483, 0.00627, 0.00875, 0.0108, 0.0147, 0.021, 0.0274, 0.0334, 0.0397, 0.0466, 0.0536, 0.0601, 0.0669, 0.0726, 0.0788, 0.0849, 0.0908, 0.0953, 0.0999, 0.111, 0.129, 0.154, 0.176, 0.189, 0.2, 0.206, 0.211, 0.218, 0.227, 0.235, 0.242, 0.249, 0.256, 0.263, 0.269, 0.28, 0.289, 0.298, 0.311, 0.326, 0.336, 0.345, 0.351, 0.357, 0.365, 0.378, 0.401, 0.43, 0.504, 0.581, 0.662, 0.732, 0.756, 0.769, 0.779, 0.788, 0.796, 0.814, 0.826, 0.846, 0.857, 0.875, 0.883, 0.891, 0.98, 0.986, 0.988, 0.989, 0.99, 0.996, 1.0], "y": [0.0024, 0.003, 0.0034, 0.0043, 0.0051, 0.0065, 0.0068, 0.007, 0.0085, 0.0108, 0.0131, 0.0148, 0.0161, 0.0191, 0.0269, 0.0597, 0.0859, 0.1147, 0.1388, 0.1761, 0.2029, 0.25, 0.317, 0.3774, 0.4283, 0.475, 0.5217, 0.5631, 0.598, 0.6303, 0.6547, 0.678, 0.6983, 0.7161, 0.7282, 0.739, 0.7625, 0.7967, 0.8388, 0.8714, 0.8888, 0.9017, 0.9091, 0.9138, 0.9191, 0.9261, 0.9314, 0.9357, 0.9395, 0.9429, 0.9456, 0.9479, 0.9516, 0.9543, 0.9568, 0.9598, 0.9629, 0.9649, 0.9665, 0.9674, 0.9682, 0.969, 0.9705, 0.9726, 0.9751, 0.9807, 0.9858, 0.9906, 0.9944, 0.9955, 0.9961, 0.9965, 0.9968, 0.997, 0.9975, 0.9977, 0.9982, 0.9984, 0.9987, 0.9988, 0.9989, 0.9999, 0.9999, 1.0, 1.0, 1.0, 1.0, 1.0]}
      ],
      "layout": {"xaxis": {"title": {"text": "Largest sessions, as a fraction of all sessions (log scale)"}, "type": "log", "range": [-4, 0], "tickvals": [0.0001, 0.001, 0.01, 0.1, 1], "ticktext": ["0.01%", "0.1%", "1%", "10%", "100%"]}, "yaxis": {"title": {"text": "Share of all KV bytes"}, "range": [0, 1.02], "dtick": 0.25}, "annotations": [{"x": -2.08, "y": 0.203, "text": "Top 1%: 20.3%", "showarrow": false, "xanchor": "right", "yanchor": "bottom", "font": {"size": 12, "color": "#1f2328"}}, {"x": -1.08, "y": 0.762, "text": "Top 10%: 76.2%", "showarrow": false, "xanchor": "right", "yanchor": "bottom", "font": {"size": 12, "color": "#1f2328"}}]}
    }
  {{< /plotly >}}
</figure>
{{< /diagram >}}

**Takeaway:** A small fraction of sessions holds most of the cached bytes, so the unit an algorithm evicts in matters as much as the order it evicts in.

## What actually helps

Recency alone does not capture three workload properties: single-turn prompts that are never reused, misses that cost different amounts of compute depending on block depth, and session footprints skewed enough that the unit of eviction matters. Keep LRU as the base and add one signal only for whichever of these conditions a deployment actually encounters.

### Quick demotion, when one-hit prompts flood the cache

Quick-demotion algorithms like S3-FIFO isolate one-hit items in a probationary buffer to avoid flushing reusable state. On prefix workloads, this mechanism pays only under a narrow condition. Single-turn prompts are short, so a large volume must arrive before their footprint threatens capacity.

On FreeInference and Chutes, that volume threshold is not reached: quick demotion is roughly neutral on FreeInference, while on Chutes it costs 5.2 points of hit ratio at 48 GiB. It succeeds only when single-turn prompts heavily dominate the arrival stream.

{{< diagram size="medium" caption="*Figure 5.* Block hit ratio on the Qwen To-B trace, where single-turn prompts dominate. Quick demotion is worth 8.8 points at 24 GiB and nothing at 1 TiB. Note the y axis starts at 0.35." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box fig-key--red"></i>LRU</span>
  <span><i class="fig-key fig-key--box fig-key--green"></i>S3-FIFO</span>
  <span><i class="fig-key fig-key--box fig-key--blue"></i>ARC</span>
</div>
<figure class="fig-plot">
  {{< plotly height="300" alt="Grouped bars of block hit ratio at 24, 48, 96 GiB and 1 TiB on the Qwen To-B trace. S3-FIFO and ARC reach 0.49 at 24 GiB against LRU's 0.40; by 1 TiB all three are within 0.4 points of each other." >}}
  {
    "decimals": 3,
    "xname": "Cache size",
    "data": [
      {"type": "bar", "name": "LRU", "color": "red", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.4032, 0.4491, 0.4806, 0.5267]},
      {"type": "bar", "name": "S3-FIFO", "color": "green", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.4915, 0.5089, 0.5157, 0.5281]},
      {"type": "bar", "name": "ARC", "color": "blue", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.4913, 0.5094, 0.5176, 0.5302]}
    ],
    "layout": {"yaxis": {"title": {"text": "Hit ratio"}, "range": [0.35, 0.56], "dtick": 0.05}}
  }
  {{< /plotly >}}
</figure>
{{< /diagram >}}

On the single-turn dominated Qwen To-B trace at 24 GiB, quick demotion succeeds: LRU achieves a hit ratio of 0.403, while S3-FIFO reaches 0.492 and ARC reaches 0.491. S3-FIFO gains 8.8 points over LRU because transient prompts arrive quickly enough to evict active multi-turn prefixes under plain LRU. At 1 TiB, capacity eliminates this pressure, and all three algorithms perform within 0.4 points of each other.

**Takeaway:** Quick demotion delivers gains only when high volumes of short, single-turn prompts threaten to displace active multi-turn prefixes in small caches.

### Compute-aware eviction, in contiguous chunks

Compute-aware eviction ranks blocks by what they cost to recompute rather than by whether they are hit. The exact theoretical ceiling is computable: the offline optimum is an integer linear program (ILP) over reuse intervals with cache capacity as the constraint. BeladyCompute is a close offline heuristic that evicts the block with the highest product of compute intensity and time until next access. RandomCompute is the online version: it samples a few blocks and evicts the one with the lowest ratio of compute intensity to time since last access, avoiding the cost of scoring every block.

{{< diagram size="large" caption="*Figure 6.* Compute-savings ratio on FreeInference under the Qwen3-Coder-30B cost model. Belady is not optimal here: BeladyCompute and the ILP optimum are 12.6 and 13.7 points above it at 24 GiB. Note the y axis starts at 0.5." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box fig-key--red"></i>LRU</span>
  <span><i class="fig-key fig-key--box fig-key--amber"></i>RandomCompute</span>
  <span><i class="fig-key fig-key--box fig-key--blue"></i>PartialNode RandomCompute</span>
  <span><i class="fig-key fig-key--box fig-key--gold"></i>Belady</span>
  <span><i class="fig-key fig-key--box fig-key--magenta"></i>BeladyCompute</span>
  <span><i class="fig-key fig-key--box fig-key--gray"></i>Offline optimum</span>
</div>
<figure class="fig-plot">
  {{< plotly height="320" alt="Grouped bars of compute-savings ratio at 24, 48, 96 GiB and 1 TiB. At 24 GiB LRU reaches 0.533, RandomCompute 0.638, Belady 0.609, BeladyCompute 0.735 and the ILP optimum 0.746. The gaps close as the cache grows and all six series are within 0.2 points at 1 TiB." >}}
  {
    "decimals": 3,
    "xname": "Cache size",
    "data": [
      {"type": "bar", "name": "LRU", "color": "red", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.5333, 0.8231, 0.9259, 0.9498]},
      {"type": "bar", "name": "RandomCompute", "color": "amber", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.6378, 0.8686, 0.9338, 0.9502]},
      {"type": "bar", "name": "PartialNode RandomCompute", "color": "blue", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.6361, 0.8666, 0.9331, 0.9502]},
      {"type": "bar", "name": "Belady", "color": "gold", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.6091, 0.8826, 0.9445, 0.9514]},
      {"type": "bar", "name": "BeladyCompute", "color": "magenta", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.7353, 0.9118, 0.947, 0.9514]},
      {"type": "bar", "name": "Offline optimum", "color": "gray", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.7457, 0.9159, 0.9477, 0.9514]}
    ],
    "layout": {"yaxis": {"title": {"text": "Compute-savings ratio"}, "range": [0.5, 1.0], "dtick": 0.1}}
  }
  {{< /plotly >}}
</figure>
{{< /diagram >}}

At 24 GiB on FreeInference, LRU achieves a compute-savings ratio of 0.533. RandomCompute reaches 0.638, outperforming LRU by 10.4 points and surpassing hit-optimal Belady at 0.609. BeladyCompute reaches 0.735, tracking the offline optimum of 0.746 within 1.03 points at 24 GiB, 0.41 at 48 GiB, and 0.08 at 96 GiB. The Belady-to-BeladyCompute gap bounds what compute-awareness can buy: 12.6 points at 24 GiB on FreeInference, but at most 1.1 points across the other five traces evaluated. At 1 TiB, all six configurations converge within 0.2 points of each other.

Scoring is only half of the technique. Sampling scatters evictions across prefixes, and the gaps it leaves cost more than the scoring saves. At 24 GiB on FreeInference, block-granular RandomCompute leaves 9.21 holes per request on average, and 143 at the 99th percentile.

Partial-node eviction fixes this fragmentation. Instead of removing scattered blocks, one chosen node evicts its first k contiguous blocks. This yields 8.7x fewer holes while preserving compute savings: 0.636 for PartialNode RandomCompute versus 0.638 for block-granular RandomCompute at 24 GiB. Because the recomputed segments have no dependencies between them, their prefills can be batched in parallel. The chunk k can be sized to the engine's batching token budget.

{{< diagram size="large" caption="*Figure 7.* End-to-end on an H200 with a 48 GiB cache, 10,000 requests from FreeInference. TTFT and throughput were measured in separate runs. Lower is better on the left, higher is better on the right." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box fig-key--red"></i>LRU</span>
  <span><i class="fig-key fig-key--box fig-key--amber"></i>RandomCompute</span>
  <span><i class="fig-key fig-key--box fig-key--blue"></i>PartialNode RandomCompute</span>
</div>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Average TTFT</div>
    <div class="fig-plot-sub">Lower is better</div>
    {{< plotly height="260" alt="Horizontal bars of average time to first token: LRU 1294 ms, RandomCompute 5241 ms, PartialNode RandomCompute 1037 ms." >}}
    {
      "table": false,
      "data": [
        {"type": "bar", "orientation": "h", "name": "LRU", "color": "red", "y": ["LRU"], "x": [1293.7], "texttemplate": "%{x:,.0f} ms", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}, "hovertemplate": "%{fullData.name}: %{x:,.0f} ms<extra></extra>"},
        {"type": "bar", "orientation": "h", "name": "RandomCompute", "color": "amber", "y": ["RandomCompute"], "x": [5240.8], "texttemplate": "%{x:,.0f} ms", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}, "hovertemplate": "%{fullData.name}: %{x:,.0f} ms<extra></extra>"},
        {"type": "bar", "orientation": "h", "name": "PartialNode RandomCompute", "color": "blue", "y": ["PartialNode"], "x": [1036.5], "texttemplate": "%{x:,.0f} ms", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}, "hovertemplate": "%{fullData.name}: %{x:,.0f} ms<extra></extra>"}
      ],
      "layout": {"xaxis": {"title": {"text": "Milliseconds"}, "range": [0, 6400]}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Prefill throughput</div>
    <div class="fig-plot-sub">Higher is better</div>
    {{< plotly height="260" alt="Horizontal bars of prefill throughput in tokens per second: LRU 55,176, RandomCompute 14,043, PartialNode RandomCompute 65,569." >}}
    {
      "table": false,
      "data": [
        {"type": "bar", "orientation": "h", "name": "LRU", "color": "red", "y": ["LRU"], "x": [55176.4], "texttemplate": "%{x:,.0f}", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}, "hovertemplate": "%{fullData.name}: %{x:,.0f} tokens/s<extra></extra>"},
        {"type": "bar", "orientation": "h", "name": "RandomCompute", "color": "amber", "y": ["RandomCompute"], "x": [14043.4], "texttemplate": "%{x:,.0f}", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}, "hovertemplate": "%{fullData.name}: %{x:,.0f} tokens/s<extra></extra>"},
        {"type": "bar", "orientation": "h", "name": "PartialNode RandomCompute", "color": "blue", "y": ["PartialNode"], "x": [65568.5], "texttemplate": "%{x:,.0f}", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}, "hovertemplate": "%{fullData.name}: %{x:,.0f} tokens/s<extra></extra>"}
      ],
      "layout": {"xaxis": {"title": {"text": "Tokens per second"}, "range": [0, 80000]}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

End-to-end tests confirm the penalty of fragmentation. On an NVIDIA H200 GPU running vLLM with Qwen3-Coder-30B, a 48 GiB cache, and 10,000 FreeInference requests (measuring TTFT and throughput in separate runs), block-granular RandomCompute collapsed: average TTFT was 5,240.8 ms (4.0x LRU's 1,293.7 ms), and prefill throughput fell to 14,043 tokens/s (3.9x lower than LRU's 55,176 tokens/s).

PartialNode resolves the issue: it cuts average TTFT by 19.9% to 1,036.5 ms and raises prefill throughput by 18.8% to 65,569 tokens/s over LRU. Median TTFT increases from 112 ms under LRU to 171 ms under PartialNode, but 99th percentile TTFT falls from 26.0 seconds to 16.8 seconds.

**Takeaway:** Ranking blocks by recompute cost beats hit-optimal eviction on long sequences, but only when the blocks it drops are contiguous: scattered evictions fragment prefixes and cost more in throughput and tail latency than the scoring saves.

### Match granularity to the memory tier

Partial-node eviction establishes that evictions must be contiguous. That shifts the focus from ranking to the unit of eviction: partial-node eviction asks how large a contiguous chunk of blocks to drop, while a coarser alternative, session-level eviction, asks whether the unit should be a block or a whole session.

Tracking fine-grained blocks incurs heavy metadata overhead at scale: a 12 TiB secondary pool holds 8.4 million 16-token blocks. Evicting entire sessions saves metadata, but viability depends on the memory tier.

Because session footprints are so heavily skewed, session-level eviction fails in GPU HBM: the cache cannot partially trim huge sessions, and dropping a session purges shared system prompts used by other active sessions. At 24 GiB, session-level eviction costs LRU 10.5 points in hit ratio and costs RandomCompute 18.7 points in compute savings; at 48 GiB, the losses are 3.3 and 5.5 points.

In a global memory pool, this difference is unmeasurable because the pool easily absorbs large sessions. Production pool systems like Mooncake and LMCache operate in 256 to 512-token chunks, 16 to 32 times coarser than a block, for this metadata reason.

**Takeaway:** Use fine-grained contiguous block eviction in GPU HBM to avoid eviction penalties on skewed session footprints, and use coarse eviction in secondary pools to eliminate metadata overhead.

## What to do with this

These findings define a straightforward decision path for LLM serving stacks:

| Start with | Add | When |
| --- | --- | --- |
| **LRU** | — | Always. No online algorithm we tested beat it by more than 1.3 points, and it needs the least metadata. |
| | **Quick demotion** (S3-FIFO) | Only when single-turn prompts arrive in high enough volume that their footprint threatens capacity. Measure first. |
| | **Compute-aware eviction** (PartialNode RandomCompute) | When sequences are long and per-block recompute cost varies. Test it by running Belady against BeladyCompute on a trace sample. Evict contiguous chunks rather than sampled blocks: that half is required, not optional. |
| | **Session-level eviction** | Only in a large pool, where it costs nothing and saves metadata. Never in HBM. |

If running quick demotion and compute-awareness together, apply compute-aware scoring to the main cache only. Scoring blocks by compute intensity inside the admission queue evicts shallow blocks before they have had a chance to prove themselves.

## Traces and simulator

- **Simulator:** [github.com/cacheMon/PrefixSim](https://github.com/cacheMon/PrefixSim) (Apache-2.0)
- **Traces:** [huggingface.co/datasets/harvardMadsys/2026_prefixcache](https://huggingface.co/datasets/harvardMadsys/2026_prefixcache) (CC BY 4.0), as `freeinference.lcp.zst` and `chutes.lcp.zst`
- **Paper:** [When Fancy Eviction Fails: Rethinking Cache Replacement For LLM Prefix Reuse](https://arxiv.org/abs/2609.28870)

The traces carry per-block identity scoped across sessions, which is what prefix-cache eviction research needs and what existing public datasets lack; we would like to hear what people find.
