+++
title = 'Learning-Augmented Heuristics: A Different Way to Build Smart Caches'
date = 2026-08-14T00:00:00-05:00
author = 'William Nixon'
draft = false
tags = ['caching', 'systems', 'machine-learning', 'S3-FIFO']
summary = 'Smart cache eviction algorithms can adapt to workloads, but they often pay for it with complexity, instability, or overhead. Learning-Augmented Heuristics takes a different approach: keep the fast heuristic on the data path, and use learning to configure it at a slower timescale.'
bio = 'William is a 2nd-year PhD student in Computer Science at the University of Chicago, advised by Prof. Haryadi S. Gunawi and Prof. Juncheng Yang. He works on systems and machine learning, with a focus on caching and storage.'
+++

Cache eviction research has produced many "smart" eviction policies such as ARC, LeCaR, LRB, LHD, GL-Cache, and 3L-Cache. Many of these policies incorporate machine learning or online adaptation to respond to workload behavior, and can outperform traditional heuristics in miss ratio.

Yet despite their promise in efficiency, production caches still largely rely on static heuristics such as LRU, 2Q, and FIFO variants.

That gap is interesting. If smart caches can achieve better miss ratios, why
have they seen so little adoption? 

In our OSDI '26 paper, we explore a different way to incorporate machine learning into cache eviction. We call this design Learning-Augmented Heuristics (LAH): keep a simple heuristic on the request path, and use learning to configure that heuristic for a particular workload.

## Why haven't smart caches taken over?

A cache eviction algorithm sits directly on the request path, so miss ratio is only one part of the design. A practical policy must also have low overhead, remain robust across workloads, be simple to implement, and behave predictably when performance degrades.

Adaptive eviction is attractive because workloads can have very different access patterns. A static policy applies the same rules to all workloads, while an adaptive policy can adjust its behavior to better match the workload.

The challenge is that many existing adaptive caches couple learning closely with eviction decisions. This can provide fine-grained adaptivity, but it also introduces additional computation and state on the critical path.

ML-based algorithms like LRB and 3L-Cache, for example, operate at the **object level**. A machine-learning model estimates reuse information for individual objects, and these predictions are used to make eviction decisions. This requires maintaining object-level features and performing model inference during eviction, increasing both metadata overhead and critical-path computation.

Object-level prediction can also make poor decisions harder to diagnose. When performance degrades, the model may indicate that one object is more likely to be reused than another, but it is difficult to relate these individual predictions to a clear property of the workload. 

Other adaptive caches operate at a coarser **cache level**, where adaptation changes the behavior of the cache as a whole rather than predicting reuse for individual objects. For example, ARC adjusts the relative sizes of its queues, while LeCaR changes the weights assigned to different eviction policies. These decisions are easier to interpret because they correspond to global policy settings rather than per-object predictions.

However, cache-level adaptation can still happen very frequently, sometimes on every cache miss. This can be problematic because short-term cache behavior is noisy. In our measurements, miss ratio varies much more over short windows than over longer ones, so frequent updates may react to transient fluctuations rather than meaningful workload changes.

This creates a tradeoff. Learning provides adaptivity, but tightly coupling it with fine-grained eviction decisions can increase overhead, reduce stability, and make the policy harder to reason about.

**Learning-Augmented Heuristics** explores an alternative design in which learning operates at a slower timescale and configures the eviction heuristic rather than replacing it.

## A useful way to look at the design space

We found it helpful to organize smart caches along two axes:
- **Learning granularity:** does the algorithm reason about individual objects,
  or about the cache as a whole?
- **Prediction frequency:** does it adapt on every miss, or only periodically?

That gives a simple two-by-two view of the space:

