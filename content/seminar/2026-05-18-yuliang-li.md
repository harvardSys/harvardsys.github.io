+++
title = 'Firefly: Scalable, Ultra-Accurate Clock Synchronization for Datacenters'
date = 2026-05-15T10:00:00-04:00
eventTime = 2026-05-18T12:30:00-04:00
speaker = 'Yuliang Li (Google)'
location = "SEC 2.122 & 2.123"
summary = "Achieving the sub-10ns clock synchronization required by cloud-based financial exchanges is increasingly difficult because existing methods are often vulnerable to jitter, drift, and the complexities of large-scale network paths. Yuliang will showcase Firefly, a software-driven system that leverages a distributed consensus algorithm and a novel layered synchronization technique to provide resilient, high-precision time alignment across modern datacenters."
draft = false
+++

## Abstract

Cloud-based financial exchanges require sub-10ns device-to-device clock synchronization accuracy while adhering to Coordinated Universal Time (UTC). Existing clock sync techniques struggle to meet this demand at scale and are vulnerable to clock drift, jitter, and path asymmetries. Firefly, a software-driven data center clock sync system, scalably, cost-effectively, and reliably achieves very high clock sync accuracy. It employs a distributed consensus algorithm on a random overlay graph to rapidly converge to a common time while applying gradual adjustments to device hardware clocks. To realize consistent sync-to-UTC (external sync) across devices while maintaining a stable device-to-device internal sync, Firefly uses a novel technique, layered synchronization, that decouples internal and external syncs. In a 248-machine Clos network, Firefly achieves sub-10ns device-to-device and ≤1μs device-to-UTC sync, and is resilient to time server failure and unstable clocks.

## Bio

Yuliang Li is the initiator and tech lead of project Firefly at Google, which was published in SIGCOMM 2025. Yuliang is currently focusing on building new application and system capabilities enabled by precisely synchronized clocks.

Yuliang joined Google in 2020 after his graduation from Harvard University; his PhD dissertation received the SIGCOMM Doctoral Dissertation award and Harvard CS Outstanding Dissertation award. Yuliang continued research at Google and published several papers about clock-sync, network transport, and congestion control in SIGCOMM, NSDI and OSDI. While at Google, he also served on the SIGCOMM PC in 2024.
