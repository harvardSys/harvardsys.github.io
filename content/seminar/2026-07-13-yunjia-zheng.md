+++
title = 'Simple Techniques for Loop-friendly Eviction and Belady Anomaly Reduction'
date = 2026-07-13T12:00:00-04:00
eventTime = 2026-07-13T12:30:00-04:00
speaker = 'Yunjia Zheng (Harvard University)'
location = "SEC 2.122 & 2.123"
summary = "Many workloads, such as repeated scans and LSM-tree compaction, access groups of objects in similar orders, forming access loops that several cache eviction algorithms handle well---though it remains unclear what makes them effective. Yunjia will distill the structural features behind this efficiency into portable eviction gadgets that can be plugged into existing policies, and show that these features also improve cache stability by reducing miss-ratio anomalies and cliffs."
draft = false
+++

## Abstract

Caching is critical for reducing latency in operating systems and data-center applications. In many workloads, such as repeated scans and LSM-tree compaction, groups of objects are accessed repeatedly in similar orders, forming access loops. Several cache eviction algorithms achieve low miss ratios on such loop-heavy workloads, yet it remains unclear which mechanisms make them effective, whether these mechanisms can be transferred to other policies, and whether they provide benefits beyond miss-ratio reduction.

In this talk, I will introduce structural features that enable high efficiency on loop workloads and distill them into portable eviction gadgets. These gadgets can be plugged into existing cache eviction policies and allow different algorithms to inherit the efficiency advantage. Surprisingly, we find that these features also improve cache stability: they reduce miss-ratio anomalies, where increasing cache size unexpectedly increases misses, and cliffs, where the miss ratio drops abruptly at specific cache sizes.

## Bio

Yunjia Zheng is a first-year Ph.D student in the Harvard Systems Group, advised by Professor Juncheng Yang. Her research focus on data management systems, with an interest in how systems can better organize, retrieve, and serve data efficiently.
