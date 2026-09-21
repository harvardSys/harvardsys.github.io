+++
title = 'H-Spec: Parallel Speculative Decoding Without A Drafter-Side KV Cache'
date = 2026-09-21T15:00:00-04:00
eventTime = 2026-09-22T12:45:00-04:00
speaker = 'Weifan Jiang (Harvard University)'
location = "SEC 4.307 & 4.308"
summary = "Speculative decoding accelerates LLM inference with a lightweight draft model, but block diffusion drafters pay per-request memory and KV-write overhead for a separate drafter-side KV cache that grows with concurrency. Weifan will present H-Spec, a hybrid Mamba-attention parallel drafter that reuses target KVs in place and injects target hidden states only at the last input position, removing the drafter-side cache while preserving draft quality."
draft = false
+++

## Abstract

Speculative decoding losslessly accelerates large language model inference by having a lightweight draft model predict future tokens for verification by the target model. Recent block diffusion drafters further reduce drafting latency by predicting multiple tokens in parallel. However, existing block drafters project target hidden states at every input position into a separate drafter-side KV cache, incurring per-request memory and KV-write overhead that grow with concurrency; directly reusing target KVs in place removes this cache but fails to sustain draft quality throughout the block.

We propose a hybrid target-context injection method that complements direct target KV reuse with target hidden states only at the last input position, requiring no separate drafter-side KV cache. Building on this design, we propose H-Spec, a hybrid Mamba-attention parallel drafter that consumes the two target-context sources through complementary modules. Mamba modules are initialized with projected last-token target hidden states, while attention modules reuse target KVs in place. Despite its recurrent formulation, Mamba's parallel scan allows H-Spec to preserve block-parallel drafting. Across three target models and diverse tasks, H-Spec improves over the best baseline by 5.0-13.3% in mean accepted length and 5.3-12.6% in batch-size-1 inter-token latency speedup. Under concurrent serving, H-Spec consistently achieves higher throughput while maintaining lower KV cache utilization than baselines across evaluated concurrency levels.

## Bio

Weifan Jiang is a Ph.D. candidate in Computer Science at Harvard University, advised by Minlan Yu. His research focuses on efficient large language model inference and serving, with recent work on speculative decoding, scheduling, and efficient multi-agent systems. He was an ML Systems Research Intern at Red Hat AI, where he worked on Speculators, the speculative decoding framework in the vLLM ecosystem.
