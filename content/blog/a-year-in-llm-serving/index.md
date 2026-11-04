+++
title = 'A Year in LLM Serving: Workloads, Caching, and Routing'
date = 2026-10-12T00:00:00-05:00
author = 'William Nixon'
draft = false
tags = ['LLM', 'systems', 'serving', 'workloads', 'caching', 'load-balancing']
summary = 'An analysis of 6.12 billion production LLM requests, examining workload evolution, traffic patterns, prefix reuse, cache eviction, and request routing.'
+++

In our paper, [A Year in LLM Serving](https://arxiv.org/abs/2608.13573v2), we analyze **6.12 billion requests across 9,174 models and roughly 315,000 users**, collected from a full year of production traffic on [Chutes](https://chutes.ai/), from April 2025 to April 2026.

We characterize how LLM workloads evolve, examine model traffic and prefix reuse patterns, and evaluate their implications for KV-cache management and request routing.

Below, we summarize five key findings from our analysis.

## 1. Different models need different optimizations, and their workloads keep changing

Not all models behave the same way. MiniMax-M2.5, heavily used for coding and agentic tasks, typically receives long inputs but generates relatively short outputs. DeepSeek-R1, used for reasoning, tends to produce much longer responses.

These differences matter for serving systems. **Input-heavy workloads put more pressure on prefill, while output-heavy workloads spend more time decoding.** An optimization that works well for one model may be less effective for another.

![Measured cumulative distributions of input tokens, output tokens, and output-to-input ratio for representative models.](paper-token-profiles.png)
{caption="*Figure 1.* Different models have different input and output characteristics. MiniMax-M2.5 is more input-heavy, while DeepSeek-R1 generates longer outputs." panels="0,0,346,396; 346,0,331,396; 677,0,361,396"}

But even the same workloads don't stay the same over time. Across the year, median input lengths remained relatively stable, while median output lengths dropped from a few hundred tokens to below 100. Model popularity also shifted substantially, with traffic spreading across more models.

![Monthly input and output token distributions across the year.](paper-token-evolution.png)
{caption="*Figure 2.* Input lengths remain broadly stable, while output lengths become shorter over the year. Lines indicate medians; shaded regions show percentile ranges." panels="0,0,515,513; 515,0,531,513"}

**Implications:** Serving systems should adapt to both model-specific characteristics and changing workload patterns. Static optimizations tuned to today's popular models may become less effective as workloads evolve.

## 2. Model traffic comes in bursts, creating opportunities for GPU sharing

The dataset covers thousands of models, from popular public models to privately deployed fine-tuned models. We found that **most models exhibit bursty traffic**, with periods of intense activity followed by relatively quiet periods.

Interestingly, many models also show positive correlations between consecutive inter-arrival times. In other words, busy periods tend to remain busy, while quiet periods tend to persist.

![Model request rates, burstiness, and inter-arrival correlations.](paper-model-burstiness.png)
{caption="*Figure 3.* Most models exhibit uneven request arrivals, and many show correlated busy and quiet periods." panels="0,0,512,520; 512,0,596,520"}

**Implications:** These patterns create opportunities for model colocation. Rather than dedicating GPUs to models that may sit idle much of the time, serving systems could colocate models with complementary demand patterns to improve utilization. Understanding model popularity and burstiness can help guide placement and resource allocation.

## 3. Prefix reuse is often all-or-nothing, and most repeat requests arrive quickly

Prefix caching avoids recomputing previously processed prompts by retaining their KV-cache state. For workloads with long inputs, this can save substantial prefill computation.

We found something interesting: **requests often reuse almost their entire input prefix or almost none of it.** Partial reuse is much less common.

Reuse also differs substantially across models. MiniMax-M2.5 exhibits more reuse than the DeepSeek models in our analysis, consistent with coding and agentic workloads that repeatedly extend previous contexts.

![Distributions of cached-token fractions across requests and models.](paper-prefix-reuse.png)
{caption="*Figure 4.* Cache reuse is often close to either zero or complete reuse. The amount of reuse also differs across models and prompt lengths." panels="0,0,544,550; 544,0,535,550"}

Another important question is how long cached prefixes should stay in memory.

Looking at consecutive requests from the same user to the same model, we found that **approximately 50% arrive within 0.1 seconds, 80% within 10 seconds, and 99% within 15 minutes.**

![Distribution of time between consecutive requests from the same user to the same model.](paper-repeat-arrivals.png)
{caption="*Figure 5.* Repeat requests arrive quickly: approximately 50% within 0.1 seconds, 80% within 10 seconds, and 99% within 15 minutes. These are repeat arrivals, not guaranteed cache hits." size="medium"}

**Implications:** LLM workloads exhibit strong temporal locality. Short cache-retention windows can capture much of the potential reuse without keeping stale prefixes in memory for hours. Cache management should prioritize recently active prefixes rather than retaining everything indefinitely.

## 4. Simple cache eviction policies are surprisingly hard to beat

With limited GPU memory, serving systems must decide which cached prefixes to keep and which to evict. But how sophisticated does the eviction policy really need to be?

We simulated several eviction policies and found that **simple policies like FIFO and LRU often match or outperform more complex alternatives** in our evaluated workloads.

One possible explanation is the strong temporal locality we observed earlier. When most reuse happens shortly after a previous request, simple policies can already capture a large fraction of reusable prefixes.

![Simulated cache hit ratios across eviction policies and cache sizes.](paper-cache-policies.png)
{caption="*Figure 6.* FIFO and LRU are competitive with more sophisticated eviction policies across the evaluated workloads. The future-aware Belady oracle indicates the remaining room for improvement." panels="0,0,681,738; 681,0,698,738"}

**Implications:** FIFO and LRU are strong baselines for KV-cache eviction. However, a gap remains between these policies and the future-aware Belady oracle. Closing this gap may require richer workload information, such as user access patterns and session context, beyond simple recency or frequency.

## 5. A good cache policy isn't enough: request routing matters too

Even the best eviction policy cannot help if requests are sent to the wrong server.

In multi-instance serving, each server maintains its own KV cache. When related requests are routed to different servers, reusable prefixes may need to be recomputed and stored multiple times.

This creates an important tradeoff between **cache reuse and load balancing**.

We compare three routing approaches:

- **Round-robin and least-load routing** distribute requests across servers, but can reduce cache locality and cause cache duplication.
- **Sticky routing** keeps requests from the same session on one server, improving reuse but potentially creating load imbalance.
- **Cache-aware routing** sends requests to the server holding the largest reusable prefix, improving reuse at the cost of some load imbalance.

{{< diagram alt="Round robin, sticky routing, and cache-aware routing. Each color is a session; purple has the largest prefix, blue an intermediate one, yellow the smallest. Round robin spreads every request and duplicates prefixes on every server. Sticky routing pins each session to one server, leaving the load imbalanced. Cache-aware routing pins sessions to their cached prefixes but spreads the heavy purple session, replicating its shared prefix while distributing its branches." caption="*Figure 7.* Round-robin spreads every request. Sticky routing pins each session to one server. Cache-aware routing follows cached prefixes while allowing work to spread when needed for load balancing. This is an explanatory schematic." >}}
<style>
  .d-rt { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); text-align: center; color: #202623; }
  .d-rt-panel { padding: .25rem 1rem .5rem; }
  .d-rt-panel + .d-rt-panel { border-left: 1px solid #e5e7eb; }
  .d-rt-h { font-size: 1.125rem; font-weight: 600; }
  .d-rt-sub { margin-top: .2rem; font-size: .875rem; color: #4b5563; }
  .d-rt-out { margin-top: .6rem; font-size: .875rem; }
  .d-rt svg { width: 100%; height: auto; margin-top: .9rem; }
  .d-rt svg text { font-size: 18px; }
  .d-rt svg .req { font-size: 17px; }
  .d-rt .srv { fill: #fff; stroke: #9ca3af; stroke-width: 1.5; }
  .d-rt .r { fill: none; stroke-width: 2.3; }
  .d-rt .b { fill: #4c78a8; } .d-rt .sb { stroke: #4c78a8; }
  .d-rt .p { fill: #8b6bb1; } .d-rt .sp { stroke: #8b6bb1; }
  .d-rt .y { fill: #e7bd38; } .d-rt .sy { stroke: #e7bd38; }
  @container (max-width: 40rem) {
    .d-rt { grid-template-columns: 1fr; }
    .d-rt-panel { padding: 1.1rem 0 1rem; }
    .d-rt-panel:first-child { padding-top: 0; }
    .d-rt-panel + .d-rt-panel { border-left: 0; border-top: 1px solid #e5e7eb; }
    .d-rt svg { max-width: 18rem; margin-inline: auto; }
  }
</style>
<svg width="0" height="0" style="position: absolute" aria-hidden="true">
  <marker id="d-rt-ab" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#4c78a8"/></marker>
  <marker id="d-rt-ap" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#8b6bb1"/></marker>
  <marker id="d-rt-ay" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#e7bd38"/></marker>
</svg>
<div class="d-rt">
  <div class="d-rt-panel">
    <div class="d-rt-h">Round robin</div>
    <div class="d-rt-sub">Spread every request</div>
    <svg viewBox="20 120 360 354" aria-hidden="true">
      <text class="req" x="200" y="134" text-anchor="middle">Requests</text>
      <rect class="b" x="51" y="146" width="50" height="30" rx="4"/>
      <rect class="p" x="175" y="146" width="50" height="30" rx="4"/>
      <rect class="y" x="299" y="146" width="50" height="30" rx="4"/>
      <path class="r sb" d="M76 182 C76 207 60 217 60 244" marker-end="url(#d-rt-ab)"/>
      <path class="r sb" d="M76 182 C76 207 184 217 184 244" marker-end="url(#d-rt-ab)"/>
      <path class="r sb" d="M76 182 C76 207 308 217 308 244" marker-end="url(#d-rt-ab)"/>
      <path class="r sp" d="M200 182 C200 207 76 217 76 244" marker-end="url(#d-rt-ap)"/>
      <path class="r sp" d="M200 182 C200 207 200 217 200 244" marker-end="url(#d-rt-ap)"/>
      <path class="r sp" d="M200 182 C200 207 324 217 324 244" marker-end="url(#d-rt-ap)"/>
      <path class="r sy" d="M324 182 C324 207 92 217 92 244" marker-end="url(#d-rt-ay)"/>
      <path class="r sy" d="M324 182 C324 207 216 217 216 244" marker-end="url(#d-rt-ay)"/>
      <path class="r sy" d="M324 182 C324 207 340 217 340 244" marker-end="url(#d-rt-ay)"/>
      <rect class="srv" x="28" y="256" width="96" height="210" rx="5"/>
      <text x="76" y="282" text-anchor="middle">Server 1</text>
      <rect class="b" x="40" y="438" width="33" height="18" rx="2"/>
      <rect class="b" x="79" y="438" width="33" height="18" rx="2"/>
      <rect class="b" x="40" y="414" width="33" height="18" rx="2"/>
      <rect class="b" x="79" y="414" width="33" height="18" rx="2"/>
      <rect class="p" x="40" y="390" width="33" height="18" rx="2"/>
      <rect class="p" x="79" y="390" width="33" height="18" rx="2"/>
      <rect class="p" x="40" y="366" width="33" height="18" rx="2"/>
      <rect class="p" x="79" y="366" width="33" height="18" rx="2"/>
      <rect class="p" x="40" y="342" width="33" height="18" rx="2"/>
      <rect class="p" x="79" y="342" width="33" height="18" rx="2"/>
      <rect class="y" x="40" y="318" width="33" height="18" rx="2"/>
      <rect class="y" x="79" y="318" width="33" height="18" rx="2"/>
      <rect class="srv" x="152" y="256" width="96" height="210" rx="5"/>
      <text x="200" y="282" text-anchor="middle">Server 2</text>
      <rect class="b" x="164" y="438" width="33" height="18" rx="2"/>
      <rect class="b" x="203" y="438" width="33" height="18" rx="2"/>
      <rect class="b" x="164" y="414" width="33" height="18" rx="2"/>
      <rect class="b" x="203" y="414" width="33" height="18" rx="2"/>
      <rect class="p" x="164" y="390" width="33" height="18" rx="2"/>
      <rect class="p" x="203" y="390" width="33" height="18" rx="2"/>
      <rect class="p" x="164" y="366" width="33" height="18" rx="2"/>
      <rect class="p" x="203" y="366" width="33" height="18" rx="2"/>
      <rect class="p" x="164" y="342" width="33" height="18" rx="2"/>
      <rect class="p" x="203" y="342" width="33" height="18" rx="2"/>
      <rect class="y" x="164" y="318" width="33" height="18" rx="2"/>
      <rect class="y" x="203" y="318" width="33" height="18" rx="2"/>
      <rect class="srv" x="276" y="256" width="96" height="210" rx="5"/>
      <text x="324" y="282" text-anchor="middle">Server 3</text>
      <rect class="b" x="288" y="438" width="33" height="18" rx="2"/>
      <rect class="b" x="327" y="438" width="33" height="18" rx="2"/>
      <rect class="b" x="288" y="414" width="33" height="18" rx="2"/>
      <rect class="b" x="327" y="414" width="33" height="18" rx="2"/>
      <rect class="p" x="288" y="390" width="33" height="18" rx="2"/>
      <rect class="p" x="327" y="390" width="33" height="18" rx="2"/>
      <rect class="p" x="288" y="366" width="33" height="18" rx="2"/>
      <rect class="p" x="327" y="366" width="33" height="18" rx="2"/>
      <rect class="p" x="288" y="342" width="33" height="18" rx="2"/>
      <rect class="p" x="327" y="342" width="33" height="18" rx="2"/>
      <rect class="y" x="288" y="318" width="33" height="18" rx="2"/>
      <rect class="y" x="327" y="318" width="33" height="18" rx="2"/>
    </svg>
    <div class="d-rt-out">Duplication &middot; lower hit rate</div>
  </div>
  <div class="d-rt-panel">
    <div class="d-rt-h">Sticky routing</div>
    <div class="d-rt-sub">Pin every session</div>
    <svg viewBox="20 120 360 354" aria-hidden="true">
      <text class="req" x="200" y="134" text-anchor="middle">Requests</text>
      <rect class="b" x="51" y="146" width="50" height="30" rx="4"/>
      <rect class="p" x="175" y="146" width="50" height="30" rx="4"/>
      <rect class="y" x="299" y="146" width="50" height="30" rx="4"/>
      <path class="r sb" d="M76 182 C76 207 76 217 76 244" marker-end="url(#d-rt-ab)"/>
      <path class="r sp" d="M200 182 C200 207 200 217 200 244" marker-end="url(#d-rt-ap)"/>
      <path class="r sy" d="M324 182 C324 207 324 217 324 244" marker-end="url(#d-rt-ay)"/>
      <rect class="srv" x="28" y="256" width="96" height="210" rx="5"/>
      <text x="76" y="282" text-anchor="middle">Server 1</text>
      <rect class="b" x="40" y="438" width="33" height="18" rx="2"/>
      <rect class="b" x="79" y="438" width="33" height="18" rx="2"/>
      <rect class="b" x="40" y="414" width="33" height="18" rx="2"/>
      <rect class="b" x="79" y="414" width="33" height="18" rx="2"/>
      <rect class="srv" x="152" y="256" width="96" height="210" rx="5"/>
      <text x="200" y="282" text-anchor="middle">Server 2</text>
      <rect class="p" x="164" y="438" width="33" height="18" rx="2"/>
      <rect class="p" x="203" y="438" width="33" height="18" rx="2"/>
      <rect class="p" x="164" y="414" width="33" height="18" rx="2"/>
      <rect class="p" x="203" y="414" width="33" height="18" rx="2"/>
      <rect class="p" x="164" y="390" width="33" height="18" rx="2"/>
      <rect class="p" x="203" y="390" width="33" height="18" rx="2"/>
      <rect class="srv" x="276" y="256" width="96" height="210" rx="5"/>
      <text x="324" y="282" text-anchor="middle">Server 3</text>
      <rect class="y" x="288" y="438" width="33" height="18" rx="2"/>
      <rect class="y" x="327" y="438" width="33" height="18" rx="2"/>
    </svg>
    <div class="d-rt-out">Load imbalance</div>
  </div>
  <div class="d-rt-panel">
    <div class="d-rt-h">Cache-aware routing</div>
    <div class="d-rt-sub">Pin, but spread on load imbalance</div>
    <svg viewBox="20 120 360 354" aria-hidden="true">
      <text class="req" x="200" y="134" text-anchor="middle">Requests</text>
      <rect class="b" x="51" y="146" width="50" height="30" rx="4"/>
      <rect class="p" x="175" y="146" width="50" height="30" rx="4"/>
      <rect class="y" x="299" y="146" width="50" height="30" rx="4"/>
      <path class="r sb" d="M76 182 C76 207 62 217 62 244" marker-end="url(#d-rt-ab)"/>
      <path class="r sp" d="M200 182 C200 207 90 217 90 244" marker-end="url(#d-rt-ap)"/>
      <path class="r sp" d="M200 182 C200 207 200 217 200 244" marker-end="url(#d-rt-ap)"/>
      <path class="r sp" d="M200 182 C200 207 310 217 310 244" marker-end="url(#d-rt-ap)"/>
      <path class="r sy" d="M324 182 C324 207 338 217 338 244" marker-end="url(#d-rt-ay)"/>
      <rect class="srv" x="28" y="256" width="96" height="210" rx="5"/>
      <text x="76" y="282" text-anchor="middle">Server 1</text>
      <rect class="b" x="40" y="438" width="33" height="18" rx="2"/>
      <rect class="b" x="79" y="438" width="33" height="18" rx="2"/>
      <rect class="b" x="40" y="414" width="33" height="18" rx="2"/>
      <rect class="b" x="79" y="414" width="33" height="18" rx="2"/>
      <rect class="p" x="40" y="390" width="33" height="18" rx="2"/>
      <rect class="p" x="79" y="390" width="33" height="18" rx="2"/>
      <rect class="p" x="40" y="366" width="33" height="18" rx="2"/>
      <rect class="p" x="79" y="366" width="33" height="18" rx="2"/>
      <rect class="srv" x="152" y="256" width="96" height="210" rx="5"/>
      <text x="200" y="282" text-anchor="middle">Server 2</text>
      <rect class="p" x="164" y="438" width="33" height="18" rx="2"/>
      <rect class="p" x="203" y="438" width="33" height="18" rx="2"/>
      <rect class="p" x="164" y="414" width="33" height="18" rx="2"/>
      <rect class="srv" x="276" y="256" width="96" height="210" rx="5"/>
      <text x="324" y="282" text-anchor="middle">Server 3</text>
      <rect class="y" x="288" y="438" width="33" height="18" rx="2"/>
      <rect class="y" x="327" y="438" width="33" height="18" rx="2"/>
      <rect class="p" x="288" y="414" width="33" height="18" rx="2"/>
      <rect class="p" x="327" y="414" width="33" height="18" rx="2"/>
      <rect class="p" x="288" y="390" width="33" height="18" rx="2"/>
    </svg>
    <div class="d-rt-out">Reuse with selective spreading</div>
  </div>

</div>
{{< /diagram >}}

We evaluated these approaches using fleet-level simulations of production workloads.

**Cache-aware routing consistently improves cache reuse and reduces session spread**, meaning fewer servers need to handle requests from the same session. The tradeoff is a modest increase in load imbalance compared with routing strategies focused purely on distributing requests.

Another interesting finding is that **increasing cache capacity alone does not guarantee better reuse**. If requests keep arriving at servers that don't hold their prefixes, extra cache space may do little to help.

![Fleet simulations comparing routing strategies across cache sizes and fleet configurations.](paper-routing-results.png)
{caption="*Figure 8.* Cache-aware routing achieves higher cache hit ratios and reduces session spread, with a modest increase in load imbalance." size="wide" panels="555,31,525,31; 1110,31,525,31; 0,95,535,980; 535,95,552,980; 1087,95,523,980; 1610,95,536,980"}

**Implications:** Cache management and request routing should be optimized together. Increasing cache capacity or improving eviction alone may not be enough; serving systems must also route requests toward reusable prefixes while keeping the fleet reasonably balanced.

## Paper and Dataset

This is part of our ongoing effort to release real-world LLM serving datasets through [FreeInference Open Data](https://data.freeinference.org/), covering production request traces, agentic workloads, and GPU telemetry.

We've made the full one-year Chutes trace, paper, and analysis code publicly available:

- **Paper:** [A Year in LLM Serving](https://arxiv.org/abs/2608.13573v2)
- **Code and analysis:** [GitHub repository](https://github.com/HarvardMadSys/chutes_workload)
- **Download dataset:** [Hugging Face](https://huggingface.co/datasets/harvardMadsys/chutes_metadata)

Feel free to check out this dataset and our other releases! We hope they'll be useful for your own research, and we'd love to see what you build with them.