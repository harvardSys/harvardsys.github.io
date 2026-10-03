+++
title = 'WeightBridge: An Efficient Weight Transfer Library for Reinforcement Learning'
date = 2026-10-02T21:00:00-04:00
eventTime = 2026-10-06T12:45:00-04:00
speaker = 'Xuanlin Jiang (Harvard University)'
location = "SEC 4.307 & 4.308"
summary = "Weight transfer, the propagation of updated parameters from trainers to rollout generators, is becoming a key bottleneck in RL systems for LLMs, and existing solutions perform poorly or lack support across diverse layouts and synchronization modes. Xuanlin will present WeightBridge, a library that automatically maps trainer and rollout weight layouts to plan redundancy-free, load-balanced transfers, reducing average GPU stall time by up to 42× over a state-of-the-art open-source RL framework."
draft = false
+++

## Abstract

Weight transfer - the propagation of updated parameters from trainers to rollout generators - is becoming an important performance bottleneck in reinforcement learning (RL) systems for LLMs. The central challenge is supporting the diverse trainer and rollout layouts and synchronization requirements of modern RL workloads without sacrificing efficiency. Existing solutions are efficient under some configurations but perform poorly or lack support under others. We present WeightBridge, a flexible, efficient weight-transfer library designed to deliver high performance across diverse RL configurations. WeightBridge first automatically extracts the correspondence between trainer and rollout weight layouts, then plans and executes redundancy-free and load-balanced weight transfer. It exposes a small, general API while coordinating workers across diverse synchronization modes. Across configurations spanning different models, parallelization layouts, and synchronization modes, WeightBridge reduces average GPU stall time by up to 42× over the state-of-the-art open-source RL framework and achieves high performance in all settings. A coding agent was able to integrate WeightBridge into two different RL frameworks without manual guidance, demonstrating the generality and ease of use of its APIs.

## Bio

Xuanlin Jiang is a second-year PhD student in Computer Science at Harvard University, advised by Prof. Minlan Yu. His research focuses on systems for machine learning. He earned a B.S. in Computer Science from Peking University and has published work at MLSys and in ACM Transactions on Computer Systems (TOCS). His current research focuses on building systems for reinforcement learning for large language models.
