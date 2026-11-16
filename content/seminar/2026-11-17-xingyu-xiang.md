+++
title = 'ShadowServe: Efficient KV Cache Fetching with SmartNICs'
date = 2026-11-15T22:00:00-05:00
eventTime = 2026-11-17T12:45:00-05:00
speaker = 'Xingyu Xiang (Harvard University)'
location = "SEC 4.307 & 4.308"
summary = "KV cache fetching is increasingly bottlenecked by network bandwidth, and decompressing compressed caches on the host either interferes with model computation or limits throughput. Xingyu will present ShadowServe, which offloads KV cache fetching and decompression to the SmartNIC, improving peak inference throughput by up to 1.42x."
draft = false
+++

## Abstract

KV cache fetching is increasingly bottlenecked by front-end network bandwidth. Compression mitigates this issue, but the received KV cache must be decompressed before use. Existing approaches decompress KV caches using GPUs, GPU video codecs, or host CPUs. However, GPU kernels interfere with model computation, while video codecs and CPUs have limited decompression throughput. We present ShadowServe, an inference system that offloads KV cache fetching to the front-end SmartNIC. This enables high-throughput fetching through hardware-accelerated decompression, without interfering with the host GPU or CPU. However, efficiently offloading the heterogeneous KV fetching pipeline requires careful use of the SmartNIC's limited resources. We address this with a parallelized run-to-completion data path, cache-resident data exchange, and pre-allocation memory management. We implement ShadowServe on NVIDIA BlueField-3 and integrate it with vLLM. ShadowServe consistently outperforms GPU, GPU codec, CPU, and uncompressed KV fetching baselines, improving peak inference throughput by up to 1.42x.

## Bio

Xingyu Xiang is a Ph.D. student in Computer Science at Harvard University, advised by Minlan Yu and Eddie Kohler. His research focuses on systems and networking for large language model inference. He received his bachelor's degree in Computer Science from Peking University, and has previously published work at NSDI and SIGCOMM.
