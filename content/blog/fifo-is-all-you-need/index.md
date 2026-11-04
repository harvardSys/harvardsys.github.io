+++
title = 'Why FIFO Is (Almost) All You Need for Cache Eviction'
date = 2026-07-28T11:00:00-04:00
author = 'Juncheng Yang'
draft = false
tags = ['caching', 'systems', 'cache-eviction', 'FIFO', 'S3-FIFO', 'SIEVE']
showToc = true
summary = 'LRU tries to rank everything. Production traces showed that caches need something simpler: reject one-hit objects quickly and delay promotion until it matters.'
+++

Cache eviction is usually presented as a ranking problem. LRU ranks objects by
recency. LFU ranks them by frequency. More advanced algorithms combine several
signals, adapt their parameters, and maintain increasingly sophisticated data
structures to decide which object is least valuable.

<!--more-->

For decades, the direction of progress seemed obvious: a more accurate ranking
should produce a better cache.

Production workloads pointed us somewhere else. The dominant problem was not
that caches ranked valuable objects poorly. It was that they spent too much
time ranking objects with no value to rank.

## The workload changed the question

Across production cache traces, a large fraction of objects are requested once
and never reused while they are resident in the cache.[^onehit] These objects
are often called one-hit wonders. They consume space, displace useful data,
and disappear without producing a single cache hit.

This effect is easy to underestimate. An object may appear twice in the full
trace and therefore look reusable. But if its second request arrives long
after any practical cache would have evicted the first copy, the cache
experiences two separate one-hit objects. What matters is not reuse somewhere
in the trace; it is reuse before eviction.

Once we looked at the workload this way, cache eviction stopped looking like
one ranking problem. It became two filtering problems:

- Quick demotion: How quickly can the cache remove a new object that has
  shown no evidence of reuse?
- Lazy promotion: How long can the cache wait before rewarding an object
  that has been reused?