{{< diagram size="small" alt="A two-by-two grid with learning objective (object vs. cache level) on one axis and prediction frequency (every miss vs. periodic) on the other. LRB, LHD, and 3L-Cache occupy object-level/every-miss. GL-Cache occupies object-level/periodic. ARC and LeCaR occupy cache-level/every-miss. The cache-level/periodic quadrant is the space explored by Learning-Augmented Heuristics (S4-FIFO)." caption="Periodic, cache-level learning is the design point explored by Learning-Augmented Heuristics" >}}
<style>
  .d-tx { --tx-teal: #4f8c8d; --tx-purple: #7a5a8c;
          display: grid; grid-template-columns: 1.9rem 1fr 1fr 1.9rem; text-align: center; color: #000; }
  .d-tx-c { padding-bottom: .45rem; font-size: 1.0625rem; font-weight: 700; }
  .d-tx-cell { display: flex; align-items: center; justify-content: center; aspect-ratio: 1 / .95;
               padding: .5rem; background: #f3f3f3; border: solid #000; border-width: 0 1.5px 1.5px 0;
               font-size: 1.0625rem; line-height: 1.3; }
  .d-tx-cell.top { border-top-width: 1.5px; }
  .d-tx-cell.left { border-left-width: 1.5px; }
  .d-tx-cell.lah { font-weight: 700; }
  .d-tx-axis { font-size: 1.1875rem; }
  .d-tx-v { writing-mode: vertical-rl; transform: rotate(180deg); }
  .d-tx-y { grid-row: 2 / 4; padding-left: .3rem; }
  .d-tx-x { grid-column: 2 / 4; padding-top: .5rem; }
  .d-tx-r { padding-right: .3rem; font-size: 1rem; font-weight: 700; }
</style>
<div class="d-tx">
  <span></span><span class="d-tx-c" style="color: var(--tx-teal)">Every miss</span><span class="d-tx-c" style="color: var(--tx-purple)">Periodic</span><span></span>
  <span class="d-tx-axis d-tx-v d-tx-y">Learning objective</span>
  <span class="d-tx-cell top left">ARC<br>LeCaR</span>
  <span class="d-tx-cell top lah">Learning-Augmented Heuristics (S4-FIFO)</span>
  <span class="d-tx-v d-tx-r" style="color: var(--tx-purple)">Cache level</span>
  <span class="d-tx-cell left">LRB<br>LHD<br>3L-Cache</span>
  <span class="d-tx-cell">GL-Cache</span>
  <span class="d-tx-v d-tx-r" style="color: var(--tx-teal)">Object level</span>
  <span></span><span class="d-tx-axis d-tx-x">Prediction frequency</span>
</div>
{{< /diagram >}}

Most prior work occupies three of these four regions. LAH focuses on the fourth: periodic, cache-level learning. At this granularity, the model can reason about aggregate workload behavior without participating in every eviction decision.

## Learning-Augmented Heuristics

The core idea is to learn the configuration of a heuristic rather than replace the heuristic itself. 

Simple cache policies are often more configurable than they first appear. FIFO- and LRU-based designs may expose queue sizes, admission rules, promotion thresholds, ghost-cache sizes, or other parameters. Different settings can make the same heuristic behave very differently across workloads. In practice, these parameters are often fixed or manually tuned.

This suggests a different role for learning: if the heuristic is already
expressive enough, let the model choose its parameters.

Start with a fast, deterministic cache algorithm with a small number of
meaningful knobs. Let the cache collect lightweight aggregate statistics about
the workload, then use a pre-trained model to choose a
configuration for those knobs asynchronously.

{{< diagram alt="The cache is split into a data plane, which handles GETs, PUTs, and evictions using the current heuristic configuration, and a control plane, which periodically collects workload statistics and uses a pre-trained model to update that configuration. In the data plane, a lightweight sketch feeds a feature collector; exported features become a feature vector in the control plane, model inference turns it into predicted knobs, and those are applied back to the parameterized cache." caption="The data plane stays fast and simple; the control plane runs periodically, off the critical path" >}}
<style>
  .d-dc { --dc-teal: #216b64; --dc-teal-2: #3f7f79; --dc-pur: #4e2a73; --dc-pur-2: #7a3fa0; --dc-m: 1.4rem;
          display: grid; grid-template-columns: minmax(0, 1fr) 8.5rem minmax(0, 1fr);
          grid-template-rows: auto auto 5.75rem auto; color: #1b2430; }
  .d-dc-bg { border-radius: .6rem; }
  .d-dc-bg.data { grid-area: 1 / 1 / 5 / 2; background: #e9f4f2; }
  .d-dc-bg.ctrl { grid-area: 1 / 3 / 5 / 4; background: #f2ecf8; }
  .d-dc-t { padding: 1.1rem var(--dc-m) 1rem; font-size: .9375rem; font-weight: 700; line-height: 1.3; }
  .d-dc-t b { display: block; font-size: 1.0625rem; letter-spacing: .03em; }
  .d-dc-t.data { grid-area: 1 / 1; color: var(--dc-teal); }
  .d-dc-t.ctrl { grid-area: 1 / 3; color: var(--dc-pur); }
  .d-dc-box { display: flex; align-items: center; justify-content: center; min-height: 4.25rem; margin: 0 var(--dc-m);
              padding: .6rem .75rem; background: #fff; border: 2px solid var(--dc-teal); border-radius: .5rem;
              font-size: 1.0625rem; font-weight: 700; line-height: 1.3; text-align: center; }
  .d-dc-box.cache { grid-area: 2 / 1; }
  .d-dc-box.coll { grid-area: 4 / 1; }
  .d-dc-box.knobs { grid-area: 2 / 3; border-color: var(--dc-pur-2); }
  .d-dc-box.fvec { grid-area: 4 / 3; border-color: var(--dc-pur-2); }
  .d-dc-box.coll, .d-dc-box.fvec, .d-dc-a.export { margin-bottom: var(--dc-m); }
  /* Solid arrows between the planes */
  .d-dc-a { position: relative; align-self: center; height: 2px; margin-inline: calc(-1 * var(--dc-m)); background: currentColor; }
  .d-dc-a::after { content: ""; position: absolute; top: 50%; right: -2px; transform: translateY(-50%);
                   border: 6px solid transparent; border-left: 11px solid currentColor; border-right: 0; }
  .d-dc-a.apply::after { right: auto; left: -2px; border-left: 0; border-right: 11px solid currentColor; }
  .d-dc-a span { position: absolute; bottom: .45rem; left: 0; right: 0; font-size: .875rem; font-weight: 700; line-height: 1.25; text-align: center; }
  .d-dc-a.apply { grid-area: 2 / 2; color: var(--dc-pur); }
  .d-dc-a.export { grid-area: 4 / 2; color: var(--dc-teal); }
  /* Dotted arrows inside a plane */
  .d-dc-v { position: relative; display: flex; justify-content: center; font-size: .875rem; font-weight: 700; line-height: 1.25; }
  .d-dc-v i { position: relative; margin: .35rem 0; border-left: 3px dotted currentColor; }
  .d-dc-v i::after { content: ""; position: absolute; left: -7.5px; border: 6px solid transparent; }
  .d-dc-v.down i::after { bottom: -6px; border-top: 10px solid currentColor; border-bottom: 0; }
  .d-dc-v.up i::after { top: -6px; border-bottom: 10px solid currentColor; border-top: 0; }
  .d-dc-v .l, .d-dc-v .r { position: absolute; top: 50%; transform: translateY(-50%); }
  .d-dc-v .l { right: calc(50% + 1rem); text-align: right; }
  .d-dc-v .r { left: calc(50% + 1rem); text-align: left; }
  .d-dc-v.sketch { grid-area: 3 / 1; color: var(--dc-teal-2); }
  .d-dc-v.infer { grid-area: 3 / 3; color: var(--dc-pur-2); }
  .d-dc-v svg { width: 4.25rem; }
  .d-dc-loop { display: none; }

  /* Narrow: stack the planes and draw "apply params" as a return bracket on the right. */
  @container (max-width: 38rem) {
    .d-dc { --dc-m: 1rem; grid-template-columns: minmax(0, 1fr) 2.6rem;
            grid-template-rows: auto auto 4.25rem auto 4.5rem auto auto 4.25rem auto; }
    .d-dc-bg.data { grid-area: 1 / 1 / 5 / 2; }
    .d-dc-bg.ctrl { grid-area: 6 / 1 / 10 / 2; }
    .d-dc-t { padding: .9rem var(--dc-m) .8rem; }
    .d-dc-t.ctrl { grid-area: 6 / 1; }
    .d-dc-box { min-height: 3.5rem; font-size: 1rem; }
    .d-dc-box.fvec { grid-area: 7 / 1; margin-bottom: 0; }
    .d-dc-box.knobs { grid-area: 9 / 1; margin-bottom: var(--dc-m); }
    .d-dc-v.infer { grid-area: 8 / 1; }
    .d-dc-v.infer.up i::after { top: auto; bottom: -6px; border-top: 10px solid currentColor; border-bottom: 0; }
    .d-dc-a.export { grid-area: 5 / 1; justify-self: center; align-self: stretch; width: 2px; height: auto; margin: .4rem 0; }
    .d-dc-a.export::after { top: auto; bottom: -2px; right: auto; left: 50%; transform: translateX(-50%);
                            border: 6px solid transparent; border-top: 11px solid currentColor; border-bottom: 0; }
    .d-dc-a.export span { bottom: auto; top: 50%; left: 1rem; right: auto; transform: translateY(-50%); white-space: nowrap; text-align: left; }
    .d-dc-a.apply { display: none; }
    .d-dc-loop { display: block; position: relative; grid-area: 2 / 2 / 10 / 3; margin: 1.75rem .9rem 2.75rem calc(-1 * var(--dc-m));
                 border: 2px solid var(--dc-pur); border-left: 0; border-radius: 0 .6rem .6rem 0; color: var(--dc-pur); }
    .d-dc-loop::after { content: ""; position: absolute; top: -7px; left: -2px; border: 6px solid transparent; border-right: 11px solid currentColor; border-left: 0; }
    .d-dc-loop span { position: absolute; top: 50%; left: 100%; transform: translate(-50%, -50%) rotate(180deg); padding: .4rem 0;
                      writing-mode: vertical-rl; background: #fff; font-size: .875rem; font-weight: 700; white-space: nowrap; }
  }
</style>
<div class="d-dc">
  <div class="d-dc-bg data"></div>
  <div class="d-dc-bg ctrl"></div>
  <div class="d-dc-t data"><b>DATA PLANE</b>Online, Simple, O(1)</div>
  <div class="d-dc-t ctrl"><b>CONTROL PLANE</b>Async, Periodic</div>
  <div class="d-dc-box cache">Parameterized cache (Heuristic)</div>
  <div class="d-dc-v down sketch"><i></i><span class="l">Lightweight<br>Sketch</span></div>
  <div class="d-dc-box coll">Feature Collector</div>
  <div class="d-dc-a export"><span>Export<br>Features</span></div>
  <div class="d-dc-box fvec">Feature Vector</div>
  <div class="d-dc-v up infer">
    <span class="l"><svg viewBox="0 0 68 46" aria-hidden="true"><g fill="#fff" stroke="#6b7280" stroke-width="1.3"><path d="M34 8 L20 22 M34 8 L48 22 M20 22 L11 37 M20 22 L29 37 M48 22 L41 37 M48 22 L57 37" fill="none"/><circle cx="34" cy="7" r="5"/><circle cx="20" cy="22" r="5"/><circle cx="48" cy="22" r="5"/><circle cx="11" cy="38" r="5"/><circle cx="29" cy="38" r="5" fill="#4a7fc1"/><circle cx="41" cy="38" r="5"/><circle cx="57" cy="38" r="5"/></g></svg></span>
    <i></i><span class="r">Model<br>Inference</span>
  </div>
  <div class="d-dc-box knobs">Predicted Knobs</div>
  <div class="d-dc-a apply"><span>Apply<br>Params</span></div>
  <div class="d-dc-loop"><span>Apply Params</span></div>
</div>
{{< /diagram >}}

This naturally separates the system into a **data plane** and a **control
plane**.

The **data plane** remains simple and online. Cache operations stay O(1), and
no model inference is required for an individual request.

The **control plane** runs much less frequently. It takes a compact description
of the workload, runs the model asynchronously, and updates a small number of
cache parameters.

That separation is important as model inference no longer needs to run for individual requests, while the model's outputs remain concrete parameters with direct meaning inside the cache.

## Learning from many workloads once

Unlike prior work that learns online, LAH moves most of the expensive learning
work offline. Because we are learning at the cache level, we can train a single
model on many workloads and then deploy it to new workloads without retraining.

For each training trace, we collect its cache-level features, sweep parameter
configurations, measure the resulting miss ratios, and identify the configurations
that work well. Those best-performing configurations become labels, which we pair
with the features collected from the same workload.

{{< diagram alt="Many training traces are each converted into cache-level features and paired with the best configuration found by grid search over that trace. These (feature, configuration) pairs from many workloads train a single model offline, which is then deployed to configure the heuristic on new, unseen workloads. Steps: production traces (4140 from 14 sources), parameter grid search with miss ratio as the label, and a training corpus that serves as the knowledge base." caption="LAH trains once, offline, across many workloads, then deploys without retraining" >}}
<style>
  .d-pt { display: grid; grid-template-columns: minmax(0, 1fr) 2.75rem minmax(0, 1fr) 2.75rem minmax(0, 1fr);
          row-gap: 1.25rem; align-items: center; color: #1b2430; }
  .d-pt-box { display: flex; flex-direction: column; justify-content: center; align-self: stretch; min-height: 7rem;
              padding: .75rem; border: 2px solid #7a5f96; border-radius: .6rem; text-align: center; }
  .d-pt-box b { font-size: 1.25rem; line-height: 1.2; }
  .d-pt-box span { margin-top: .2rem; font-size: 1rem; color: #6b7785; }
  .d-pt-arr { position: relative; height: 2px; margin: 0 .45rem; background: #4e2a73; }
  .d-pt-arr::after { content: ""; position: absolute; top: 50%; right: -2px; transform: translateY(-50%);
                     border: 6px solid transparent; border-left: 11px solid #4e2a73; border-right: 0; }
  .d-pt-ic { grid-row: 2; justify-self: center; position: relative; font-size: .8125rem; }
  .d-pt-ic:nth-of-type(1) { grid-column: 1; } .d-pt-ic:nth-of-type(2) { grid-column: 3; } .d-pt-ic:nth-of-type(3) { grid-column: 5; }
  .d-pt-stack { width: 12em; height: 6em; }
  .d-pt-stack > div { position: absolute; display: flex; }
  .d-pt-stack span { display: block; padding: .3em .6em; border: 1px solid #8d9298; background: #eee;
                     box-shadow: 2px 2px 3px rgb(0 0 0 / .3); white-space: nowrap; line-height: 1.3; }
  .d-pt-stack .mr { background: #e06666; border-color: #b84a4a; color: #fff; }
  .d-pt-ic.traces span { width: 8.5em; text-align: center; }
  .d-pt-ic.grid { width: 14em; }
  .d-pt-ic.grid span:first-child { width: 7.5em; }
  .d-pt-ic svg { display: block; width: 4.5em; height: auto; }
  @container (max-width: 38rem) {
    .d-pt { grid-template-columns: minmax(0, 1fr) auto; row-gap: 0; column-gap: .9rem; }
    .d-pt-box { min-height: 5rem; }
    .d-pt-box b { font-size: 1.0625rem; }
    .d-pt-box span { font-size: .875rem; }
    .d-pt-arr { grid-column: 1; justify-self: center; width: 2px; height: 2rem; margin: .4rem 0 .5rem; }
    .d-pt-arr::after { top: auto; bottom: -2px; right: auto; left: 50%; transform: translateX(-50%);
                       border: 6px solid transparent; border-top: 11px solid #4e2a73; border-bottom: 0; }
    .d-pt-ic { grid-row: auto; font-size: .625rem; }
    .d-pt-ic:nth-of-type(1) { grid-area: 1 / 2; } .d-pt-ic:nth-of-type(2) { grid-area: 3 / 2; } .d-pt-ic:nth-of-type(3) { grid-area: 5 / 2; }
    .d-pt-box:nth-of-type(1) { grid-area: 1 / 1; } .d-pt-box:nth-of-type(2) { grid-area: 3 / 1; } .d-pt-box:nth-of-type(3) { grid-area: 5 / 1; }
    .d-pt-arr:nth-of-type(1) { grid-area: 2 / 1; } .d-pt-arr:nth-of-type(2) { grid-area: 4 / 1; }
    .d-pt-ic.traces { width: 11em; }
    .d-pt-ic.grid { width: 13.5em; }
    .d-pt-ic.db { width: 11em; display: flex; justify-content: center; }
  }
</style>
<div class="d-pt">
  <div class="d-pt-box"><b>Production traces</b><span>4140 from 14 sources</span></div>
  <i class="d-pt-arr"></i>
  <div class="d-pt-box"><b>Parameter Grid Search</b><span>Miss Ratio as Label</span></div>
  <i class="d-pt-arr"></i>
  <div class="d-pt-box"><b>Training Corpus</b><span>Knowledge Base</span></div>
  <section class="d-pt-ic d-pt-stack traces" aria-hidden="true">
    <div style="left: 2em; top: 0"><span>Tencent Block</span></div>
    <div style="left: 1em; top: 1.6em"><span>Twitter</span></div>
    <div style="left: 0; top: 3.2em"><span>Meta CDN</span></div>
  </section>
  <section class="d-pt-ic d-pt-stack grid" aria-hidden="true">
    <div style="left: 2em; top: 0"><span>params set N</span><span class="mr">MR N</span></div>
    <div style="left: 1em; top: 1.6em"><span>params set 2</span><span class="mr">MR 2</span></div>
    <div style="left: 0; top: 3.2em"><span>params set 1</span><span class="mr">MR 1</span></div>
  </section>
  <section class="d-pt-ic db" aria-hidden="true">
    <svg viewBox="0 0 60 56"><g fill="none" stroke="#000" stroke-width="4"><rect x="4" y="3" width="52" height="15" rx="7.5"/><rect x="4" y="21" width="52" height="15" rx="7.5"/><rect x="4" y="39" width="52" height="15" rx="7.5"/></g><g fill="#000"><circle cx="45" cy="10.5" r="2.6"/><circle cx="45" cy="28.5" r="2.6"/><circle cx="45" cy="46.5" r="2.6"/></g></svg>
  </section>
</div>
{{< /diagram >}}

Because the features describe access patterns rather than object identities, the
same model can accumulate knowledge across different workloads.
Instead of learning object-level information specific to the low-level details of
a workload, the model learns to recognize patterns in access behavior that are
common across workloads. Patterns such as scanning, burstiness, long-term reuse,
and thrashing appear in many workloads even when the objects themselves are
completely unrelated.

## S4-FIFO: putting LAH into a real cache

We apply LAH to S3-FIFO, a FIFO-based eviction heuristic. S3-FIFO uses a small FIFO to filter new objects and one-hit wonders, a main FIFO to retain objects with stronger reuse, and a metadata-only ghost FIFO to remember recently evicted objects.

This structure exposes several meaningful parameters, such as queue sizes and the number of hits required before an object is promoted. These settings control S3-FIFO’s behavior, such as how aggressively it filters objects. Instead of hand-tuning them for each workload, LAH learns to select the settings automatically.

Our implementation, S4-FIFO, summarizes workload behavior mainly through hit-position histograms. We divide the small, main, and ghost queues into bins and record where hits occur. These features give the model a compact view of how requests interact with different regions of the cache without requiring per-object prediction.

## Does this actually help?

We evaluate S4-FIFO along four dimensions: efficiency, robustness, throughput,
and interpretability.

**Efficiency.** At the large cache size, S4-FIFO improves mean miss-ratio
reduction by **26% over S3-FIFO** and **8% over 3L-Cache**, the strongest prior
algorithm in our comparison. In other words, a well-configured heuristic can
outperform more complex learned eviction policies.

**Robustness.** On its worst evaluated trace, S4-FIFO increases FIFO's miss
ratio by only **0.8%**, compared with **8.8% for 3L-Cache**. Importantly, learning improves the robustness of the S3-FIFO heuristic rather than making it more fragile: tuning its parameters reduces bad worst-case behavior while still improving average efficiency.

**Throughput.** S4-FIFO's Cachelib implementation achieves throughput comparable
to conventional heuristics such as S3-FIFO, LRU, and 2Q. Feature collection is
lightweight, and model inference runs infrequently and asynchronously outside
the request-serving critical path.

**Interpretability.** Both the model's inputs and outputs have direct operational
meaning. Cache level features such as hit-position histograms show where accesses are being served, while the model outputs concrete settings such as queue sizes and promotion thresholds. This makes it much easier to understand why a particular configuration was chosen and how it changes cache behavior.

## Takeaway

S4-FIFO is one instance of Learning-Augmented Heuristics, but the idea can extend to other eviction heuristics: keep the fast heuristic on the data path, and use learning to configure it for the workload.

More broadly, ML in systems does not always need to replace or compete with existing mechanisms. It can instead supplement them, adding adaptivity while preserving the properties that make them practical.

Code, the pre-trained model, and the libCacheSim and Cachelib implementations are
available at [libcachesim.com](https://libcachesim.com) and
[github.com/cacheMon/osdi26-s4-fifo](https://github.com/cacheMon/osdi26-s4-fifo).

[^s4fifo]: Haocheng Xia, William Nixon, Bintang Dwi Marthen, Pranav Bhandari,
    and Juncheng Yang. "Learning-Augmented Heuristics: Simple yet Smart, Robust
    and Interpretable Cache Eviction." In Proceedings of the 20th USENIX
    Symposium on Operating Systems Design and Implementation (OSDI '26), 2026.

[^s3fifo]: Juncheng Yang, Yazhuo Zhang, Ziyue Qiu, Yao Yue, and K. V. Rashmi.
    "FIFO queues are all you need for cache eviction." In Proceedings of the
    29th ACM Symposium on Operating Systems Principles (SOSP '23), 2023.
