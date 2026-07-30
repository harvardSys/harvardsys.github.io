+++
date = '2026-07-30T14:34:12-04:00'
draft = false
title = 'When Bursty Traffic Makes LLM Inference Faster'
author = 'Akira van de Groenendaal'
tags = ['LLM', 'systems', 'serving']
summary = 'Bursty arrivals usually cause a drop in performance and are seen as headaches in production systems. In this blog, we investigate a phenomenon where burstiness actually improves performance, uncovering what conditions produce this effect.'
+++

## Introduction

Bursty workloads have been giving computer scientists headaches for decades, and modern LLM serving is no different. Big bursts create instantaneous load and latency spikes, and there's a whole host of literature exploring how to deal with them.

The reason burstiness hurts, intuitively, is because we have the same mean arrival rate but requests are more likely to arrive very close together, or very far apart. To the server, it looks like it's getting flooded within a short window, followed by a dead period. The result is worse performance but the same long run utilization compared to a more regular workload.

So, when I was doing some routine vLLM benchmarking and found that as the arrivals got more bursty, latency decreased rather than increased, it was pretty surprising! Beyond contradicting standard intuition, this would have implications for how request routing should be done in production inference clusters. 

In this short blog, we'll explore the data that gives confidence to those results, but surfaces a confound that takes the project from the best thing since sliced bread to... the second best thing since sliced bread.
## Results: burstiness lowers latency

In this plot, we see that as the coefficient of variation of the interarrival times increases (more bursty), the median time per output token (TPOT) and end-to-end latency (E2EL) decrease. This was observed on both synthetic and realistic workloads, like ShareGPT and BurstGPT. Time to first token (TTFT) is much more config dependent, though we'd expect it to worsen due to the "clustering" of arrivals.

{{< figure src="images/tpot_latencies.svg" alt="Median TPOT vs CV" caption="Figure 1: Median/p90 TPOT and E2EL decrease ~50% between CV = 1 (Poisson process) and CV = 3.16 (very bursty arrivals) on BurstGPT. TTFT improves non-monotonically. Mean TPOT (not shown) improves 57% from 70 ms to 30 ms. Bands represent standard deviation across 6 replications at 1k requests." >}}

In fact, burstiness generally helps most of the distribution, sometimes slightly hurting the tail (Fig. 2). 

{{< figure src="images/tpot_ecdf.svg" alt="TPOT ECDF by CV" caption="Figure 2: TPOT estimated CDF on BurstGPT shows that burstier arrivals improve the whole distribution." >}}

The appendix includes far more results, spanning multiple models, GPUs, and datasets, increasing our confidence that this behavior generalizes.
### A familiar explanation

Loosely, higher burstiness means the gaps between arrivals are more weighted to very small or very large values. We can then picture getting a clump of arrivals, followed by a quiet period where the engine performs a bunch of decode without interruption. It follows that we should expect more iterations which are exclusively decode, but more importantly, that decode tokens get separated from large prefills.

This hypothesis is supported by the data, which follows the trend shown in Fig. 3: higher burstiness increases the fraction of tokens that are part of decode-only iterations.

{{< figure src="images/pct_decode_iters.svg" alt="Percent pure decode iters by CV" caption="Figure 3: The fraction of output tokens in a decode-only iteration increases by 16.8 percentage points at high burstiness. (Qwen3.5-9B | GH200 | BurstGPT)" >}}

Additionally, Fig. 4 confirms that prefills get compressed together, since we see that at high burstiness, mixed batches get larger and more prefill-heavy. 

{{< figure src="images/mixed_iter_comp.svg" alt="Mixed batch composition by CV" caption="Figure 4: Higher burstiness concentrates arrivals, leading to larger and prefill-dominant mixed batches. (Qwen3.5-9B | GH200 | BurstGPT)" >}}

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

{{< figure src="images/cost_per_decode_tok.svg" alt="Cost per decode token" caption="Figure 5: Each decode token is ~2x more expensive in a mixed batch, per iteration (Llama-3.1-8B, vLLM, A100). In attention alone, each decode token is 4x more expensive in a mixed batch." >}}

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

{{< figure src="images/fa2_vs_fa3.svg" alt="FA2 vs FA3" caption="Figure 6: Burstiness improves TPOT using flash attention 2, but the trend reverses with flash attention 3 on the same hardware and workload." >}}

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

{{< figure src="images/ols.svg" alt="Linear fit of iter time in terms of p and d tokens." caption="Figure A1: OLS fitting of iteration time vs prefill and decode token count. Each decode token is roughly 12x more expensive than each prefill token. gpu_forward_ms = 0.027829 * p_tokens + 0.340659 * d_tokens - 24.379055, with R-squared: 0.8462." >}}

Although the fit in Fig. A1 is poor, likely because it doesn't account for quadratic attention costs, the trend is still as expected. Intuitively, each decode token in a sequence also has at least as much "attention" to compute as the prefill tokens which preceded it. Note that the numbers used in previous calculations are directly from the data rather than what this model predicts. 

{{< figure src="images/router_tpot_ecdf.svg" alt="Sticky router TPOT ecdf" caption="Figure A2: TPOT ECDF comparing RR and JSQ to their sticky variants. In both cases, the variant improves the whole TPOT distribution." >}}

{{< figure src="images/router_ttft_ecdf.svg" alt="Sticky router TTFT ecdf" caption="Figure A3: TTFT ECDF comparing RR and JSQ to their sticky variants. The sticky router maintains a similar median TTFT but worsens the tail." >}}

<style>
/* Scoped to this post (this <style> only loads on this page).
   Center figure images; captions stay left-aligned (theme default). */
.prose figure img { margin-inline: auto; }
</style>
