+++
title = 'zcIO: Enabling Transparent Zero-copy for NVMe/TCP'
date = 2026-08-21T21:00:00-04:00
eventTime = 2026-08-24T12:30:00-04:00
speaker = 'Junghan Yoon (Seoul National University)'
location = "SEC 2.122 & 2.123"
summary = "NVMe-over-Fabrics via TCP has become a datacenter standard for disaggregated storage, yet it remains severely CPU-bound because traditional zero-copy TCP stacks cannot meet the strict page-alignment requirements of efficient hardware-to-software handoffs. Junghan will present zcIO, a Linux NVMe/TCP stack that uses record-aware networking to replace expensive memory copies with low-overhead page remapping, improving remote storage performance by up to 2.3x."
draft = false
+++

## Abstract

NVMe-over-Fabrics via TCP (NVMe/TCP) has become a datacenter standard for disaggregated storage, yet it remains severely CPU-bound in high-speed environments. While zero-copy I/Os could alleviate the load, traditional zero-copy TCP stacks often fail to meet the strict page-alignment requirements necessary for efficient hardware-to-software handoffs. We present zcIO, a novel Linux NVMe/TCP stack that achieves seamless zero-copy I/Os through record-aware networking. By aligning TCP payloads with the NVMe PDU formats and leveraging large MTUs with header-data split capabilities, zcIO ensures that incoming DMA transfers are perfectly aligned with memory page boundaries. This precise alignment allows zcIO to replace expensive memory copies with low-overhead virtual memory page remapping. zcIO provides a transparent zero-copy data path requiring no application modifications and ensures safe page reclamation. Our evaluation shows that zcIO improves remote storage performance by up to 2.3x, reaching throughput of up to 67.6 GB/s (540.8 Gbps) with 15 CPU cores.

## Bio

Junghan Yoon is a fourth-year Ph.D. student in the Department of Computer Science and Engineering at Seoul National University. His research focuses on high-performance networked systems, including SmartNICs, network functions, and remote storage.
