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

![A two-by-two grid with learning granularity (object vs. cache level) on one axis and prediction frequency (every miss vs. periodic) on the other. LRB, LHD, and 3L-Cache occupy object-level/every-miss. GL-Cache occupies object-level/periodic. ARC and LeCaR occupy cache-level/every-miss. The cache-level/periodic quadrant is the space explored by Learning-Augmented Heuristics.](lah-taxon.svg "Periodic, cache-level learning is the design point explored by Learning-Augmented Heuristics")

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

![The cache is split into a data plane, which handles GETs, PUTs, and evictions using the current heuristic configuration, and a control plane, which periodically collects workload statistics and uses a pre-trained model to update that configuration.](lah-data-control-plane.svg "The data plane stays fast and simple; the control plane runs periodically, off the critical path")

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

![Many training traces are each converted into cache-level features and paired with the best configuration found by grid search over that trace. These (feature, configuration) pairs from many workloads train a single model offline, which is then deployed to configure the heuristic on new, unseen workloads.](lah-offline-pretrain.svg "LAH trains once, offline, across many workloads, then deploys without retraining")

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