We described these principles in
[FIFO Can Be Better than LRU: The Power of Lazy Promotion and Quick Demotion](https://sigops.org/s/conferences/hotos/2023/papers/yang.pdf).
They explain why a simple FIFO queue can outperform policies designed to track
the workload much more precisely.

## Where LRU spends the wrong work

LRU gives every new object the most privileged position in the cache: the head
of the queue. A one-hit object must travel through the entire queue before it
can be evicted. During a scan or burst of new traffic, many useless objects
receive this protection at once and push out data that would have been reused.
LRU demotes new objects too slowly.

LRU is also eager on a hit. Every access moves an object back to the head. In a
concurrent cache, that move means synchronization, pointer updates, and cache
coherence traffic. A popular object may be promoted thousands of times even
though the first promotion already moved it far from eviction.

FIFO has the opposite behavior. New objects advance steadily toward eviction,
so a one-hit object leaves after one pass through the queue. Hits do not change
the global ordering, so the cache avoids mutations on its hottest path.

Plain FIFO goes too far: it will eventually evict even a frequently requested
object. The useful design point lies just beyond it.

> Start with FIFO, then spend the smallest possible amount of state on a
> second chance.

## One bit of evidence

The basic second-chance mechanism is almost embarrassingly small. A new object
enters a FIFO queue with no evidence of reuse. A hit records one small piece of
evidence—a bit or a tiny counter—but does not move the object. Only when the
object approaches eviction does the cache decide whether that evidence earns
more time.

This delay is important. At insertion, the cache knows nothing about the
object. At the first hit, it knows the object was useful once. At eviction, it
knows both that the object has been reused and that keeping it now requires
evicting something else. The cache makes the expensive decision only when the
decision matters.

{{< diagram alt="A FIFO queue where objects enter at the head and an eviction scan runs from the tail, keeping objects that were requested again and dropping objects that were never reused" caption="One FIFO queue with one second chance: reused objects survive the scan and have their marker reset; objects never requested again are evicted from the tail" >}}
<style>
  /* Phone layouts for the three FIFO figures in this post (shared styles). */
  .d-ff { max-width: 24rem; margin-inline: auto; color: #171816; }
  .d-ff-t { font-size: 1.0625rem; font-weight: 600; }
  .d-ff-s { margin: .2rem 0 1.1rem; font-size: .875rem; color: #52514e; }
  .d-ff-lbl { font-size: .8125rem; font-weight: 600; color: #52514e; }
  .d-ff-m { font-size: .75rem; line-height: 1.3; color: #77756e; }
  .d-ff-q { display: flex; gap: .4rem; }
  .d-ff-q.v { flex-direction: column; }
  .d-ff-b { display: grid; place-items: center; width: 2.75rem; height: 2.5rem; background: #e9e6dc;
             border: 1.5px solid #cbc8bc; border-radius: 6px; }
  .d-ff-b.g { width: 1.9rem; height: 2.2rem; border-style: dashed; }
  .d-ff-o, .d-ff-k { position: relative; display: block; width: 1.25rem; height: 1.25rem; border-radius: 50%; }
  .d-ff-o { border: 2.2px solid #898781; }
  .d-ff-k { background: #1baf7a; }
  .d-ff-k::after { content: ""; position: absolute; left: .43rem; top: .22rem; width: .3rem; height: .58rem;
                    border: solid #fff; border-width: 0 2.4px 2.4px 0; transform: rotate(45deg); }
  .d-ff-blue { color: #2a78d6; } .d-ff-green { color: #1baf7a; } .d-ff-red { color: #e8502c; } .d-ff-gold { color: #b8862f; }
  /* Arrows: a line in currentColor with a head; .v = vertical, .up/.left reverse it, .dash = dashed */
  .d-ff-a { position: relative; display: block; height: 2.4px; background: currentColor; }
  .d-ff-a::after { content: ""; position: absolute; top: 50%; right: -1px; transform: translateY(-50%);
                    border: 5.5px solid transparent; border-left: 10px solid currentColor; border-right: 0; }
  .d-ff-a.left::after { right: auto; left: -1px; border-left: 0; border-right: 10px solid currentColor; }
  .d-ff-a.v { width: 2.4px; height: auto; }
  .d-ff-a.v::after { top: auto; right: auto; bottom: -1px; left: 50%; transform: translateX(-50%);
                      border: 5.5px solid transparent; border-top: 10px solid currentColor; border-bottom: 0; }
  .d-ff-a.v.up::after { bottom: auto; top: -1px; border-top: 0; border-bottom: 10px solid currentColor; }
  .d-ff-a.dash { background: repeating-linear-gradient(to right, currentColor 0 5px, transparent 5px 10px); }
  .d-ff-a.v.dash { background: repeating-linear-gradient(to bottom, currentColor 0 5px, transparent 5px 10px); }
  .d-ff-leg { display: grid; gap: .45rem; margin-top: 1.1rem; font-size: .8125rem; color: #52514e; }
  .d-ff-leg > div { display: flex; align-items: center; gap: .6rem; }
  .d-ff-leg i { flex: none; }

  /* One FIFO queue, one second chance */
  .d-sc { display: grid; grid-template-columns: minmax(0, 1fr) 2.75rem 2.25rem minmax(0, 1.4fr); column-gap: .6rem; align-items: center; }
  .d-sc > .c2 { grid-column: 2; justify-self: center; }
  .d-sc .in { height: 1.9rem; margin: .3rem 0 .35rem; }
  .d-sc .out { height: 1.9rem; margin: .35rem 0 .3rem; }
  .d-sc .side { grid-column: 1; grid-row: 3; text-align: right; }
  .d-sc .side.head { align-self: start; margin-top: .55rem; }
  .d-sc .side.tail { align-self: end; margin-bottom: .55rem; }
  .d-sc .scan { grid-column: 3; grid-row: 3; justify-self: center; align-self: stretch; margin: 1.1rem 0; color: #898781; }
  .d-sc .scan-t { grid-column: 4; grid-row: 3; }
  .d-sc .ev { grid-column: 3 / 5; grid-row: 4; }
  .d-sc .gone { opacity: .55; }
</style>
<img class="fig-wide-only" src="fifo-second-chance.svg" alt="" width="760" height="340" loading="lazy" decoding="async">
<div class="d-ff fig-narrow-only">
  <div class="d-ff-t">One FIFO queue, one second chance</div>
  <div class="d-ff-s">Objects enter at the head; an eviction scan from the tail keeps the reused and drops the one-hit.</div>
  <div class="d-sc">
    <span class="c2 d-ff-lbl d-ff-blue" style="white-space: nowrap">new object</span>
    <i class="c2 in d-ff-a v d-ff-blue"></i>
    <span class="side head d-ff-m">head<br>(newest)</span>
    <div class="c2 d-ff-q v" style="grid-row: 3"><span class="d-ff-b"><i class="d-ff-o"></i></span><span class="d-ff-b"><i class="d-ff-k"></i></span><span class="d-ff-b"><i class="d-ff-o"></i></span><span class="d-ff-b"><i class="d-ff-o"></i></span><span class="d-ff-b"><i class="d-ff-k"></i></span><span class="d-ff-b"><i class="d-ff-o"></i></span></div>
    <span class="side tail d-ff-m">tail<br>(oldest)</span>
    <i class="scan d-ff-a v up dash"></i>
    <span class="scan-t d-ff-m">eviction scan sweeps from the tail, clearing the marker on each reused object it passes</span>
    <i class="c2 out d-ff-a v d-ff-red" style="grid-row: 4"></i>
    <span class="ev d-ff-lbl d-ff-red">evict</span>
    <i class="c2 d-ff-o gone"></i>
    <span class="ev d-ff-m" style="grid-row: 5">never reused</span>
  </div>
  <div class="d-ff-leg">
    <div><i class="d-ff-k"></i>requested again since insertion: survives, marker reset</div>
    <div><i class="d-ff-o"></i>never requested again: evicted on the scan</div>
  </div>
</div>
{{< /diagram >}}

This idea produced two related algorithms:
[S3-FIFO](https://dl.acm.org/doi/10.1145/3600006.3613147)[^s3fifo] and
[SIEVE](https://www.usenix.org/system/files/nsdi24-zhang-yazhuo.pdf).[^sieve]
They share the same workload insight, but spend their second chance
differently.

## S3-FIFO: filter first, protect later

S3-FIFO uses three static FIFO queues:

- A small queue admits new objects and quickly filters out one-hit wonders.
- A main queue holds objects that have demonstrated reuse.
- A ghost queue stores only the keys of recently evicted objects, not their
  data.

Most new objects enter the small queue, which uses roughly 10% of the cache.
When an object reaches its tail, an object with no reuse is evicted. If the
object was requested again, it graduates to the main queue.

The ghost queue catches reuse that arrives just too late. When an evicted key
is requested again, the cache now has evidence that the object is recurring,
so it can bypass the small filter and enter the main queue directly.

The main queue provides longer-term protection without maintaining an exact
recency order. Hits update a small frequency counter rather than moving an
object immediately. At eviction time, the counter determines whether the
object leaves or receives another turn.

The queues have different jobs: the small queue supplies quick demotion, the
main queue supplies lazy promotion, and the ghost queue connects evidence
across cache residencies.

{{< diagram alt="S3-FIFO routes new objects through a small queue that either drops them or promotes them to a larger main queue, while a ghost queue of evicted keys can route a late repeat request straight into the main queue" caption="S3-FIFO: a small queue filters new objects, a ghost queue remembers what it dropped, and a main queue protects anything reused" >}}
<style>
  /* S3-FIFO, phone layout: S runs left to right, the queues then snake back up the
     right-hand side, so promotion and ghost hits both land on M's head. */
  .d-s3 { display: grid; grid-template-columns: minmax(0, 1fr) 2.6rem; column-gap: .35rem; }
  .d-s3 > * { grid-column: 1; }
  .d-s3 .row { display: flex; align-items: center; justify-content: flex-end; gap: .5rem; }
  .d-s3 .lbl { margin: .9rem 0 .4rem; }
  .d-s3 .lbl:first-child { margin-top: 0; }
  .d-s3 .ends { display: flex; justify-content: space-between; margin-top: .2rem; }
  .d-s3 .drop { display: flex; align-items: stretch; justify-content: flex-end; gap: .6rem; height: 2.6rem; margin-top: .25rem;
                 padding-right: calc(1.375rem - 1.2px); text-align: right; }
  .d-s3 .drop .d-ff-m { align-self: center; }
  .d-s3 .ghost-hit { padding-right: calc(.95rem - 1.2px); }
  .d-s3 .promote { position: relative; grid-column: 2; grid-row: 2 / 10; margin: 1.25rem .8rem 1.25rem -.1rem;
                    border: 2.4px solid #1baf7a; border-left: 0; border-radius: 0 .6rem .6rem 0; color: #1baf7a; }
  .d-s3 .promote::after { content: ""; position: absolute; bottom: -7px; left: -1px; border: 5.5px solid transparent;
                          border-right: 10px solid currentColor; border-left: 0; }
  .d-s3 .promote span { position: absolute; top: 50%; left: 100%; transform: translate(-50%, -50%) rotate(180deg);
                         padding: .3rem 0; writing-mode: vertical-rl; background: #fff; font-size: .75rem; white-space: nowrap; }
  .d-s3 .exit { width: 2.1rem; }
</style>
<img class="fig-wide-only" src="s3fifo-architecture.svg" alt="" width="960" height="270" loading="lazy" decoding="async">
<div class="d-ff fig-narrow-only">
  <div class="d-ff-t">S3-FIFO: filter first, protect later</div>
  <div class="d-ff-s">Three queues: a small filter, a ghost of what it dropped, and a larger main queue.</div>
  <div class="d-s3">
    <div class="lbl d-ff-lbl">small queue (S): ~10% of capacity</div>
    <div class="row"><span class="d-ff-m d-ff-blue">new</span><i class="d-ff-a d-ff-blue" style="width: 1.75rem"></i><span class="d-ff-b"><i class="d-ff-o"></i></span><span class="d-ff-b"><i class="d-ff-k"></i></span><span class="d-ff-b"><i class="d-ff-o"></i></span></div>
    <div class="ends d-ff-m"><span></span><span>tail</span></div>
    <div class="drop"><span class="d-ff-m d-ff-red">one-hit → drop,<br>keep only its key</span><i class="d-ff-a v d-ff-red"></i></div>
    <div class="lbl d-ff-lbl">ghost queue (G): keys only, no data</div>
    <div class="row"><span class="d-ff-b g"></span><span class="d-ff-b g"></span><span class="d-ff-b g"></span><span class="d-ff-b g"></span></div>
    <div class="drop ghost-hit"><span class="d-ff-m d-ff-gold">ghost hit → insert<br>into main, skip S</span><i class="d-ff-a v dash d-ff-gold"></i></div>
    <div class="lbl d-ff-lbl">main queue (M): the rest of the cache</div>
    <div class="row">
      <span class="d-ff-m" style="text-align: center">checked</span><i class="exit d-ff-a left dash" style="color: #898781"></i><span class="d-ff-b"><i class="d-ff-o"></i></span><span class="d-ff-b"><i class="d-ff-k"></i></span><span class="d-ff-b"><i class="d-ff-o"></i></span><span class="d-ff-b"><i class="d-ff-k"></i></span>
    </div>
    <div class="ends d-ff-m"><span style="margin-left: 5.2rem">tail</span><span>head</span></div>
    <div class="d-ff-m" style="margin-top: .6rem">At M's tail: reused → reinserted at the head; freq 0 → evicted.</div>
    <div class="promote"><span>reused → promote to main</span></div>
  </div>
</div>
{{< /diagram >}}

## SIEVE: leave the object where it is

SIEVE reduces the same insight to one queue, one visited bit per object, and
one moving hand.

New objects enter at the head. A hit sets the object's visited bit but does not
move it. When the cache needs space, the hand examines eviction candidates. If
an object has been visited, SIEVE clears the bit, leaves the object in place,
and advances the hand. The first unvisited object is evicted.

The hand does not restart from the tail after every eviction. It remembers its
position and continues from there the next time the cache needs space. This
small detail makes SIEVE different from a conventional second-chance queue:
objects survive in place rather than being reinserted at the head.

That means a hit never changes the queue. It performs no list operation and
needs no lock on the global eviction order. The design is simple enough to add
to an existing cache in a few lines, yet the parked hand prevents the repeated
tail scans that would otherwise waste work.

{{< diagram alt="SIEVE keeps one queue with a hand pointer that steps from the tail toward the head, clearing the visited bit and leaving an object in place if it was reused, or evicting it on the spot if not, then wrapping back to the tail" caption="SIEVE holds one queue and lets a hand carry its position across evictions instead of rescanning from the tail" >}}
<style>
  /* SIEVE, phone layout: the queue runs top (head) to bottom (tail); the hand climbs it. */
  .d-sv { --pitch: 2.9rem; display: grid; grid-template-columns: 4.5rem 2.75rem minmax(0, 1fr); column-gap: .75rem; }
  .d-sv .new { grid-column: 2; justify-self: center; }
  .d-sv .in { grid-column: 2; justify-self: center; height: 1.6rem; margin: .25rem 0 .35rem; }
  .d-sv .q { grid-column: 2; grid-row: 3; }
  .d-sv .q .d-ff-b { position: relative; }
  .d-sv .q .d-ff-k { position: absolute; }
  .d-sv .rail { position: relative; grid-column: 1; grid-row: 3; }
  .d-sv .hand { position: absolute; right: .1rem; bottom: .55rem; display: flex; align-items: center; gap: .3rem;
                 font-size: .75rem; animation: d-sv-hand 9s infinite; }
  .d-sv .hand .d-ff-a { width: 1.4rem; }
  .d-sv .ends { grid-column: 3; grid-row: 3; display: flex; flex-direction: column; justify-content: space-between; padding: .7rem 0; }
  .d-sv .notes { grid-column: 1 / 4; display: grid; gap: .4rem; margin-top: 1rem; }
  .d-sv .f6 { animation: d-sv-f6 9s infinite; } .d-sv .f5 { animation: d-sv-f5 9s infinite; }
  .d-sv .f3 { animation: d-sv-f3 9s infinite; } .d-sv .f1 { animation: d-sv-f1 9s infinite; }
  .d-sv .c4 { animation: d-sv-c4 9s infinite; } .d-sv .c2 { animation: d-sv-c2 9s infinite; }
  /* Same 9 s schedule as the wide SVG: the hand pauses on each object from the tail up. */
  @keyframes d-sv-hand {
    0%, 13.3% { transform: translateY(0); }
    16.7%, 30% { transform: translateY(calc(-1 * var(--pitch))); }
    33.3%, 46.7% { transform: translateY(calc(-2 * var(--pitch))); }
    50%, 63.3% { transform: translateY(calc(-3 * var(--pitch))); }
    66.7%, 80% { transform: translateY(calc(-4 * var(--pitch))); }
    83.3%, 100% { transform: translateY(calc(-5 * var(--pitch))); }
  }
  @keyframes d-sv-f6 { 0%, 5.9% { opacity: 1; } 6%, 96.9% { opacity: .15; } 97% { opacity: 1; } }
  @keyframes d-sv-f5 { 0%, 19.9% { opacity: 1; } 20%, 96.9% { opacity: .15; } 97% { opacity: 1; } }
  @keyframes d-sv-f3 { 0%, 52.9% { opacity: 1; } 53%, 96.9% { opacity: .15; } 97% { opacity: 1; } }
  @keyframes d-sv-f1 { 0%, 85.9% { opacity: 1; } 86%, 96.9% { opacity: .15; } 97% { opacity: 1; } }
  @keyframes d-sv-c4 { 0%, 36.9% { opacity: 1; } 37%, 96.9% { opacity: 0; } 97% { opacity: 1; } }
  @keyframes d-sv-c2 { 0%, 69.9% { opacity: 1; } 70%, 96.9% { opacity: 0; } 97% { opacity: 1; } }
</style>
<img class="fig-wide-only" src="sieve-architecture.svg" alt="" width="960" height="196" loading="lazy" decoding="async">
<div class="d-ff fig-narrow-only">
  <div class="d-ff-t">SIEVE: leave the object where it is</div>
  <div class="d-ff-s">One queue. The hand holds its position between evictions instead of rescanning from the tail.</div>
  <div class="d-sv">
    <span class="new d-ff-m d-ff-blue">new</span>
    <i class="in d-ff-a v d-ff-blue"></i>
    <div class="rail"><span class="hand d-ff-red"><b>hand</b><i class="d-ff-a"></i></span></div>
    <div class="q d-ff-q v"><span class="d-ff-b"><i class="d-ff-o f1"></i></span><span class="d-ff-b"><i class="d-ff-o"></i><i class="d-ff-k c2"></i></span><span class="d-ff-b"><i class="d-ff-o f3"></i></span><span class="d-ff-b"><i class="d-ff-o"></i><i class="d-ff-k c4"></i></span><span class="d-ff-b"><i class="d-ff-o f5"></i></span><span class="d-ff-b"><i class="d-ff-o f6"></i></span></div>
    <div class="ends d-ff-m"><span>head</span><span>tail</span></div>
    <div class="notes d-ff-m">
      <div><b>visited</b> → clear the bit, leave the object in place, step toward the head</div>
      <div><b>not visited</b> → evict here; the hand keeps this position for the next eviction</div>
    </div>
  </div>
</div>
{{< /diagram >}}

| | S3-FIFO | SIEVE |
| --- | --- | --- |
| Queue structure | Small, main, and ghost queues | One queue |
| Hit path | Update a tiny frequency counter | Set one visited bit |
| Second chance | Promote or reinsert at eviction | Clear the bit and leave the object in place |
| Main strength | Robust filtering across diverse workloads | Minimal implementation and synchronization |

## Simpler is also faster

These algorithms were designed from a workload observation, but their
simplicity produces a second benefit: scalability.

Across 6,594 traces from 14 datasets, S3-FIFO achieved a lower miss ratio
than each of 12 state-of-the-art algorithms in the comparison. On some
traces it reduced LRU's miss ratio by as much as 72%. In a separate
comparison, it matched LRU's hit ratio with roughly 46% less memory.

SIEVE, despite using less machinery, reduced ARC's miss ratio by up to
63.2% on skewed web workloads. Across the full evaluation, it was more
consistently competitive than algorithms with substantially more metadata and
adaptation logic.

The hit path is where the engineering difference becomes most visible. LRU
must coordinate updates to a shared order on every hit. FIFO-based algorithms
record local metadata and defer queue maintenance until eviction, which occurs
far less often.

At 16 threads, S3-FIFO sustained about 6× the throughput of an optimized
LRU implementation. Its sequential queue operations are also friendlier to
flash, where random rewrites increase write amplification and wear. SIEVE was
integrated into five production cache libraries with fewer than 20 lines of
change on average, and its prototype achieved about 2× the throughput of
an optimized 16-thread LRU.

This combination—lower miss ratios, fewer shared mutations, and small
implementations—helped the algorithms move beyond papers into production
systems and open-source cache libraries.

## Why "almost" matters

The argument is not that plain FIFO is universally optimal. No online eviction
algorithm wins on every workload, and pure FIFO can discard a hot object simply
because it is old.

The claim is that FIFO is a better starting point than we gave it credit for.
Once a cache can quickly discard one-hit wonders and give reused objects a
carefully delayed second chance, much of the value attributed to sophisticated
ranking appears without the ranking.

This changes how I think about cache design:

- Count metadata work as well as misses. A policy that saves a few misses
  by mutating a global list on every request may lose at the system level.
- Separate admission from protection. New objects have not earned the
  same treatment as objects with demonstrated reuse.
- Delay decisions until they matter. Eviction time contains more evidence
  than insertion time or the first hit.
- Make complexity justify itself. Every queue, counter, parameter, and
  lock should correspond to a workload behavior we can measure.

[^onehit]: This one-hit-wonder effect is quantified across the production
traces in the S3-FIFO study. On many web and key-value workloads, most
objects receive no second request during their effective cache lifetime,
even when they reappear much later in the complete trace.

[^s3fifo]: Juncheng Yang, Yazhuo Zhang, Ziyue Qiu, Yao Yue, and K. V. Rashmi.
"FIFO queues are all you need for cache eviction." In Proceedings of the
29th ACM Symposium on Operating Systems Principles (SOSP '23), 2023.
Project page: [https://s3fifo.com](https://s3fifo.com).

[^sieve]: Yazhuo Zhang, Juncheng Yang, Yao Yue, Ymir Vigfusson, and K. V.
Rashmi. "SIEVE is Simpler than LRU: an Efficient Turn-Key Eviction
Algorithm for Web Caches." In Proceedings of the 21st USENIX Symposium on
Networked Systems Design and Implementation (NSDI '24), 2024. Project
page: [https://sieve-cache.com](https://sieve-cache.com).
