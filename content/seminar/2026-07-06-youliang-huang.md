+++
title = 'Diagnosing Performance Issues by Uncovering Application Resource Bottlenecks'
date = 2026-06-29T23:30:00-04:00
eventTime = 2026-07-06T12:30:00-04:00
speaker = 'Youliang Huang (Boston University)'
location = "SEC 2.122 & 2.123"
summary = "Performance issues in large software systems are often driven by application-defined resources like buffer pools and caches, which remain hidden from system-level metrics and are notoriously difficult to diagnose with standard profilers. Youliang will introduce gigiprofiler, a tool that combines LLM-based semantic inference with static analysis to uncover these bottlenecks, and share practical insights on leveraging large language models for program analysis."
draft = false
+++

## Abstract

Many performance issues in large software systems are caused by application-defined resources, such as buffer pools, query caches, and temporary data structures. These resources are managed within the application logic and can strongly affect program execution. However, their resource-specific semantics are often not visible through system-level metrics. As a result, inefficient designs in the management of these resources can cause performance degradation that is difficult to observe and diagnose with existing profilers.

In this talk, I will present gigiprofiler, a profiler that diagnoses performance problems caused by application-defined resources, which has been accepted by OSDI'26. I will first talk about background and motivation of this work, its design challenge and insights. Then I'll talk about the system design, a hybrid method that combines LLM-based semantic inference with static analys. Finally, I will present our evaluation and some findings when trying to use LLM for program analysis.

## Bio

Youliang Huang is a Ph.D. candidate in Computer Engineering at Boston University, advised by Prof. Yigong Hu. His research interests are broadly around LLMs and system relability, including how to detect, diagnose, and mitigate bugs or performance issues.
