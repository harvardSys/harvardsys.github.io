+++
title = 'Building Scalable Distributed Databases in the Age of Geo-Replication'
date = 2026-06-08T10:00:00-04:00
eventTime = 2026-06-08T12:30:00-04:00
speaker = 'Yunhao Mao (University of Toronto)'
location = "SEC 2.122 & 2.123"
summary = "Modern distributed applications depend heavily on geo-replication for fault tolerance, but high network latency forces these databases to make difficult tradeoffs between the high performance of weak consistency and the data safety of strong consistency. Yunhao will explore solutions to these challenges by detailing advancements in Conflict-free Replicated Datatypes (CRDTs), including the Janus implementation, and introducing Minerva, a scalable transaction protocol designed to maintain high throughput across wide-area networks."
draft = false
+++

## Abstract

To ensure high availability and fault tolerance, modern distributed applications depend heavily on geo-replication that distributes data across multiple data centers. However, high network latency among replicas forces geo-replicated databases to tradeoff between consistency, availability, and performance. Weak consistency achieves high performance but exposes developers to data anomalies, whereas strong consistency requires synchronous coordination that severely degrades performance over wide-area networks. Our research addresses two critical challenges: improving the usability of eventually consistent systems and designing strongly consistent transaction systems tailored for geo-replication.

We begin by exploring Conflict-free Replicated Datatypes (CRDTs) as a robust, eventually consistent solution. We detail our work on reversible CRDTs, introducing a novel "undo" operation for CRDT interfaces, followed by reliable CRDTs, which provision strong consistency on demand. We will highlight Janus, our implementation that uses asynchronous Byzantine fault-tolerant consensus to replicate CRDTs with minimal performance penalties while ensuring safety. Finally, we present Minerva, a scalable transaction protocol for multi-leader geo-replicated databases that leverages asynchronous consensus to maintain high-throughput processing under wide-area network latency.

## Bio

Yunhao Mao is a Ph.D. candidate at Middleware Systems Research Group (MSRG), University of Toronto. He obtained his MASc degree in Computer Engineering from University of Toronto in 2021. His research focuses on distributed systems and databases, along with interests in databases and systems for AI.
