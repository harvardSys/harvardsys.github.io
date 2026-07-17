+++
title = 'Network-aware co-design for distributed machine learning systems'
date = 2026-07-17T12:00:00-04:00
eventTime = 2026-07-20T12:30:00-04:00
speaker = 'Minghao Li (Harvard University)'
location = "SEC 2.122 & 2.123"
summary = "As ML training scales across racks, data-center buildings, regions, and even federated clients, periodic synchronization leaves compute idle and prolongs iterations. Minghao will argue for network-aware co-design---jointly optimizing algorithms, parallelism and pipeline strategies, and heterogeneity handling---and present THC, ScaleAcross Explorer, and FIELDING as works that cut synchronization costs across increasingly large deployments."
draft = false
+++

## Abstract

The rapid growth of machine learning (ML) models and datasets has made distributed training essential. Modern training jobs may span multiple racks, data center buildings, and regions, and may involve federated learning across decentralized clients. Under such distributed deployments, the communication overhead of the required periodic synchronizations can leave compute resources idle and prolong training iterations. The increasingly diverse parallelisms also introduce various dependencies between computation and communication events, each with different sensitivities to communication delays. Training with federated clients whose local data are heterogeneous and evolving further complicates the problem, as both can hurt the speed and quality of model convergence.

Existing synchronization optimizations often achieve suboptimal performance by optimizing either communication volume, pipelined execution, or heterogeneity mitigation in isolation and for specific network settings or model architectures. In this talk, I will present a series of works that demonstrate that distributed machine learning systems should be designed through network-aware co-design: algorithms, parallelism and pipeline strategies, and heterogeneity handling should be optimized jointly.

I will first introduce THC, a tensor homomorphic compression framework that co-designs gradient compression and in-network aggregation to accelerate data-parallel synchronization by directly aggregating compressed gradients. I will then discuss ScaleAcross Explorer, a scale-across training optimizer that holistically configures workload parallelism placement, parallelism scheduling, microbatching, model chunking, and network-layer technologies while explicitly modeling fine-grained computation-communication overlaps and cross-building networking constraints. Finally, I will present FIELDING, a clustered federated learning framework that extends distributed training to federated learning over decentralized clients with drifting local data. FIELDING uses lightweight client representations, per-client drift detection, and selective global re-clustering to handle data heterogeneity and drift with low communication and computation overhead. Together, these systems demonstrate that network-aware co-design can reduce the visible synchronization costs in end-to-end training across increasingly large deployment scale: from data-parallel synchronous training within a data center building, to multi-dimensional parallel training for both dense and Mixture-of-Experts models across data center buildings, to federated learning over heterogeneous and evolving data at decentralized clients.

## Bio

Minghao Li is a fifth-year PhD student in Computer Science at the Harvard SEAS. Her research focuses on building efficient Machine Learning systems. As the computing demands of modern ML workloads continue to grow, training and inference increasingly rely on distributed deployment across many devices. Performant ML systems, therefore, require optimized bandwidth usage and fast coordination among devices potentially connected by slow or heterogeneous networks. Her prior work includes Tensor Homomorphic Compression (NSDI'24) as well as FIELDING (AISTATS'26), a Federated Learning system that improves model convergence in heterogeneous environments with local data drift. Her current research explores optimizing communication across data centers for large-scale model training.
