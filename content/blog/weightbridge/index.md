+++
title = "Stop Waiting for Weights: Efficient RL Updates with WeightBridge"
date = 2026-10-27T12:00:00-04:00
draft = false
author = "Xuanlin Jiang"
bio = "Xuanlin Jiang is a second-year PhD student in Computer Science at Harvard University, advised by Prof. Minlan Yu. His research focuses on systems for machine learning. He earned a B.S. in Computer Science from Peking University and has published work at MLSys and in ACM Transactions on Computer Systems (TOCS). His current research focuses on building systems for reinforcement learning for large language models."
tags = ["LLM", "systems", "performance"]
summary = "WeightBridge automatically bridges trainer and rollout layouts and reduces GPU stall time during RL weight updates by up to 42×."
tldr = "If you run an LLM RL framework, WeightBridge helps you keep weight updates fast as models, trainer–rollout layouts, and synchronization modes change. Its reusable integration removes the need to maintain model-specific weight mappings or redesign transfer logic for each configuration. Across evaluated deployments, it reduces average GPU stall time per weight update by **up to 42× over Miles’ native mechanisms**. A coding agent integrated it into Miles in **24.5 minutes of active work**, excluding experiment waits, using only generic documentation."
showToc = true
+++

*A library for efficient weight transfer across diverse LLM reinforcement learning settings*

**Xuanlin Jiang¹\*, Samuel Hsia², Michael Kuchnik², Zachary DeVito², Minlan Yu¹, and Carole-Jean Wu²**

¹ Harvard University · ² FAIR at Meta

*Work carried out during an internship at Meta.*

