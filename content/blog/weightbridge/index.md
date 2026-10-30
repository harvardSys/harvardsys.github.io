+++
title = "Stop Waiting for Weights: Efficient RL Updates with WeightBridge"
date = 2026-10-27T12:00:00-04:00
draft = true
author = "Xuanlin Jiang"
bio = "Xuanlin Jiang is a second-year PhD student in Computer Science at Harvard University, advised by Prof. Minlan Yu. His research focuses on systems for machine learning. He earned a B.S. in Computer Science from Peking University and has published work at MLSys and in ACM Transactions on Computer Systems (TOCS). His current research focuses on building systems for reinforcement learning for large language models."
tags = ["LLM", "systems", "performance"]
summary = "WeightBridge automatically bridges trainer and rollout layouts and reduces GPU stall time during RL weight updates by up to 42×."
tldr = "WeightBridge is an efficient weight-transfer library for LLM reinforcement learning across **diverse models, trainer–rollout layouts, and synchronization modes**. It automatically discovers trainer–rollout weight correspondence, plans non-redundant and load-balanced transfers, and coordinates workers across synchronization modes. WeightBridge reduces **average GPU stall time per weight update by up to 42×** over Miles’ native mechanisms. A coding agent integrated it into Miles in **24.5 minutes of active work** using only generic integration documentation."
showToc = true
+++

*A library for efficient weight transfer across diverse LLM reinforcement learning settings*

**Xuanlin Jiang¹\*, Samuel Hsia², Michael Kuchnik², Zachary DeVito², Minlan Yu¹, and Carole-Jean Wu²**

¹ Harvard University · ² FAIR at Meta

*Work carried out during an internship at Meta.*

