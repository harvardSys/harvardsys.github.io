+++
title = 'Pelikan Segcache: a memory-efficient and scalable in-memory key-value cache for small objects'
date = 2021-10-01T20:00:00-04:00
author = 'Juncheng Yang'
draft = false
tags = ['caching', 'systems', 'performance', 'memory-management']
showToc = true
+++

In collaboration with Carnegie Mellon University, Twitter is building Pelikan's next generation of storage backend, which enables high memory efficiency, high throughput, and scalability for workloads that are primarily small objects and widely use TTL (time-to-live).

<!--more-->

In-memory key-value caches such as Memcached and Pelikan are widely deployed in modern web applications to provide low-latency, high-throughput services. In [previous posts](https://pelikan.io/blog/), we have described [caching at Twitter](https://pelikan.io/blog/benchmark-adq/), [the design of Pelikan](https://pelikan.io/blog/why-pelikan/), etc. This blog post will describe a new storage backend for Pelikan, called Segcache, developed in collaboration between [Carnegie Mellon University](http://www.cs.cmu.edu/~rvinayak/#group) and Twitter. The new design enables high memory efficiency, high throughput, and scalability for workloads that are mostly small objects and use TTL (time-to-live).[^1] As a spoiler, in our benchmark, Segcache can reduce the memory footprint of Twitter's largest cache cluster by up to 60% compared to the slab backend. 

[^1]: Workloads with large objects or do not use TTL can also benefit from Segcache, but the benefit is relatively smaller. 

## Background 

### Wide use of short TTLs
Time-to-live (TTL) is widely used in in-memory caches at Twitter and other friend companies for several reasons. When an object is written to the cache, a TTL is associated with the object. The following get requests do not update the TTL. When an object expires, it cannot be served to the user. 

First, TTL is used to bound staleness. Cache writes are best-effort; the data in the cache may be inconsistent with the data in the backend. To reduce the amount of stale data, TTLs are often used to ensure that stale data do not stay beyond too long in the cache. 
Second, TTL is used for periodical refreshes. For example, suppose a computation service (such as running machine learning predictions) wants to trigger the expensive computation every hour.  To achieve this, it will associate a one-hour TTL with the computed results. When the computed result expires, and users request it again, re-computation will be triggered. 
Third, TTL is also used for implicit deletion. Examples include rate limiters that use TTL to specify the window. And GDPR compliance, which requires us to not retain data of deleted users beyond a certain time. 

### Impact of TTLs
TTLs are widely used in various systems. However, it becomes extremely interesting in the context of caching. When objects expire, they become unusable. If these objects cannot be removed from the cache in time, they will occupy the precious cache that should store objects with future requests. Because expiration removes objects that **cannot** be used in the future, while evictions remove objects that **could** be used in the future, expiration should be prioritized before eviction. 
In our [previous work](https://www.usenix.org/system/files/osdi20-yang.pdf), we have demonstrated that for some workloads, if all the expired objects can be removed timely, a cache may not need a lot of evictions. 

### Existing techniques handling TTLs
While addressing TTLs is important and has also been recognized by [Memcached](https://github.com/memcached/memcached/issues/543) and [Redis](https://news.ycombinator.com/item?id=19664483). 
We summarize existing techniques used in Memcached, Redis, and research systems in the following table. 

{{< diagram size="large" caption="*Figure 1.* Existing techniques for removing expired objects. None is both efficient (low CPU and memory-bandwidth cost) and sufficient (removes most expired objects)." >}}
<style>
  .d-exp { width: 100%; border-collapse: collapse; font-size: 1rem; line-height: 1.3; text-align: center; }
  .d-exp th, .d-exp td { padding: .55rem .6rem; border: 1px solid #c7ced8; }
  .d-exp thead th { background: #3f5677; color: #fff; font-weight: 600; }
  .d-exp tbody th { background: #4d617a; color: #fff; font-weight: 500; }
  .d-exp .y, .d-exp .n { font-size: 1.25rem; font-weight: 700; }
  .d-exp .y { color: #3ca83c; }
  .d-exp .n { color: #d8392b; }
  @container (max-width: 30rem) {
    .d-exp { font-size: .875rem; }
    .d-exp th, .d-exp td { padding: .45rem .35rem; }
  }
</style>
<table class="d-exp">
  <thead><tr><th scope="col">Category</th><th scope="col">Technique</th><th scope="col">Efficient</th><th scope="col">Sufficient</th></tr></thead>
  <tbody>
    <tr><th scope="rowgroup" rowspan="2">Lazy expiration</th><td>Delete upon re-access</td><td class="y">✓<span class="sr-only"> yes</span></td><td class="n">✗<span class="sr-only"> no</span></td></tr>
    <tr><td>Check LRU tail</td><td class="y">✓<span class="sr-only"> yes</span></td><td class="n">✗<span class="sr-only"> no</span></td></tr>
    <tr><th scope="rowgroup" rowspan="3">Proactive expiration</th><td>Scanning</td><td class="n">✗<span class="sr-only"> no</span></td><td class="y">✓<span class="sr-only"> yes</span></td></tr>
    <tr><td>Sampling</td><td class="n">✗<span class="sr-only"> no</span></td><td class="n">✗<span class="sr-only"> no</span></td></tr>
    <tr><td>Transient object pool</td><td class="y">✓<span class="sr-only"> yes</span></td><td class="n">✗<span class="sr-only"> no</span></td></tr>
  </tbody>
</table>
{{< /diagram >}}

The techniques fall into two categories, lazy expiration, and proactive expiration. We observe that existing techniques are either not efficient (use a lot of CPU and memory bandwidth) or not sufficient (cannot remove most expired objects). The detailed discussion can be found in [our paper](https://www.usenix.org/system/files/nsdi21-yang.pdf). 

Improving the ability to remove expired objects is imminent. However, the storage design of most existing systems severely limits the potential design space. 
Pelikan provides a modular design that makes it possible to redesign the storage to allow efficient and proactive TTL expiration, described in the next section. 

### Small objects vs huge object metadata 
It has been shown at Twitter, Facebook, and Reddit that most objects stored in in-memory caching are small. We observe that among all Twitter's in-memory caching clusters (100+), the P25 of mean object size is 100 bytes, while the median is smaller than 300 bytes. While most existing systems associate huge object metadata with objects (56 bytes in Memcached, 39 bytes in Pelikan slab storage[^2]). For a cache cluster with a mean object size of 100 bytes, using Memcached means *more than one-third of your cache size will be storing object metadata*. 

[^2]: Pelikan provides cuckoo storage, which uses 5 bytes per object metadata. However, it can only be used for workloads in which all objects are of the same (or similar) size. 

### Memory fragmentation 
Memory fragmentation is a constant pain for in-memory caching systems. Some systems, such as Redis, uses external memory management (malloc) and give all the responsibility to the system. This makes memory management simpler for cache designers. However, using external memory management incurs external [memory fragmentation](https://en.wikipedia.org/wiki/Fragmentation_(computing)). [previous work](https://www.usenix.org/system/files/conference/fast14/fast14-paper_rumble.pdf) has shown that this can cause more than 2x memory usage than intended. Moreover, when most/all DRAM is used, memory (re-)allocations become complicated and can cause high tail latency. 

Pelikan slab storage and Memcached use an in-application slab-based memory allocator with much better and stabler performance than malloc. However, the slab allocator still suffers from internal memory fragmentation and [slab calcification problem](https://blog.twitter.com/engineering/en_us/a/2012/caching-with-twemcache.html). 


To solve these problems, we have designed a new storage backend called Segcache, which is short for segment-structured cache. Segcache is similar to a log-structured cache with new features and constraints. 


## A high-level overview of Segcache
Pelikan Segcache has high memory efficiency, high performance, with the following features. 
1. Efficient and proactive TTL expiration: expired objects can be removed from cache within one second after expiration. 
2. Tiny object metadata: it only needs 5 bytes per object.[^3]
3. Almost no memory fragmentation. 
4. It uses a merge-based eviction algorithm to achieve a low miss ratio. 
5. It has similar throughput as the slab storage backend and up to 40% higher than state-of-the-art such as Memcached on a single thread. 
6. It supports close-to-linear scalability. At 24 threads, it achieves 8x higher throughput than Memcached.[^4]

[^3]: When we compare object metadata, we do not consider the memory usage of the hash table in any system. 
[^4]: When we measure throughput, we remove the networking stack and focus only on the storage stack. In production using kernel TCP/IP, the networking stack is often the throughput bottleneck. When we switch to a new networking stack (such as DPDK), the storage stack's throughput becomes important. 

{{< diagram size="full" alt="Segcache's three components. TTL buckets: one per TTL range, each heading a chain of segments; a write goes to the bucket for its TTL and is appended to the last segment of the chain. The chains link segments in the object store, which is divided into segments 1 to M, each a small fixed-size log of objects with similar TTLs. The hash table: each bucket has one slot of shared bucket info and seven object slots, and a full bucket chains to another; a read looks up the hash table, which locates the object in a segment." caption="*Figure 2.* The design of Segcache. A write appends the object to the last segment in its TTL bucket's chain; a read looks up the hash table, which points to the object's location in a segment." >}}
<style>
  .d-sd { display: grid; grid-template-columns: minmax(0, 1fr) 4.75rem minmax(0, 1fr) 4.75rem minmax(0, 1fr); }
  .d-sd-card { display: flex; flex-direction: column; padding: .8rem .85rem .85rem; border: 1px solid var(--fig-line); border-radius: 8px; background: var(--fig-surface); }
  .d-sd-io { align-self: flex-start; display: inline-flex; align-items: center; gap: .3rem; margin-bottom: .55rem; padding: .05rem .55rem; border: 1px solid #9ca3af; border-radius: 999px; background: #fff; font-size: .8125rem; font-weight: 600; }
  .d-sd-h { font-size: .9375rem; font-weight: 600; }
  .d-sd-sub { margin-bottom: .65rem; color: var(--fig-ink-2); }
  .d-sd-card > svg { display: block; width: 100%; height: auto; }
  .d-sd-note { margin-top: auto; padding-top: .7rem; color: var(--fig-ink-2); }
  .d-sd-link { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .35rem; padding: 0 .4rem; text-align: center; font-size: .8125rem; line-height: 1.25; color: var(--fig-ink-2); }
  .d-sd-link svg { width: 2.5rem; height: auto; }
  .d-sd-link--back svg { transform: scaleX(-1); }
  .d-sd-segs { display: grid; gap: .4rem; }
  .d-sd-seg { display: flex; align-items: center; gap: .55rem; height: 1.9rem; overflow: hidden; border: 1.5px solid #e8502c; border-radius: 4px; background: #fff; }
  .d-sd-seg::before { content: ""; align-self: stretch; width: .6rem; background: #e8502c; }
  .d-sd-seg--more { justify-content: center; border: 1.5px dashed #c3c8d0; color: var(--fig-muted); }
  .d-sd-seg--more::before { display: none; }
  .d-sd-key { display: flex; flex-wrap: wrap; gap: .2rem .9rem; margin-top: .55rem; font-size: .8125rem; color: var(--fig-ink-2); }
  .d-sd-key i { display: inline-block; width: .7rem; height: .7rem; margin-right: .35rem; border-radius: 2px; vertical-align: -.05rem; }
  /* Narrower than 44rem: stack the cards; connectors turn vertical. */
  @container (max-width: 44rem) {
    .d-sd { grid-template-columns: minmax(0, 1fr); max-width: 24rem; margin-inline: auto; }
    .d-sd-card > svg { max-width: 17rem; margin-inline: auto; }
    .d-sd-link { flex-direction: row; gap: .6rem; padding: .7rem 0; }
    .d-sd-link svg { width: 1.6rem; transform: rotate(90deg); }
    .d-sd-link--back svg { transform: rotate(-90deg); }
  }
</style>
<svg width="0" height="0" style="position: absolute" aria-hidden="true">
  <defs>
    <marker id="d-sd-ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0 0 L8 4 L0 8 z" fill="#4b5563"/>
    </marker>
  </defs>
</svg>
<div class="d-sd">
  <div class="d-sd-card">
    <span class="d-sd-io">write ↓</span>
    <div class="d-sd-h">TTL buckets</div>
    <div class="d-sd-sub">One per TTL range</div>
    <svg viewBox="0 0 220 132" aria-hidden="true">
      <g fill="#d1f2e6" stroke="#1baf7a" stroke-width="1.5">
        <rect x="6" y="6" width="30" height="20" rx="3"/><rect x="6" y="32" width="30" height="20" rx="3"/>
        <rect x="6" y="58" width="30" height="20" rx="3"/><rect x="6" y="84" width="30" height="20" rx="3"/>
        <rect x="6" y="110" width="30" height="20" rx="3"/>
      </g>
      <g fill="#fde0d6" stroke="#e8502c" stroke-width="1.5">
        <rect x="62" y="32" width="32" height="20" rx="3"/><rect x="118" y="32" width="32" height="20" rx="3"/>
        <rect x="174" y="32" width="32" height="20" rx="3"/><rect x="62" y="84" width="32" height="20" rx="3"/>
      </g>
      <g fill="none" stroke="#4b5563" stroke-width="1.5" marker-end="url(#d-sd-ah)">
        <path d="M37 42 H59"/><path d="M95 42 H115"/><path d="M151 42 H171"/><path d="M37 94 H59"/>
      </g>
      <path d="M31 53 C 58 80, 160 80, 188 55" fill="none" stroke="#4b5563" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#d-sd-ah)"/>
      <g font-size="12" text-anchor="middle" fill="#1f2328">
        <text x="78" y="46.5">S1</text><text x="134" y="46.5">S3</text><text x="190" y="46.5">S4</text><text x="78" y="98.5">S2</text>
      </g>
      <text x="134" y="22" font-size="11.5" text-anchor="middle" fill="#4b5563">segment chain</text>
    </svg>
    <div class="d-sd-note">Each bucket heads a chain of segments. Writes append to the last segment (dashed pointer).</div>
  </div>
  <div class="d-sd-link"><svg viewBox="0 0 40 12" aria-hidden="true"><path d="M2 6 H32" stroke="#4b5563" stroke-width="1.6"/><path d="M31 1.5 L39 6 L31 10.5 z" fill="#4b5563"/></svg>link segments in</div>
  <div class="d-sd-card">
    <div class="d-sd-h">Object store</div>
    <div class="d-sd-sub">The heap, split into segments</div>
    <div class="d-sd-segs">
      <div class="d-sd-seg">segment 1</div>
      <div class="d-sd-seg">segment 2</div>
      <div class="d-sd-seg d-sd-seg--more">…</div>
      <div class="d-sd-seg">segment M</div>
    </div>
    <div class="d-sd-note">A segment is a small fixed-size log of objects with similar TTLs, behind a shared header.</div>
  </div>
  <div class="d-sd-link d-sd-link--back"><svg viewBox="0 0 40 12" aria-hidden="true"><path d="M2 6 H32" stroke="#4b5563" stroke-width="1.6"/><path d="M31 1.5 L39 6 L31 10.5 z" fill="#4b5563"/></svg>locate objects in</div>
  <div class="d-sd-card">
    <span class="d-sd-io">read ↓</span>
    <div class="d-sd-h">Hash table</div>
    <div class="d-sd-sub">Bulk-chained buckets</div>
    <svg viewBox="0 0 220 98" aria-hidden="true">
      <defs>
        <g id="d-sd-bucket">
          <rect x="0" width="10.5" height="10.5" rx="1.5" fill="#e8502c"/>
          <g fill="#f5c542">
            <rect x="12" width="10.5" height="10.5" rx="1.5"/><rect x="24" width="10.5" height="10.5" rx="1.5"/>
            <rect x="36" width="10.5" height="10.5" rx="1.5"/><rect x="48" width="10.5" height="10.5" rx="1.5"/>
            <rect x="60" width="10.5" height="10.5" rx="1.5"/><rect x="72" width="10.5" height="10.5" rx="1.5"/>
            <rect x="84" width="10.5" height="10.5" rx="1.5"/>
          </g>
        </g>
      </defs>
      <use href="#d-sd-bucket" x="4" y="2"/><use href="#d-sd-bucket" x="4" y="18"/><use href="#d-sd-bucket" x="4" y="34"/>
      <use href="#d-sd-bucket" x="4" y="50"/><use href="#d-sd-bucket" x="4" y="66"/><use href="#d-sd-bucket" x="4" y="82"/>
      <use href="#d-sd-bucket" x="122" y="2"/><use href="#d-sd-bucket" x="122" y="50"/>
      <g fill="#f5c542"><rect x="122" y="2" width="10.5" height="10.5" rx="1.5"/><rect x="122" y="50" width="10.5" height="10.5" rx="1.5"/></g>
      <g fill="none" stroke="#4b5563" stroke-width="1.5" marker-end="url(#d-sd-ah)">
        <path d="M101 7.25 H119"/><path d="M101 55.25 H119"/>
      </g>
    </svg>
    <div class="d-sd-key"><span><i style="background: #e8502c"></i>bucket info (shared)</span><span><i style="background: #f5c542"></i>object info</span></div>
    <div class="d-sd-note">Eight slots per bucket, one cache line: one slot of shared bucket info and seven for objects. A full bucket chains to another.</div>
  </div>
</div>
{{< /diagram >}}


Segcache has three components. The first component is called object store, which is the heap (cache space) allocated to the cache. Segcache divides the heap into segments, where each segment is a small log storing objects of *similar TTLs*. There are some similarities between slab and segment. However, slabs store objects of similar sizes, whereas segments store objects of any size but similar TTLs. 
The second component is the hash table, which is used for fast lookups. Unlike the object chaining hash table in most caching systems, Segcache uses a bulk-chaining hash table, where on average, seven objects are hashed to one bucket. Each hash bucket has eight slots. The first one is used to store some metadata; the next seven slots store object information (similar to object pointers). Because each hash bucket fits in one CPU cacheline, searching the hash bucket is fast. 
The third component in Segcache is new, called TTL buckets. Segcache breaks all possible TTLs into ranges, and each TTL bucket is responsible for one range. Segments (recall that a segment is a group of objects with this TTL range) that have TTLs fall into the range are linked into a chain rooted at the TTL bucket. 

In the following section, we will briefly describe the design philosophy of Segcache. Interested readers can find more details in the paper linked at the end of the post. 


## Design philosophy 
Segcache has three design principles. 

### Sharing economy 
{{< diagram size="full" alt="Three panels. Memcached object store: every object is a block of per-object metadata followed by its data. Segcache object store: each segment starts with one shared header, and its objects carry only a thin sliver of their own metadata. Hash table: in each bucket, the first slot holds shared bucket info and the other seven hold object info." caption="*Figure 3.* Metadata sharing. Memcached keeps full metadata with every object. Segcache moves the shared parts into each segment header and each hash bucket, leaving about 5 bytes per object." >}}
<style>
  .d-ms { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
  .d-ms-card { display: flex; flex-direction: column; padding: .8rem .85rem .85rem; border: 1px solid var(--fig-line); border-radius: 8px; background: var(--fig-surface); }
  .d-ms-h { margin-bottom: .7rem; font-size: .9375rem; font-weight: 600; }
  .d-ms-store { display: grid; gap: .45rem; }
  .d-ms-row { display: flex; gap: .35rem; }
  .d-ms-obj { display: flex; flex: var(--g, 1) 1 0; min-width: 0; height: 1.2rem; }
  .d-ms-md { flex: 0 0 .9rem; border-radius: 2px 0 0 2px; background: #f5c542; }
  .d-ms-data { flex: 1; border-radius: 0 2px 2px 0; background: #9cc3ef; }
  .d-ms-seg { display: flex; gap: 2px; height: 1.75rem; padding: 2px; border: 1.5px solid #e8502c; border-radius: 4px; background: #fff; }
  .d-ms-hdr { flex: 0 0 .9rem; border-radius: 2px; background: #e8502c; }
  .d-ms-seg .d-ms-obj { height: auto; }
  .d-ms-seg .d-ms-md { flex-basis: 3px; }
  .d-ms-card > svg { display: block; width: 100%; height: auto; }
  .d-ms-note { margin-top: auto; padding-top: .75rem; color: var(--fig-ink-2); }
  @container (max-width: 44rem) {
    .d-ms { grid-template-columns: minmax(0, 1fr); max-width: 24rem; margin-inline: auto; }
    .d-ms-card > svg { max-width: 17rem; margin-inline: auto; }
  }
</style>
<div class="fig-legend">
  <span><i class="fig-key fig-key--box" style="--c: #f5c542"></i>Per-object metadata</span>
  <span><i class="fig-key fig-key--box" style="--c: #9cc3ef"></i>Object data</span>
  <span><i class="fig-key fig-key--box" style="--c: #e8502c"></i>Shared metadata</span>
</div>
<div class="d-ms">
  <div class="d-ms-card">
    <div class="d-ms-h">Memcached object store</div>
    <div class="d-ms-store">
      <div class="d-ms-row">
        <span class="d-ms-obj" style="--g: 2"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 1.6"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 1.6"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 1.8"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
      </div>
      <div class="d-ms-row">
        <span class="d-ms-obj" style="--g: 3"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 2"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
      </div>
      <div class="d-ms-row">
        <span class="d-ms-obj" style="--g: 1.6"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 2.6"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 1.8"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
      </div>
    </div>
    <div class="d-ms-note">Every object carries all of its own metadata: 56 bytes in Memcached.</div>
  </div>
  <div class="d-ms-card">
    <div class="d-ms-h">Segcache object store</div>
    <div class="d-ms-store">
      <div class="d-ms-seg">
        <i class="d-ms-hdr"></i>
        <span class="d-ms-obj" style="--g: 1.2"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 3"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 1"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 2.6"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
      </div>
      <div class="d-ms-seg">
        <i class="d-ms-hdr"></i>
        <span class="d-ms-obj" style="--g: 1.4"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 1.2"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 1.2"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 1.3"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
        <span class="d-ms-obj" style="--g: 2.6"><i class="d-ms-md"></i><i class="d-ms-data"></i></span>
      </div>
    </div>
    <div class="d-ms-note">Objects in a segment share its header: creation time, TTL, reference count and the next-segment pointer.</div>
  </div>
  <div class="d-ms-card">
    <div class="d-ms-h">Hash table</div>
    <!-- Reuses #d-sd-bucket and #d-sd-ah, defined in Figure 2. -->
    <svg viewBox="0 0 220 98" aria-hidden="true">
      <use href="#d-sd-bucket" x="4" y="2"/><use href="#d-sd-bucket" x="4" y="18"/><use href="#d-sd-bucket" x="4" y="34"/>
      <use href="#d-sd-bucket" x="4" y="50"/><use href="#d-sd-bucket" x="4" y="66"/><use href="#d-sd-bucket" x="4" y="82"/>
      <use href="#d-sd-bucket" x="122" y="2"/><use href="#d-sd-bucket" x="122" y="50"/>
      <g fill="#f5c542"><rect x="122" y="2" width="10.5" height="10.5" rx="1.5"/><rect x="122" y="50" width="10.5" height="10.5" rx="1.5"/></g>
      <g fill="none" stroke="#4b5563" stroke-width="1.5" marker-end="url(#d-sd-ah)">
        <path d="M101 7.25 H119"/><path d="M101 55.25 H119"/>
      </g>
    </svg>
    <div class="d-ms-note">Objects in a bucket share its first slot: an approximate last-access time, the CAS value and a spinlock.</div>
  </div>
</div>
{{< /diagram >}}

Sharing economy has become the norm of human society, and it has dramatically improved resource utilization. Similar ideas are also widely used in computer systems, cloud computing, multi-tenancy is common these days. Segcache applies a similar concept to reduce object metadata. It tries to maximize metadata sharing between objects in the same segment and objects in the same hash bucket. 
First, objects in the same segment share the same creation time, TTL, expiration time, reference counter, next segment (object) pointer. These metadata are stored in the segment header shared by all objects in the same segment (usually 1000s to 10,000s of objects). 
Second, objects in the same hash bucket share the same (precision-reduced) last access timestamp, CAS (compare-and-set) value, bucket-level spinlock. 

Notice that during this sharing, some metadata have to be approximate, such as time-related metadata. Such approximation can cause early expiration: objects expire earlier than specified. However, as we mentioned earlier, if we do not expire the object, we have to evict a different object that could potentially be used in the future. In other words, early expiration is not a problem. And we observe that objects near the end of TTL have very few accesses. 
By approximating and sharing object metadata, Segcache is able to reduce object metadata (5 bytes vs 56 bytes in Memcached), which significantly improves the cache utilization for small objects. 


### Be proactive, do not be lazy 
As we mentioned earlier, efficiently and timely removal of expired objects is critical in modern in-memory caching. The design of Segcache facilitates the efficient removal of expired objects. 

Segcache provides property for each TTL bucket called sorted expiration time. 
Each segment stores objects of similar TTL, objects in the same segment are sorted by creation time, and segments in the same segment chain are also sorted by creation time. Therefore, objects and segments from each TTL bucket are sorted by expiration time (creation time + TTL). In other words, if the first segment in the chain is not expired, the later segment will not expire as well. 

Such property allows Segcache to use a background thread to scan the TTL buckets (a small array of metadata) each second. If it finds an expired segment, then it removes all the objects from the segment and checks the next segment. During this process, Segcache examines **no** objects that are not expired, which is the key to why the proactive expiration is efficient in Segcache. 


### Macro management 
Managing objects is hard, and it limits the throughput and scalability of existing in-memory caching systems. Figure 4 compares a system that manages objects with a system that manages segments (groups of objects). 

{{< diagram size="large" alt="Two panels. Left, managing objects, for example in Memcached: objects sit in an object LRU queue and freed chunks in a free-chunk queue; a GET moves an object to the head of the LRU queue and a DELETE puts its chunk on the free-chunk queue, so most requests update a shared queue and take a lock, O(N request) locks. Right, managing segments in Segcache: objects are appended to segments chained per TTL bucket; a SET appends to the newest segment, and expiration or eviction frees a whole segment at once, so the chain changes only once per segment, O(N segment) locks." caption="*Figure 4.* Managing objects versus managing segments. An object-managed cache updates a shared queue, under a lock, on most requests. Segcache only changes its segment chains when a whole segment is added, expired, or evicted." >}}
<style>
  .d-mm { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  .d-mm-card { display: flex; flex-direction: column; padding: .85rem .95rem; border: 1px solid var(--fig-line); border-radius: 8px; background: var(--fig-surface); }
  .d-mm-h { font-size: .9375rem; font-weight: 600; }
  .d-mm-sub { margin-bottom: .75rem; color: var(--fig-ink-2); }
  .d-mm-q + .d-mm-q { margin-top: .8rem; }
  .d-mm-ql { margin-bottom: .3rem; font-weight: 600; }
  .d-mm svg { width: 100%; height: auto; }
  .d-mm-note { margin-top: .25rem; color: var(--fig-ink-2); }
  .d-mm-foot { margin-top: auto; padding-top: .7rem; }
  .d-mm-foot div { padding-top: .6rem; border-top: 1px solid var(--fig-line); }
  .d-mm-foot b { font-size: .9375rem; }
  @container (max-width: 36rem) {
    .d-mm { grid-template-columns: minmax(0, 1fr); }
  }
</style>
<svg width="0" height="0" style="position: absolute" aria-hidden="true">
  <defs>
    <marker id="d-mm-ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L8 4 L0 8 z" fill="#4b5563"/>
    </marker>
  </defs>
</svg>
<div class="d-mm">
  <div class="d-mm-card">
    <div class="d-mm-h">Manage objects</div>
    <div class="d-mm-sub">e.g., Memcached</div>
    <div class="d-mm-q">
      <div class="d-mm-ql">Object LRU queue</div>
      <svg viewBox="0 0 300 52" aria-hidden="true">
        <path d="M18 34 H282" stroke="#9ca3af" stroke-width="1.5"/>
        <g fill="#d4e4f7" stroke="#2a78d6" stroke-width="1.5">
          <rect x="6" y="24" width="24" height="20" rx="3"/><rect x="42" y="24" width="24" height="20" rx="3"/>
          <rect x="78" y="24" width="24" height="20" rx="3"/><rect x="114" y="24" width="24" height="20" rx="3"/>
          <rect x="150" y="24" width="24" height="20" rx="3"/><rect x="222" y="24" width="24" height="20" rx="3"/>
          <rect x="258" y="24" width="24" height="20" rx="3"/>
        </g>
        <rect x="186" y="24" width="24" height="20" rx="3" fill="#2a78d6"/>
        <path d="M198 21 C 170 2, 46 2, 21 19" fill="none" stroke="#4b5563" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#d-mm-ah)"/>
      </svg>
      <div class="d-mm-note">A GET moves the object to the head.</div>
    </div>
    <div class="d-mm-q">
      <div class="d-mm-ql">Free-chunk queue</div>
      <svg viewBox="0 0 300 52" aria-hidden="true">
        <path d="M18 34 H174" stroke="#9ca3af" stroke-width="1.5"/>
        <g fill="#ffffff" stroke="#2a78d6" stroke-width="1.5" stroke-dasharray="3 2">
          <rect x="6" y="24" width="24" height="20" rx="3"/><rect x="42" y="24" width="24" height="20" rx="3"/>
          <rect x="78" y="24" width="24" height="20" rx="3"/><rect x="114" y="24" width="24" height="20" rx="3"/>
          <rect x="150" y="24" width="24" height="20" rx="3"/>
        </g>
        <rect x="258" y="24" width="24" height="20" rx="3" fill="#2a78d6"/>
        <path d="M262 21 C 240 2, 200 2, 180 19" fill="none" stroke="#4b5563" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#d-mm-ah)"/>
      </svg>
      <div class="d-mm-note">A DELETE puts the freed chunk on the queue.</div>
    </div>
    <div class="d-mm-foot"><div><b>O(N<sub>request</sub>) locks</b><br>Most requests update a shared queue.</div></div>
  </div>
  <div class="d-mm-card">
    <div class="d-mm-h">Manage segments</div>
    <div class="d-mm-sub">Segcache</div>
    <div class="d-mm-q">
      <div class="d-mm-ql">Segment chain of one TTL bucket</div>
      <svg viewBox="0 0 300 52" aria-hidden="true">
        <path d="M94 34 H104 M190 34 H200" stroke="#9ca3af" stroke-width="1.5"/>
        <g fill="#ffffff" stroke-width="1.5">
          <rect x="6" y="22" width="88" height="24" rx="3" stroke="#c3c8d0" stroke-dasharray="3 2"/>
          <rect x="104" y="22" width="86" height="24" rx="3" stroke="#e8502c"/>
          <rect x="200" y="22" width="88" height="24" rx="3" stroke="#e8502c"/>
        </g>
        <g stroke="#e8502c" stroke-width="2.5" opacity=".75">
          <path d="M112 26 V42 M119 26 V42 M126 26 V42 M133 26 V42 M140 26 V42 M147 26 V42 M154 26 V42 M161 26 V42 M168 26 V42 M175 26 V42 M182 26 V42"/>
          <path d="M208 26 V42 M215 26 V42 M222 26 V42 M229 26 V42 M236 26 V42 M243 26 V42"/>
        </g>
        <path d="M14 26 V42 M21 26 V42 M28 26 V42 M35 26 V42 M42 26 V42 M49 26 V42 M56 26 V42 M63 26 V42 M70 26 V42 M77 26 V42 M84 26 V42" stroke="#c3c8d0" stroke-width="2.5"/>
        <path d="M276 3 V15" stroke="#e8502c" stroke-width="2.5"/>
        <path d="M271 9 C 260 9, 252 12, 251 20" fill="none" stroke="#4b5563" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#d-mm-ah)"/>
      </svg>
      <div class="d-mm-note">A SET appends to the newest segment. Objects never move between queues.</div>
    </div>
    <div class="d-mm-q">
      <div class="d-mm-ql">Expiration and eviction</div>
      <div class="d-mm-note">The oldest segment (dashed) is freed as a whole, with one chain update for thousands of objects.</div>
    </div>
    <div class="d-mm-foot"><div><b>O(N<sub>segment</sub>) locks</b><br>The chain changes once per segment.</div></div>
  </div>
</div>
{{< /diagram >}}

A system that manages objects often needs to maintain several queues, such as object LRU queue, free chunk queue. Most operations require touching at least one queue. For example, a get request moves an object to the LRU queue head,[^5] and a delete request requires moving the freed object space to the free chunk queue. In contrast, Segcache does not maintain object queues. It maintains segment queues, which requires much fewer bookkeeping operations. The necessary bookkeeping operations are performed sequentially in batch, which significantly improves the throughput. 

[^5]: Modern caching systems avoid popping up a popular object each time it gets a request, but still, the chain operation is $O(N_{\text{request}})$.  

Not only single-thread throughput, because all the chains' changes require locking, compared to an object-managed system,  Segcache reduces the locking frequency by 10,000 times. Why? The number of locking operations in object-managed systems is $O(N_{\text{request}})$, while the number of locking operations in Segcache is $O(N_{\text{segment}})$. If each segment stores 10,000 objects and write ratio is 10%, then Segcache locks once every 10,000 / 10% = 100,000 requests. 

Throughput and scalability are important for in-memory caches to fully utilize the power of modern hardware. As the number of objects stored in the cache continues to grow, we believe that macro-management is the key to high throughput and high scalability. 


## Evaluation
We evaluated Segcache using production traces from Twitter, and we compare Segcache with two production systems (Pelikan slab storage and Memcached) and two research systems (Hyperbolic and LHD). Because the two research systems do not consider TTL and they use random sampling in eviction, we add random sampling to expire objects in these two systems. In the following sections, we compare the memory efficiency, single-thread throughput, and multi-thread throughput. 

### Memory efficiency 
This is one of the most important metrics for caches. Instead of showing miss ratio curves (miss ratio vs cache size), we show the relative cache size to achieve the production miss ratios. This is more intuitive as it shows that if we want to achieve a production miss ratio, how much DRAM do we need for each system. 

{{< diagram size="small" caption="*Figure 5.* Cache size each system needs to reach the production miss ratio, relative to Pelikan slab storage (dashed line; lower is better). Segcache needs 42–88% less memory than Pelikan slab. Bars with a break mark run past the top of the scale." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--dash" style="--c: #4b5563"></i>Pelikan slab (= 1)</span>
  <span><i class="fig-key fig-key--box" style="--c: #2a78d6"></i>Memcached</span>
  <span><i class="fig-key fig-key--box" style="--c: #1baf7a"></i>Memcached + scanning</span>
  <span><i class="fig-key fig-key--box" style="--c: #eda100"></i>LHD + sampling</span>
  <span><i class="fig-key fig-key--box" style="--c: #6250d6"></i>Hyperbolic + sampling</span>
  <span><i class="fig-key fig-key--box" style="--c: #e8502c"></i>Segcache</span>
</div>
<div class="fig-plots fig-plots--1">
  <figure class="fig-plot">
    <div class="fig-plot-title">Cache size to reach the production miss ratio</div>
    <img src="figs/eval-memory-efficiency.svg" width="320" height="240" alt="Grouped bars of relative cache size for five Twitter workloads: content, user1, user2, negative and multi-tenant. Segcache needs 0.38, 0.58, 0.58, 0.45 and 0.13 of Pelikan slab's cache size, the lowest on every workload. LHD with sampling runs past the scale on user1, user2 and negative, as does Memcached on user2.">
  </figure>
</div>
{{< /diagram >}}

We observe that compared to Pelikan slab storage (the dashed line), Segcache reduces the memory footprint by 40%-90%. Compared to the state of the art, Segcache reduces the memory footprint by 22%-60%. This indicates that by switching to the new backend, we can significantly reduce the memory footprint. 


### Throughput and scalability
Besides memory efficiency, throughput and thread scalability are also critical. Figure 6 shows that Segcache achieves single-thread throughput similar to Pelikan slab storage, both of which are significantly higher than Memcached and the research systems. 

{{< diagram size="medium" caption="*Figure 6.* Throughput of the storage stack, with networking removed (higher is better). On one thread, Segcache is on par with Pelikan slab and faster than Memcached and the research systems on every workload. With more threads, Segcache scales almost linearly, reaching about 8× Memcached's throughput at 24 threads. Memcached + scanning is shown up to 8 threads." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box" style="--c: #4b5563"></i>Pelikan slab</span>
  <span><i class="fig-key fig-key--box" style="--c: #2a78d6"></i>Memcached</span>
  <span><i class="fig-key fig-key--box" style="--c: #1baf7a"></i>Memcached + scanning</span>
  <span><i class="fig-key fig-key--box" style="--c: #eda100"></i>LHD + sampling</span>
  <span><i class="fig-key fig-key--box" style="--c: #6250d6"></i>Hyperbolic + sampling</span>
  <span><i class="fig-key fig-key--box" style="--c: #e8502c"></i>Segcache</span>
</div>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Single thread</div>
    <img src="figs/eval-throughput.svg" width="320" height="240" alt="Grouped bars of single-thread throughput in million queries per second for five workloads. Segcache reaches 4.0, 5.5, 4.7, 4.2 and 3.8 MQPS, close to Pelikan slab's 4.0, 4.4, 5.4, 5.1 and 4.2, and above Memcached's 2.7 to 3.9 and every other system.">
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Scaling with threads</div>
    <img src="figs/eval-scalability.svg" width="320" height="240" alt="Throughput against 1 to 24 threads. Segcache grows almost linearly from about 4 to about 71 MQPS. Memcached levels off near 9 MQPS from 12 threads on. Memcached with scanning, shown up to 8 threads, tracks Memcached.">
  </figure>
</div>
{{< /diagram >}}

In terms of scalability, we observe that Memcached can scale to around 8 threads. After that, the throughput does not increase with cores. Meanwhile, Segcache can scale almost linearly to 24 threads, and at 24 threads, it achieves 8x higher throughput than Memcached. 


In conclusion, we recently designed a new storage backend for Pelikan, which is called Segcache. Segcache groups objects of similar TTLs into segments and provides efficient and proactive TTL expiration, tiny object metadata, and almost no memory fragmentation. As a result of this design, we show that Segcache can significantly reduce Twitter's current caching clusters' memory footprint. Besides, it allows Pelikan to better utilize the multiple cores of modern CPUs. 



### Related work
1. A more detailed description of Pelikan Segcache: https://www.usenix.org/conference/nsdi21/presentation/yang-juncheng
2. Previous work studying the production workloads at Twitter: https://www.usenix.org/system/files/osdi20-yang.pdf