[Open-source code](https://github.com/meta-pytorch/monarch/tree/main/examples/weightbridge) · [Paper](https://arxiv.org/abs/2609.25442) · [PyTorch Conference talk](https://events.linuxfoundation.org/pytorch-conference-north-america/program/schedule/?id=1255147)

## Diverse RL Configurations Challenge Weight Transfer

RL alternates between **rollout workers**, which generate trajectories, and **trainer workers**, which use them to update the policy. ***Weight transfer*** sends the updated parameters back to rollouts. A typical system has one training engine and multiple independently running inference engines.

{{< figure src="bg-workflow.svg" size="large" alt="RL workflow linking trainer workers with multiple rollout inference engines" caption="**RL workflow.** Trajectories flow to trainers; updated weights flow back to rollout workers." >}}

Sparse MoE models increase the parameters transferred relative to computation per token, while GPU compute improves faster than inter-node bandwidth. These two trends substantially increase weight transfer overhead in the RL pipeline and have drawn attention from [Perplexity](https://proceedings.mlsys.org/paper_files/paper/2026/file/dea9b4b6f55ae611c54065d6fc750755-Paper-Conference.pdf), [ByteDance](https://arxiv.org/abs/2604.09107), [Anyscale](https://www.anyscale.com/blog/rdt-ray-direct-transport-fast-easy-weight-syncing-for-rl-reinforcement-learning), [Miles / LMSYS](https://lmsys.org/blog/2026-04-29-p2p-update/), [Prime Intellect](https://www.primeintellect.ai/blog/nixl-modelexpress-weight-transfer), and [Ant Group](https://ant-ling.medium.com/ant-group-open-sources-awex-high-performance-weight-exchange-framework-for-trillion-parameter-3adf33b94a81).

Weight transfer involves three key questions:

1. **What weights go where? — Layout discovery:** identify the elements each trainer holds and each rollout needs.
2. **How do they move? — Transfer planning:** choose routes, RDMA operations, and layout-conversion kernels.
3. **When are they available? — Synchronization and scheduling:** coordinate updates with computation while preserving RL semantics.

### Why diversity makes these questions challenging

Supporting these three steps becomes harder as RL configurations diversify. Existing mechanisms are efficient only in subsets of the layout and synchronization space: other configurations expose redundant transfers, sender bottlenecks, or layout-conversion overhead. [Details of existing solutions](https://arxiv.org/html/2609.25442v1#S2.T1)

This diversity creates three challenges.

**1. Heterogeneous layouts complicate correspondence.** Different models and hardware drive diverse parallelism strategies and model layouts for both trainers and rollouts. Trainers and rollouts usually use mismatched layouts because of their inherently different performance goals and algorithmic flows. For example, as shown in the figure below, the trainer uses larger tensor parallelism (TP) and pipeline parallelism (PP) degrees due to larger memory overhead of gradients and optimizer states. As a result, the weight correspondence between trainer and rollouts becomes highly complicated.

Specialized kernels in training and inference frameworks further increase differences in how they store tensors in the GPU — they may split, transpose or pad the same parameter tensor in entirely different ways. All these mismatches contribute significantly to the complexity of weight correspondence between the trainer and the rollouts.

{{< figure src="bg-example.svg" size="full" alt="Weight correspondence between TP2 EP2 PP2 trainers and TP1 EP2 DP2 rollouts" caption="**Layout mismatch.** Mismatched parallelism complicates weight correspondence (same color). T0–T3 are trainer workers and R0–R3 are rollout workers." >}}

**2. Replication and topology complicate routing.** Multiple trainers may hold the same weights, and multiple rollout workers may need them. Full-model broadcasts can deliver unneeded elements, causing redundancy, while independent fetches can overload one sender, causing *imbalance*. Efficient planning must eliminate redundant traffic and balance aggregate load across replica groups, using fast intra-node NVLink and slower inter-node RDMA appropriately.

<div style="display:flex;flex-wrap:wrap;gap:1.5rem;align-items:flex-start;margin:1.5rem 0;">
<figure style="flex:1 1 16rem;min-width:0;margin:0;"><img src="bg-redundant.svg" alt="Redundant full-model transfer compared with shard-specific delivery" loading="lazy" style="width:100%;height:auto;" /><figcaption><strong>Redundant transfer.</strong> Full-model delivery sends elements a worker discards; precise routing sends only the weights it needs.</figcaption></figure>
<figure style="flex:1 1 16rem;min-width:0;margin:0;"><img src="bg-imbalanced.svg" alt="Single-source bottleneck compared with balanced rollout exchanges" loading="lazy" style="width:100%;height:auto;" /><figcaption><strong>Load imbalance.</strong> Independent pulls overload one trainer; exchanges between rollout workers balance traffic.</figcaption></figure>
</div>

**3. Different staleness preferences of RL applications complicate worker coordination.** Alignment tasks such as chat quality, instruction following, safety, and refusal behavior often have short rollouts that favor *synchronous* execution. Mathematics and competitive programming produce longer, variable rollouts that make blocking updates more expensive and motivate *asynchronous* execution. Algorithms also differ in stale-trajectory tolerance. The weight transfer mechanism must coordinate workers carefully to support these different synchronization modes while keeping the APIs simple enough to integrate into different backend engines.

## Fast Weight Updates Across Diverse RL Configurations

WeightBridge lets RL framework developers support diverse configurations without giving up efficient weight transfer. The key is to separate **what each worker needs** from **how those weights move** and **when they are applied**: discover the layout correspondence once, optimize the communication globally, and reuse both behind a small interface. You can change model layouts and synchronization policies without rewriting model-specific transfer rules. The following three capabilities make that possible.

{{< figure src="ds-overview.svg" size="medium" alt="WeightBridge correspondence extraction, planning, execution, and coordination" caption="**WeightBridge overview.** Planning derives correspondence and routes; execution transfers updates under the selected synchronization semantics." >}}

### 1. Support Different Layouts Without Handwritten Mappings

WeightBridge removes the need to hand-code tensor mappings for each model and trainer–rollout backend pair. It derives the correspondence from the backends’ existing weight loaders, so it can adapt to different sharding, fusion, and transpose patterns automatically. Unlike approaches that rely on fixed model-specific rules, the mapping comes from the behavior of your backend engine’s weight loader itself. Knowing exactly how weights correspond between workers avoids transfer redundancy.

The checkpoint provides a common coordinate system: WeightBridge probes each backend’s `load_weights`, recovers its source map, and matches the maps across workers. [Layout discovery details](https://arxiv.org/html/2609.25442v1#S3.SS1)

{{< figure src="ds-specgen.svg" size="medium" alt="Index probing through load_weights reveals a weight source map" caption="**Source-map extraction.** Index tensors pass through the native loader to reveal where each checkpoint element lands." >}}

### 2. Keep Transfers Efficient as Sharding and Replication Change

WeightBridge avoids a choice between full-model broadcasts that waste bandwidth and independent P2P pulls that overload one trainer as rollout replication grows. Its global plan uses the correspondence across all workers to eliminate redundant data and distribute communication over available links. This makes the transfer efficient across different sharding and replication patterns, rather than tuning one point-to-point path for one layout.

Two principles guide the routing plan:

1. **Trainers collectively transmit only one copy of the model**, avoiding redundant sends and a single-source bottleneck.
2. **Each rollout node receives exactly one copy of each weight element it needs over RDMA**, with additional local replicas distributed over NVLink.

The planner assigns distinct slices to replicated workers, then executes three stages: **receive** slices from trainers, **exchange across rollout nodes** over RDMA, and **distribute within each node** over NVLink. [Transfer planning details](https://arxiv.org/html/2609.25442v1#S3.SS2)

{{< figure src="ds-transfer.svg" size="large" alt="Receive, external exchange over RDMA, and internal exchange over NVLink" caption="**Three-stage transfer.** TP2 trainers feed DP4 rollouts; cross-node and local exchanges reconstruct replicas while avoiding repeated full-model pulls." >}}

### 3. Integrate Once, Choose the Synchronization Mode You Need

WeightBridge is designed to be easy to add to an existing RL framework: the same three API calls serve synchronous, asynchronous, and partially synchronous updates across supported models and backend stacks. Your framework keeps control of training, generation, and request scheduling; WeightBridge handles weight-transfer coordination. Supply your native loaders and runtime context, then call:

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

[See the integration guide for API details and current implementation constraints.](https://github.com/meta-pytorch/monarch/blob/main/examples/weightbridge/docs/integration.md)

## Performance

### Up to 42× Less GPU Stall Time Than Miles’ Native Weight Transfer

We evaluated WeightBridge with models from **16B to 1.03T parameters on 2–64 H100 nodes**, with eight GPUs per node. We measure **average GPU stall time**: the sum of the time GPUs are blocked on a weight update, divided by the number of GPUs. Applying the same metric to all implementations, WeightBridge reduces average GPU stall time by **16.6–29.4× over Miles Broadcast** and **5.4–42.0× over Miles P2P**.

{{< figure src="ev-real_workload_agst_1col.svg" size="full" alt="GPU stall-time speedup over Miles Broadcast for four model deployments" caption="**Weight-update GPU stall time.** Speedup relative to Miles Broadcast across four model deployments; higher is better." >}}

**End-to-end RL throughput.** The end-to-end gain depends on GPU compute time in each RL step and how much weight-transfer overhead remains exposed: the same reduction in transfer time has a larger impact when computation is shorter. On Meta internal workloads, we achieved **up to 27% higher end-to-end RL throughput with WeightBridge**.

### Fast Integration into Different Backends

A coding agent integrated WeightBridge into Miles on its first attempt in **24.5 minutes of active work**, excluding experiment waits. The integration reduced end-to-end weight-transfer time by **19.7× for Qwen3-30B-A3B** and **8.84× for Qwen3-32B**, with correctness checks passing.

WeightBridge also integrates with an internal framework using **different training, rollout, and RDMA backends from Miles**, demonstrating API generality across different backend stacks. With minimal manual integration effort, it reduced end-to-end weight-transfer time by **6.29–11.00×** across one to four rollout replicas.

**Try WeightBridge in your RL stack.** [Get the library](https://github.com/meta-pytorch/monarch/tree/main/examples/weightbridge), open source in PyTorch Monarch’s examples, and give your coding agent the [integration guide](https://github.com/meta-pytorch/monarch/blob/main/examples/weightbridge/docs/integration.md) to connect it to your trainer and rollout backends. WeightBridge separates RL-framework integration from the communication backend: it has been tested with Megatron-LM, FSDP, vLLM, and SGLang, supports Mooncake and Monarch transports, and is designed to accommodate additional training/inference backends and communication libraries. [Watch the PyTorch Conference talk](https://events.linuxfoundation.org/pytorch-conference-north-america/program/schedule/?id=1255147) for an overview. If you hit an integration problem or want to collaborate, [open an issue](https://github.com/meta-pytorch/monarch/issues) or [contact Xuanlin Jiang](mailto:xjiang@g.harvard.edu).