[Open-source code](https://github.com/meta-pytorch/monarch/tree/main/examples/weightbridge) · [Paper](https://arxiv.org/abs/2609.25442) · [PyTorch Conference talk](https://events.linuxfoundation.org/pytorch-conference-north-america/program/schedule/?id=1255147)

## Diverse RL Configurations Challenge Weight Transfer

RL alternates between **rollout workers**, which generate trajectories, and **trainer workers**, which use them to update the policy. ***Weight transfer*** sends the updated parameters back to rollouts. A typical system has one training engine and multiple independently running inference engines.

{{< figure width="100%" src="bg-workflow.svg" alt="RL workflow linking trainer workers with multiple rollout inference engines" caption="**RL workflow.** Trajectories flow to trainers; updated weights flow back to rollout workers." >}}

Sparse MoE models increase the parameters transferred relative to computation per token, while GPU compute improves faster than inter-node bandwidth. These two trends substantially increase weight transfer overhead in the RL pipeline and have drawn attention from [Perplexity](https://proceedings.mlsys.org/paper_files/paper/2026/file/dea9b4b6f55ae611c54065d6fc750755-Paper-Conference.pdf), [ByteDance](https://arxiv.org/abs/2604.09107), [Anyscale](https://www.anyscale.com/blog/rdt-ray-direct-transport-fast-easy-weight-syncing-for-rl-reinforcement-learning), [Miles / LMSYS](https://lmsys.org/blog/2026-04-29-p2p-update/), [Prime Intellect](https://www.primeintellect.ai/blog/nixl-modelexpress-weight-transfer), and [Ant Group](https://ant-ling.medium.com/ant-group-open-sources-awex-high-performance-weight-exchange-framework-for-trillion-parameter-3adf33b94a81).

Weight transfer involves three key questions:

1. **What weights go where? — Layout discovery:** identify the elements each trainer holds and each rollout needs.
2. **How do they move? — Transfer planning:** choose routes, RDMA operations, and layout-conversion kernels.
3. **When are they available? — Synchronization and scheduling:** coordinate updates with computation while preserving RL semantics.

### Why diversity makes these questions challenging

Supporting these three steps becomes harder as RL configurations diversify. Existing mechanisms are efficient only in subsets of the layout and synchronization space: other configurations expose redundant transfers, sender bottlenecks, or layout-conversion overhead. [Details of existing solutions](https://arxiv.org/html/2609.25442v1#S2.T1)

This diversity creates three challenges.

**1. Heterogeneous layouts complicate correspondence.** Different models and hardware drive diverse parallelism and sharding strategies for both trainers and rollouts. Within a job, training’s larger memory footprint and throughput goals differ inherently from inference’s decoding-latency goals, producing mismatched layouts. Specialized kernels further change tensor fusion, packing, and ordering within the GPU, making correspondence a cross-rank mapping problem.

{{< figure width="100%" src="bg-example.svg" alt="Weight correspondence between TP2 EP2 PP2 trainers and TP1 EP2 DP2 rollouts" caption="**Layout mismatch.** Mismatched parallelism causes cross-rank weight correspondence; T0–T3 are trainers and R0–R3 are rollouts." >}}

**2. Replication and topology complicate routing.** Multiple trainers may hold the same weights, and multiple rollout workers may need them. Full-model broadcasts can deliver unneeded elements, causing redundancy, while independent fetches can overload one sender, causing *imbalance*. Efficient planning must eliminate redundant traffic and balance aggregate load across replica groups, using fast intra-node NVLink and slower inter-node RDMA appropriately.

<div style="display:flex;flex-wrap:wrap;gap:1.5rem;align-items:flex-start;margin:1.5rem 0;">
<figure style="flex:1 1 16rem;min-width:0;margin:0;"><img src="bg-redundant.svg" alt="Redundant full-model transfer compared with shard-specific delivery" loading="lazy" style="width:100%;height:auto;" /><figcaption><strong>Redundant transfer.</strong> Full-model delivery sends elements a worker discards; precise routing sends only the weights it needs.</figcaption></figure>
<figure style="flex:1 1 16rem;min-width:0;margin:0;"><img src="bg-imbalanced.svg" alt="Single-source bottleneck compared with balanced rollout exchanges" loading="lazy" style="width:100%;height:auto;" /><figcaption><strong>Load imbalance.</strong> Independent pulls overload one trainer; exchanges between rollout workers balance traffic.</figcaption></figure>
</div>

**3. Different staleness preferences of RL applications complicate worker coordination.** Alignment tasks such as chat quality, instruction following, safety, and refusal behavior often have short rollouts that favor *synchronous* execution. Mathematics and competitive programming produce longer, more variable rollouts, making blocking updates more expensive and motivating *asynchronous* execution. Algorithms also differ in stale-trajectory tolerance. The weight transfer mechanism must coordinate workers carefully to support these different synchronization modes while keeping the APIs simple enough to integrate into different backend engines.

## WeightBridge Unifies Layout Discovery, Transfer Planning, and Worker Coordination

WeightBridge answers the three questions through automatic correspondence extraction, global transfer planning and execution, and backend-independent worker coordination. Extraction and planning happen once, while the resulting routing plan is reused across policy updates.

{{< figure width="100%" src="ds-overview.svg" alt="WeightBridge correspondence extraction, planning, execution, and coordination" caption="**WeightBridge overview.** Planning derives correspondence and routes; execution transfers updates under the selected synchronization semantics." >}}

### 1. Extracting correspondence through backend-native weight loaders

The model’s checkpoint can act as a common coordinate system between trainer and rollouts, and each backend’s existing `load_weights` function already maps checkpoint tensors into its runtime parameters. WeightBridge probes that function with identifiable index values, recovers each worker’s weight source map, and intersects trainer and rollout maps to find the correspondence between weight elements. [Layout discovery details](https://arxiv.org/html/2609.25442v1#S3.SS1)

{{< figure width="100%" src="ds-specgen.svg" alt="Index probing through load_weights reveals a weight source map" caption="**Source-map extraction.** Index tensors pass through the native loader to reveal where each checkpoint element lands." >}}

### 2. Planning non-redundant, load-balanced transfers

Two principles guide the routing plan:

1. **Trainers collectively transmit only one copy of the model**, avoiding redundant sends and a single-source bottleneck.
2. **Each rollout node receives exactly one copy of each weight element it needs over RDMA**, with additional local replicas distributed over NVLink.

The planner assigns distinct slices to replicated workers, then executes three stages: **receive** slices from trainers, **exchange across rollout nodes** over RDMA, and **distribute within each node** over NVLink. [Transfer planning details](https://arxiv.org/html/2609.25442v1#S3.SS2)

{{< figure width="100%" src="ds-transfer.svg" alt="Receive, external exchange over RDMA, and internal exchange over NVLink" caption="**Three-stage transfer.** TP2 trainers feed DP4 rollouts; cross-node and local exchanges reconstruct replicas while avoiding repeated full-model pulls." >}}

### 3. Coordinating workers across synchronization modes under minimal APIs

Sender and receiver adapters expose three key APIs:

- **`connect()`** establishes the trainer–rollout connection and prepares the reusable transfer plan.
- **`send_weights()`** initiates transfer of a new model version from trainer workers.
- **`poll_requests()`** services connection and update requests at rollout inference boundaries, coordinating when workers apply new weights.

Independent sender- and receiver-staging switches provide four synchronization modes: fully synchronous, fully asynchronous, or overlap on only one side. Host staging enables overlap but adds copies and memory costs; the application chooses its throughput-staleness tradeoff. [Worker coordination details](https://arxiv.org/html/2609.25442v1#S3.SS3)

```python
import wbridge.frontend.adapters as wbridge

def trainer_worker_process():
    adapter = wbridge.SenderAdapter(...)      # WeightBridge
    adapter.connect()                         # WeightBridge

    for _ in range(num_iters):
        train_one_step()
        adapter.send_weights()                # WeightBridge

def rollout_worker_process():
    adapter = wbridge.ReceiverAdapter(...)    # WeightBridge

    while True:
        generate_one_step()
        updated = adapter.poll_requests()     # WeightBridge
```

**Minimal integration.** Trainers connect once and send updated weights; rollouts poll between inference steps.

{{< figure width="100%" src="ds-apis.svg" alt="Sender and receiver APIs coordinate planning and execution" caption="**APIs & Worker coordination.** Adapters trigger planning once and execute subsequent updates through the 3 key APIs." >}}

[See the integration guide for API details and current implementation constraints.](https://github.com/meta-pytorch/monarch/blob/main/examples/weightbridge/docs/integration.md)

## Performance

### Substantial Reduction in GPU Stall Time Across Diverse RL Settings

We evaluated WeightBridge with models from **16B to 1.03T parameters on 2–64 H100 nodes**. Each node has eight GPUs. The primary metric is **average GPU stall time (AGST) per weight transfer.** Across the four deployments, WeightBridge lowers AGST by **16.6–29.4× over Miles Broadcast** and **5.4–42.0× over Miles P2P**. Layout and replica-count studies show that global planning avoids the single-source bottleneck while keeping transfer time close to the bandwidth-based lower bound.

{{< figure width="100%" src="ev-real_workload_agst_1col.svg" alt="AGST speedup over Miles Broadcast for 16B, 30B, 235B, and 1.03T models" caption="**Real-workload performance.** Bars show AGST speedup over Miles Broadcast; “Ours” denotes WeightBridge." >}}

### Fast Integration into Different Backends

A coding agent integrated WeightBridge into Miles on its first attempt in **24.5 minutes of active work**, excluding experiment waits. The integration reduced end-to-end weight-transfer time by **19.7× for Qwen3-30B-A3B** and **8.84× for Qwen3-32B**, with correctness checks passing.

WeightBridge also integrates with an internal framework using **different training, rollout, and RDMA backends from Miles**, demonstrating API generality across different backend stacks. With minimal manual integration effort, it reduced end-to-end weight-transfer time by **6.29–11.00×** across one to four rollout replicas.

[Explore the open-source code](https://github.com/meta-pytorch/monarch/tree/main/examples/weightbridge) · [Read the paper](https://arxiv.org/abs/2609.25442) · [Integration guide](https://github.com/meta-pytorch/monarch/blob/main/examples/weightbridge/docs/integration.md) · [PyTorch Conference talk](https://events.linuxfoundation.org/pytorch-conference-north-america/program/schedule/?id=1255147)
