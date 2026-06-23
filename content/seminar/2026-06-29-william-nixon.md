+++
title = 'A Year in LLM Serving: Workload Evolution, Caching and Load-Balancing'
date = 2026-06-23T17:00:00-04:00
eventTime = 2026-06-29T12:30:00-04:00
speaker = 'William Nixon (University of Chicago)'
location = "SEC 2.122 & 2.123"
summary = "Designing effective modern LLM serving systems requires an understanding of realistic workloads, but capturing the complexity of today's diverse applications is difficult using only short traces or synthetic datasets. William will share insights from a comprehensive one-year production trace of billions of LLM requests, exploring how these workloads evolve and detailing key systems implications for prefix caching and load balancing."
draft = false
+++

## Abstract

Understanding realistic LLM serving workloads is important for designing and evaluating modern serving systems. LLMs now support a wide range of applications, spanning chatbots, coding agents, and API-based services, but production workloads are difficult to capture with short traces or synthetic datasets alone. In this talk, I will present our study of a one-year production LLM serving trace, covering billions of requests across thousands of models. I will discuss how these workloads evolve over time, including changes in model popularity, token lengths, and user–model interaction patterns. I will then highlight two systems implications from the trace: prefix caching and load balancing. Our analysis shows that prefix-cache reuse is common but uneven, and that simple policies such as FIFO and LRU can be surprisingly competitive for LLM prefix caching. Finally, I will discuss the tension between cache locality and load balancing, where keeping related requests together improves cache reuse, while spreading requests across replicas is often needed for utilization and latency. The trace will be released to support downstream future research on realistic LLM serving workloads and production AI systems.

## Bio

William Nixon is a first-year Ph.D. student in Computer Science at the University of Chicago, advised by Prof. Haryadi S. Gunawi and Juncheng Yang. His research interests are broadly around systems and machine learning, including caching, storage, and infrastructure for AI workloads.
