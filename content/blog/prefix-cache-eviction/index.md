+++
title = 'When Fancy Eviction Fails: Rethinking Cache Replacement for LLM Prefix Reuse'
date = 2026-11-07T18:00:00-05:00
author = 'Yiyu Liu'
draft = true
tags = ['LLM', 'caching', 'cache-eviction', 'KV-cache', 'serving', 'systems']
showToc = true
summary = 'We evaluated 14 cache eviction algorithms on two production LLM traces. None of them beat LRU. Here is why, and what does help.'

tldr = 'Prefix-cache reuse comes almost entirely from the steady pacing of active sessions, so recency predicts it well and thirteen more advanced eviction algorithms give LRU nothing. The remaining gap to the offline optimum is not a ranking problem: it comes from one-hit prompts, from misses that cost different amounts of compute, and from a few huge sessions. Keep LRU and add one signal at a time for whichever of those a deployment actually has.'
+++

Serving systems keep the KV states of tokens they have already processed and reuse them when the next request shares a prefix. This is prefix caching, and it is now a large part of what an LLM serving stack costs. Agents and long conversations resend a growing context on every turn, and recomputing that context is expensive because prefill cost grows faster than linearly with sequence length.

That raises a question: **what is a good eviction algorithm for a prefix cache?** Caching research has produced dozens of answers for web and block-storage workloads. In our paper, [When Fancy Eviction Fails: Rethinking Cache Replacement For LLM Prefix Reuse](https://arxiv.org/abs/2609.28870), we test whether any of them transfer.

We collected two production traces from two organizations, [FreeInference](https://freeinference.org/) and [Chutes](https://chutes.ai/), covering **over 20 billion processed tokens**, and built [PrefixSim](https://github.com/cacheMon/PrefixSim), a C++ simulator that honors the constraint block-level simulators miss: every block of a request must be resident at the same time for its prefill. We then ran **14 online eviction algorithms**, from plain LRU to learned ones, plus Belady's offline optimum, across both memory regimes a real deployment has — per-replica HBM (24–120 GiB) and a global DRAM/SSD pool (0.25–12 TiB).

| | FreeInference | Chutes |
| --- | ---: | ---: |
| Requests | 327.5K | 515.8K |
| In multi-turn sessions | 34.3% | 26.1% |
| Span | 7.0 days | 130.9 days |
| Tokens processed | 10.5B | 9.7B |
| Unique tokens | 0.63B | 2.23B |
| Average request | 32.0K tokens | 18.7K tokens |

Six findings follow.

## 1. Thirteen alternatives to LRU, and not one of them wins

We grouped the algorithms by what they rank on: recency (LRU), quick demotion (ARC, SIEVE, S3-FIFO, S4-FIFO, LIRS), analytic modeling (LHD), frequency (LFU, W-TinyLFU), learned (LeCaR, LRB, 3LCache), and prefix-cache-specific designs (Workload-aware, AsymCache). Belady's optimum sets the ceiling.

They fall into three groups, and none of them is "better than LRU."

{{< diagram size="wide" caption="*Figure 1.* Block hit ratio at four cache sizes. Six of the fifteen algorithms are shown; the other nine sit inside the same band. Note the y axis starts at 0.5." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box fig-key--red"></i>LRU</span>
  <span><i class="fig-key fig-key--box fig-key--blue"></i>ARC</span>
  <span><i class="fig-key fig-key--box fig-key--green"></i>S3-FIFO</span>
  <span><i class="fig-key fig-key--box fig-key--purple"></i>LHD</span>
  <span><i class="fig-key fig-key--box fig-key--slate"></i>W-TinyLFU</span>
  <span><i class="fig-key fig-key--box fig-key--gold"></i>Belady</span>
</div>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">FreeInference</div>
    {{< plotly height="300" alt="Grouped bars of block hit ratio at 24, 48, 96 GiB and 1 TiB on the FreeInference trace. LRU, ARC, S3-FIFO and LHD are within about one point of each other at every size; W-TinyLFU falls behind and drops to 0.77 at 1 TiB; Belady is above all of them, by 8.1 points at 24 GiB and 0.2 points at 1 TiB." >}}
    {
      "decimals": 3,
      "xname": "Cache size",
      "data": [
        {"type": "bar", "name": "LRU", "color": "red", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.6107, 0.8387, 0.9175, 0.9376]},
        {"type": "bar", "name": "ARC", "color": "blue", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.6165, 0.8432, 0.9194, 0.9379]},
        {"type": "bar", "name": "S3-FIFO", "color": "green", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.6209, 0.8358, 0.9123, 0.9376]},
        {"type": "bar", "name": "LHD", "color": "purple", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.6235, 0.8441, 0.9189, 0.9376]},
        {"type": "bar", "name": "W-TinyLFU", "color": "slate", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.607, 0.8148, 0.8662, 0.7677]},
        {"type": "bar", "name": "Belady", "color": "gold", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.692, 0.8889, 0.9337, 0.9397]}
      ],
      "layout": {"yaxis": {"title": {"text": "Hit ratio"}, "range": [0.5, 1.0], "dtick": 0.1}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Chutes</div>
    {{< plotly height="300" alt="Grouped bars of block hit ratio at 24, 48, 96 GiB and 1 TiB on the Chutes trace. LRU, ARC and LHD are within 0.5 points of each other; S3-FIFO is 3.1 to 5.2 points below LRU in HBM; W-TinyLFU is 8.9 points below LRU at 24 GiB and drops to 0.55 at 1 TiB; Belady is above all of them, by 8.0 points at 24 GiB and 1.0 point at 1 TiB." >}}
    {
      "decimals": 3,
      "xname": "Cache size",
      "data": [
        {"type": "bar", "name": "LRU", "color": "red", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.6346, 0.7019, 0.7269, 0.7587]},
        {"type": "bar", "name": "ARC", "color": "blue", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.6344, 0.7013, 0.7275, 0.7594]},
        {"type": "bar", "name": "S3-FIFO", "color": "green", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.5914, 0.6504, 0.6962, 0.7564]},
        {"type": "bar", "name": "LHD", "color": "purple", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.6399, 0.7052, 0.7299, 0.7597]},
        {"type": "bar", "name": "W-TinyLFU", "color": "slate", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.5452, 0.6138, 0.6204, 0.552]},
        {"type": "bar", "name": "Belady", "color": "gold", "x": ["24 GiB", "48 GiB", "96 GiB", "1 TiB"], "y": [0.7142, 0.7473, 0.7601, 0.7689]}
      ],
      "layout": {"yaxis": {"title": {"text": "Hit ratio"}, "range": [0.5, 1.0], "dtick": 0.1}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

**Most algorithms reproduce LRU.** ARC, LHD, LeCaR, 3LCache, Workload-aware and AsymCache stay within 1.3 points of LRU at every cache size on both traces; AsymCache is identical to LRU at all four FreeInference sizes. LRB is the one in this group that is clearly worse, down 4.9 points at 48 GiB on FreeInference.

**Quick-demotion algorithms are trace-dependent.** S3-FIFO gains 1.0 point over LRU at 24 GiB on FreeInference and loses 4.3 points at 24 GiB on Chutes. SIEVE, S4-FIFO and LIRS behave the same way: a small win on one workload, several points of loss on another.

**Frequency-based algorithms collapse.** LFU reaches 0.516 where LRU reaches 0.611, and never recovers — at 1 TiB it is still at 0.589 against LRU's 0.938. W-TinyLFU is close to LRU in a tight FreeInference cache (0.4 points down at 24 GiB) and already 8.9 points down on Chutes; in the pool regime both fall apart, to 0.768 and 0.552.

**The gap to optimal is large.** Belady sits 8.1 points above LRU at 24 GiB on FreeInference and 8.0 points above on Chutes. No online algorithm closes any meaningful part of that.

Here is every algorithm at 48 GiB, the per-replica size a realistic deployment runs:

| Algorithm | FreeInference | Chutes |
| --- | ---: | ---: |
| LRU | 0.839 | 0.702 |
| ARC | 0.843 | 0.701 |
| SIEVE | 0.839 | 0.678 |
| S3-FIFO | 0.836 | 0.650 |
| S4-FIFO | 0.838 | 0.686 |
| LIRS | 0.841 | 0.680 |
| LHD | 0.844 | 0.705 |
| LFU | 0.531 | 0.382 |
| W-TinyLFU | 0.815 | 0.614 |
| LeCaR | 0.841 | 0.701 |
| 3LCache | 0.837 | 0.697 |
| LRB | 0.790 | 0.681 |
| Workload-aware | 0.839 | 0.697 |
| AsymCache | 0.839 | 0.702 |
| **Belady (offline)** | **0.889** | **0.747** |

## 2. Recency wins because sessions set the pace

A prefix cache does not look like a web cache. Almost all reuse comes from the next turn of a session that is still running, and turns arrive on a schedule set by tool calls and by how fast a person types.

The median intra-session interval is **8.2 seconds**, and **99.7% of gaps are under 22 minutes**. Split by block type, the medians are 10.0 s for system prompts and 11.2 s for multi-turn history. There is a tail — the 99th percentiles are 1,000 s and 562 s, from long tool runs and people walking away — but it is a tail, not a second mode.

That is why recency works. A block that has been idle for a long time belongs to a session that has moved on. Even in the rare case where it does come back, holding it that long costs more capacity than the one hit is worth.

Frequency fails for the same reason. A block's access count tells you how many turns its session has run so far, not when the next turn will arrive. Sessions are paced, so a block accessed 20 times and a block accessed 3 times are equally likely to be touched in the next ten seconds. Ranking on frequency sorts by session age, which is why LFU collapses.

One thing frequency is good for: **53.0–55.7% of blocks are never reused at all**, a share that is about the same on prefix-cache, web and block-storage traces. A low early count separates those out, which makes frequency useful as an admission filter even though it is useless as a ranking key.

**Takeaway:** use recency to decide what to evict. Use frequency, if at all, to decide what to admit.

## 3. Quick demotion pays only when one-hit prompts flood the cache

If one-hit prompts are the problem, filtering them early is the fix. S3-FIFO does exactly that, and on a workload with enough of them, the gain is large.

{{< diagram size="medium" caption="*Figure 2.* Block hit ratio on the Qwen To-B trace, where single-turn prompts dominate. Quick demotion is worth 8.8 points at 24 GiB and nothing at 1 TiB. Note the y axis starts at 0.35." >}}
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

The condition is narrow. One-hit prompts are single-turn, so they are short, so each one occupies very little cache. They have to arrive in overwhelming volume before their total footprint threatens capacity. On our two main traces that threshold is not reached, and quick demotion either does nothing (FreeInference) or costs several points (Chutes).

**Takeaway:** turn quick demotion on only after measuring that single-turn traffic is large enough to flood the cache. It is not a default.

## 4. Two algorithms with the same hit ratio can cost different amounts of compute

Every miss in a prefix cache triggers recomputation, and recomputation is not a fixed price. Attention cost grows with token position, so rebuilding a block 200K tokens deep costs far more than rebuilding an equally sized block near the start of the prompt. A hit ratio counts both as one.

So we measure the **compute-savings ratio** instead: each hit weighted by the FLOPs it avoided, modeled on Qwen3-Coder-30B. Hit ratio is the special case where every block costs the same.

Under this metric, Belady is no longer optimal. Belady minimizes misses, and minimizing misses is not the same as minimizing recomputed FLOPs.

{{< diagram size="large" caption="*Figure 3.* Compute-savings ratio on FreeInference under the Qwen3-Coder-30B cost model. Belady is not optimal here: BeladyCompute and the ILP optimum are 12.6 and 13.7 points above it at 24 GiB. Note the y axis starts at 0.5." >}}
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

Three things come out of this figure.

**The exact optimum is computable.** We formulate the problem as an ILP over reuse intervals with capacity as the constraint. It is slow, so we also define **BeladyCompute**, which evicts the block with the highest `ComputeIntensity × TimeUntilNextAccess`. It tracks the ILP to within 1.03 points at 24 GiB, 0.41 at 48 GiB and 0.08 at 96 GiB.

**You can test whether your workload needs this.** Run Belady and BeladyCompute on a trace sample and look at the gap between them. It bounds everything compute-awareness can buy you. On FreeInference the gap is **12.6 points** at 24 GiB. On the other five traces we checked it is **at most 1.1 points**, which means hit-optimal eviction is already good enough there. The profile depends on the model and on how many long sequences you serve, so the test only needs rerunning when those change.

**An online algorithm can capture most of it.** **RandomCompute** samples a few blocks and evicts the one with the lowest `ComputeIntensity / TimeSinceLastAccess`. At 24 GiB it reaches 0.638 — **10.4 points above LRU**, and above hit-optimal Belady.

## 5. A compute-aware algorithm has to evict contiguous blocks

RandomCompute as described has a serious problem. Sampling picks blocks scattered through the prefix, so what it leaves behind is a prefix full of holes — **9.21 holes per request on average**, with a tail in the hundreds. Each hole is a separate run of tokens to recompute, and attention over a fragmented prefix is much more expensive than the block count suggests.

**Partial-node eviction** fixes it. Instead of dropping scattered blocks, drop a contiguous chunk from the start of a node. The recomputation volume is the same; it arrives in **8.7× fewer holes**. Compute savings barely move: 0.636 against 0.638 at 24 GiB. And because the missing segments have no dependencies between them, their prefills can be batched and run in parallel. Size the chunk to the engine's batching token budget and hole-filling uses the budget exactly.

On a real vLLM engine serving Qwen3-Coder-30B with a 48 GiB cache, replaying 10,000 FreeInference requests:

{{< diagram size="large" caption="*Figure 4.* End-to-end on an H200 with a 48 GiB cache, 10,000 requests from FreeInference. TTFT and throughput were measured in separate runs. Lower is better on the left, higher is better on the right." >}}
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

Partial-node compute-aware eviction cuts average TTFT by **19.9%** (1.04 s against 1.29 s) and raises prefill throughput by **18.8%** (65.6K against 55.2K tokens/s). The block-granular version is unusable: **4.0× the TTFT** and **3.9× less throughput** than LRU, from fragmentation alone.

The algorithm trades cheap shallow hits for expensive deep ones. LRU keeps a better median TTFT (112 ms against 171 ms); the tail is where the gain is, with **p99 falling from 26.0 s to 16.8 s**.

**Takeaway:** compute-awareness gives large gains on long-context workloads, but only if eviction is contiguous. A sampling algorithm that scatters its evictions will lose more to fragmentation than it gains in compute savings.

## 6. Eviction granularity should match the memory tier

Tracking a 12 TiB pool means indexing 8.4 million 16-token blocks. That metadata is why production systems like Mooncake and LMCache work in 256–512-token chunks, 16–32× coarser than a block. The extreme version is **session-level eviction**: throw out a whole session at a time and keep almost no per-block state.

Whether that is acceptable depends entirely on capacity, and session KV footprints are extremely skewed. The median session accumulates 45 blocks (0.07 GiB). The **top 10% of sessions hold 76.2% of all KV bytes**, the top 1% hold 20.3%, and the largest single session reaches **234 GiB** — several times a whole HBM cache.

So in the HBM regime, session-level eviction is bad. At 24 GiB, LRU loses **10.5 points** of hit ratio and RandomCompute loses **18.7 points** of compute savings, because one huge session that cannot be partially trimmed forces out many useful ones. At 48 GiB the penalty is smaller but still real: 3.3 and 5.5 points. Since blocks are already the native unit in HBM, there is nothing to gain by accepting it.

In the pool regime the gap becomes unmeasurable. The only lasting cost is cross-session sharing — evicting a session also drops system prompts other sessions still want — and the pool's capacity mostly absorbs that.

**Takeaway:** block-level in HBM, your choice in the pool.

## What to do with this

There is no single best prefix-cache algorithm: what helps depends on capacity and on what your traffic looks like. Here is the decision list we would use.

| Start with | Add | When |
| --- | --- | --- |
| **LRU** | — | Always. No online algorithm we tested beat it by more than 1.3 points, and it needs the least metadata. |
| | **Quick demotion** (S3-FIFO) | Only when single-turn prompts arrive in high enough volume that their footprint threatens capacity. Measure first. |
| | **Compute-aware eviction** (RandomCompute) | When sequences are long and per-block recompute cost varies. Test it by running Belady against BeladyCompute on a trace sample. |
| | **Partial-node granularity** | Whenever compute-aware eviction is on. Required, not optional. |
| | **Session-level eviction** | Only in a large pool, where it costs nothing and saves metadata. Never in HBM. |

One more note on combining them: if you run quick demotion and compute-awareness together, apply the compute-aware scoring to the main cache only. Applying it in the admission queue evicts shallow blocks before they have had a chance to prove themselves.

## Traces and simulator

- **Simulator:** [github.com/cacheMon/PrefixSim](https://github.com/cacheMon/PrefixSim) (Apache-2.0)
- **Traces:** [huggingface.co/datasets/harvardMadsys/2026_prefixcache](https://huggingface.co/datasets/harvardMadsys/2026_prefixcache) (CC BY 4.0), as `freeinference.lcp.zst` and `chutes.lcp.zst`
- **Paper:** [When Fancy Eviction Fails: Rethinking Cache Replacement For LLM Prefix Reuse](https://arxiv.org/abs/2609.28870)

The traces carry per-block identity scoped across sessions, which is what prefix-cache eviction research needs and what existing public datasets are missing. If you are building an eviction algorithm, we would like to hear what you find.
