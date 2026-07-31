+++
title = 'Rethinking Bursty Workloads and KV Cache Hierarchies for Efficient LLM Serving'
date = 2026-07-31T18:00:00-04:00
eventTime = 2026-08-03T12:30:00-04:00
speaker = 'Akira van de Groenendaal (Carnegie Mellon University)'
location = "SEC 2.122 & 2.123"
summary = "Akira will present two recent projects on serving bursty, prefix-heavy LLM inference workloads: one showing how bursty arrivals can improve a cluster's time-per-output-token and what that implies for request routing, and another on tuning the private vs. shared split of a distributed KV cache to optimize time-to-first-token---together demonstrating that intuitive systems choices can leave performance gains on the table."
draft = false
+++

## Abstract

Modern LLM inference workloads are bursty and exhibit heavy prefix reuse, and serving them efficiently requires understanding how we can turn these traits to our advantage. In this talk, I'll present two recent projects: the first investigates how latency is impacted by bursty arrivals, and the second explores how we can make best use of a distributed KV cache. First, we'll see how burstiness can improve the time-per-output-token of your LLM cluster and discuss the conditions which make this possible, as well as what it implies for request routing. Afterwards, we'll look at how to control the private vs shared split of your KV cache to optimize time-to-first-token. Both projects show how intuitive systems choices can sometimes leave performance gains on the table, motivating the need to question seemingly obvious decisions.

## Bio

Akira van de Groenendaal is a senior studying Computer Science at Carnegie Mellon University, currently doing research with the Harvard Systems Group under Prof. Juncheng Yang. He works on ML systems, with interests in workload analysis and the queueing dynamics of LLM inference.
