+++

title = 'From Requests to Sessions: Workload characterization of Agentic Workloads'
date = 2026-11-04T00:00:00-05:00
author = 'William Nixon'

draft = false

tags = ['LLM', 'agents', 'systems', 'serving', 'workloads', 'caching']

summary = 'Our takeaways from analyzing coding-agent traffic from FreeInference.'

+++

In our paper, [From Requests to Sessions: A Large-Scale Characterization of Human-Driven Agentic Workloads](https://data.agentic-system.org/pdf/paper/from-requests-to-sessions.pdf), we analyze **3.7 months of production coding-agent traffic from [FreeInference](https://freeinference.org/)**. The trace contains roughly **12,000 sessions, 1.2 million LLM requests, and 209 billion input tokens** across 13 agent harnesses, alongside a separate SWE-Bench replay.

We study how agents interact with LLMs and tools, how their contexts grow, and what these patterns mean for serving latency, caching, and cost. The findings below focus on human-driven production sessions unless otherwise noted.

Here are six key takeaways from our analysis.

## 1. Although priced cheaply, cached tokens dominate session cost.

Coding agents repeatedly send their growing context with each LLM request. Most of these input tokens are reused through prefix caching, which avoids recomputation. However, reading cached tokens still incurs a cost, and that cost adds up over repeated requests.

The median request contains about **129,000 input tokens, with only about 500 uncached**. Outputs are much shorter, at roughly 200 tokens. In other words, each request introduces relatively little new prefill and decoding work.

As a result, **cached input accounts for 97.4% of input-token volume and 72.9% of modeled API cost** among requests with reported cache usage. Although cached tokens are much cheaper individually, their enormous volume makes them the largest contributor to cost. Our analysis uses reference prices of <span>$</span>1 per million cached input tokens, <span>$</span>10 per million fresh input tokens, and <span>$</span>50 per million output tokens.

{{< diagram size="large" caption="*Figure 1.* Requests carry long inputs with little new text. Repeated cache reads account for most modeled session cost." >}}
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Tokens per request</div>
    <div class="fig-legend">
      <span><i class="fig-key fig-key--blue"></i>Input</span>
      <span><i class="fig-key fig-key--red"></i>Uncached input</span>
      <span><i class="fig-key fig-key--green"></i>Output</span>
    </div>
    {{< plotly height="280" alt="CDF of tokens per request. Median input is 129.1K tokens, median uncached input 491, median output 227." >}}
    {
      "decimals": 2,
      "table": false,
      "data": [
        {"name": "Input", "color": "blue", "x": [10, 11.38, 12.95, 14.74, 16.78, 19.09, 21.73, 24.73, 28.15, 32.03, 36.46, 41.49, 47.22, 53.74, 61.17, 69.61, 79.23, 90.17, 102.6, 116.8, 132.9, 151.3, 172.2, 195.9, 223, 253.8, 288.9, 328.7, 374.1, 425.8, 484.6, 551.5, 627.7, 714.4, 813, 925.3, 1053, 1199, 1364, 1552, 1767, 2011, 2288, 2605, 2964, 3374, 3839, 4370, 4973, 5660, 5706, 6442, 7331, 8344, 8419, 9496, 10810, 12210, 12300, 14000, 15300, 15930, 18130, 18680, 20640, 23480, 24510, 26730, 27830, 30420, 30970, 34620, 36990, 39400, 44570, 44840, 51030, 57060, 58080, 65060, 66100, 75230, 85620, 89120, 97450, 110900, 126200, 134600, 143600, 163500, 186100, 196700, 211800, 241000, 261200, 274300, 312200, 355300, 404300, 412600, 460200, 522000, 523700, 596000, 622300, 678400, 757900, 772000, 878700, 920600, 1000000], "y": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.003, 0.004, 0.004, 0.005, 0.007, 0.008, 0.008, 0.01, 0.012, 0.013, 0.017, 0.018, 0.022, 0.029, 0.032, 0.039, 0.042, 0.05, 0.052, 0.065, 0.074, 0.084, 0.106, 0.107, 0.136, 0.164, 0.169, 0.202, 0.207, 0.251, 0.301, 0.318, 0.361, 0.424, 0.488, 0.52, 0.55, 0.608, 0.661, 0.684, 0.711, 0.757, 0.782, 0.796, 0.831, 0.864, 0.895, 0.9, 0.923, 0.946, 0.946, 0.964, 0.97, 0.98, 0.99, 0.991, 0.997, 0.998, 0.998]},
        {"name": "Uncached input", "color": "red", "x": [10, 11.38, 12.95, 14.74, 16.78, 19.09, 21.73, 24.73, 28.15, 31, 32.03, 36.46, 41.49, 47.22, 53.74, 55, 61.17, 69.61, 75, 79.23, 90.17, 91, 102.6, 115, 116.8, 126, 132.9, 151.3, 165, 172.2, 195.9, 201, 223, 227, 253.8, 288.9, 328.7, 331, 374.1, 425.8, 484.6, 543, 551.5, 627.7, 714.4, 748, 813, 925.3, 951, 1053, 1199, 1220, 1364, 1520, 1552, 1767, 1987, 2011, 2288, 2605, 2834, 2964, 3277, 3374, 3839, 4370, 4512, 4973, 5660, 6442, 6819, 7331, 8344, 9368, 9496, 10810, 12300, 14000, 15930, 18130, 19150, 20640, 23480, 26730, 30420, 34620, 39400, 44840, 51030, 58080, 66100, 75230, 85620, 97450, 110900, 126200, 143600, 160100, 163500, 186100, 211800, 241000, 274300, 312200, 322600, 355300, 404300, 460200, 523700, 596000, 678400, 772000, 878700, 1000000], "y": [0, 0, 0.001, 0.001, 0.001, 0.002, 0.002, 0.003, 0.003, 0.004, 0.005, 0.006, 0.008, 0.011, 0.013, 0.014, 0.018, 0.023, 0.026, 0.029, 0.037, 0.038, 0.049, 0.06, 0.063, 0.072, 0.081, 0.103, 0.12, 0.13, 0.162, 0.168, 0.199, 0.204, 0.243, 0.291, 0.339, 0.342, 0.391, 0.443, 0.495, 0.54, 0.546, 0.592, 0.638, 0.654, 0.678, 0.716, 0.724, 0.748, 0.778, 0.782, 0.802, 0.822, 0.825, 0.844, 0.86, 0.861, 0.876, 0.889, 0.898, 0.902, 0.91, 0.912, 0.921, 0.928, 0.93, 0.935, 0.941, 0.946, 0.948, 0.95, 0.954, 0.958, 0.958, 0.961, 0.964, 0.966, 0.969, 0.971, 0.972, 0.973, 0.975, 0.976, 0.978, 0.979, 0.98, 0.982, 0.983, 0.984, 0.986, 0.987, 0.988, 0.989, 0.991, 0.992, 0.993, 0.994, 0.994, 0.995, 0.996, 0.996, 0.997, 0.998, 0.998, 0.998, 0.998, 0.999, 0.999, 0.999, 0.999, 0.999, 1, 1]},
        {"name": "Output", "color": "green", "x": [10, 11.38, 12.95, 14.74, 16.78, 17, 19.09, 21.73, 24.73, 26, 28.15, 30, 32.03, 36, 36.46, 41.49, 43, 47.22, 49, 53.74, 61.17, 63, 69.61, 79.23, 80, 90.17, 94, 102.6, 116.8, 132.9, 151.3, 172.2, 195.9, 223, 253.8, 288.9, 328.7, 335, 374.1, 425.8, 484.6, 522, 551.5, 627.7, 687, 714.4, 813, 848, 925.3, 1053, 1107, 1199, 1364, 1483, 1552, 1767, 1924, 2011, 2288, 2545, 2605, 2964, 3346, 3374, 3839, 4370, 4965, 4973, 5660, 6442, 7331, 7992, 8344, 9496, 10810, 12300, 14000, 15930, 18130, 20640, 23480, 26730, 30420, 34620, 39400, 44840, 51030, 58080, 66100, 75230, 85620, 97450, 110900, 126200, 143600, 163500, 186100, 211800, 241000, 274300, 293300], "y": [0, 0.001, 0.002, 0.003, 0.004, 0.004, 0.006, 0.007, 0.009, 0.01, 0.012, 0.014, 0.018, 0.024, 0.025, 0.038, 0.04, 0.053, 0.056, 0.072, 0.093, 0.096, 0.118, 0.148, 0.148, 0.184, 0.194, 0.228, 0.27, 0.314, 0.359, 0.404, 0.449, 0.493, 0.537, 0.581, 0.626, 0.632, 0.666, 0.704, 0.74, 0.76, 0.774, 0.804, 0.824, 0.831, 0.856, 0.864, 0.878, 0.897, 0.904, 0.914, 0.929, 0.938, 0.942, 0.953, 0.96, 0.963, 0.971, 0.976, 0.977, 0.982, 0.986, 0.986, 0.989, 0.992, 0.994, 0.994, 0.996, 0.997, 0.997, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 1, 1, 1, 1, 1, 1, 1, 1]},
        {"name": "Input median", "legendgroup": "Input", "color": "blue", "x": [129100], "y": [0.5], "mode": "markers+text", "text": ["129.1K"], "textposition": "middle left", "textfont": {"size": 12, "color": "#1f2328", "shadow": "0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff"}, "marker": {"size": 8}, "cliponaxis": false, "hovertemplate": null, "hoverinfo": "skip", "table": false},
        {"name": "Uncached input median", "legendgroup": "Uncached input", "color": "red", "x": [491], "y": [0.5], "mode": "markers+text", "text": ["491"], "textposition": "middle right", "textfont": {"size": 12, "color": "#1f2328", "shadow": "0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff"}, "marker": {"size": 8}, "cliponaxis": false, "hovertemplate": null, "hoverinfo": "skip", "table": false},
        {"name": "Output median", "legendgroup": "Output", "color": "green", "x": [227], "y": [0.5], "mode": "markers+text", "text": ["227"], "textposition": "middle left", "textfont": {"size": 12, "color": "#1f2328", "shadow": "0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff"}, "marker": {"size": 8}, "cliponaxis": false, "hovertemplate": null, "hoverinfo": "skip", "table": false}
      ],
      "layout": {"xaxis": {"title": {"text": "Tokens"}, "type": "log", "range": [1, 6], "tickvals": [10, 100, 1000, 10000, 100000, 1000000], "ticktext": ["10", "100", "1K", "10K", "100K", "1M"], "unifiedhovertitle": {"text": "%{x:,.0f} tokens"}}, "yaxis": {"title": {"text": "CDF"}, "range": [0, 1.02], "tickvals": [0, 0.25, 0.5, 0.75, 1]}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Modeled cost by session</div>
    <div class="fig-legend">
      <span><i class="fig-key fig-key--box fig-key--blue"></i>Cached input</span>
      <span><i class="fig-key fig-key--box fig-key--red"></i>Uncached input</span>
      <span><i class="fig-key fig-key--box fig-key--green"></i>Output</span>
    </div>
    {{< plotly height="280" alt="Share of each session's modeled cost from cached input, uncached input and output, with sessions sorted by percentile. Cached input grows from under 10% to over 90% of cost across sessions." >}}
    {
      "decimals": 2,
      "table": false,
      "data": [
        {"name": "Cached input", "color": "blue", "stackgroup": "cost", "x": [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5, 42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5, 49.5, 50.5, 51.5, 52.5, 53.5, 54.5, 55.5, 56.5, 57.5, 58.5, 59.5, 60.5, 61.5, 62.5, 63.5, 64.5, 65.5, 66.5, 67.5, 68.5, 69.5, 70.5, 71.5, 72.5, 73.5, 74.5, 75.5, 76.5, 77.5, 78.5, 79.5, 80.5, 81.5, 82.5, 83.5, 84.5, 85.5, 86.5, 87.5, 88.5, 89.5, 90.5, 91.5, 92.5, 93.5, 94.5, 95.5, 96.5, 97.5, 98.5, 99.5], "y": [0.0391, 0.088, 0.1093, 0.1402, 0.1648, 0.1868, 0.1964, 0.2084, 0.2262, 0.2281, 0.2439, 0.2512, 0.2601, 0.2675, 0.2811, 0.3042, 0.3023, 0.314, 0.313, 0.3329, 0.3336, 0.3436, 0.359, 0.3728, 0.3852, 0.3995, 0.3933, 0.4098, 0.4094, 0.4208, 0.4188, 0.4274, 0.4498, 0.438, 0.4642, 0.4641, 0.4846, 0.462, 0.4803, 0.5093, 0.4999, 0.5029, 0.521, 0.5108, 0.5191, 0.5294, 0.5425, 0.5536, 0.5479, 0.5531, 0.561, 0.5703, 0.582, 0.5874, 0.5778, 0.6157, 0.6037, 0.6221, 0.6176, 0.6185, 0.6354, 0.6338, 0.6498, 0.6541, 0.6522, 0.6621, 0.674, 0.6759, 0.6887, 0.6881, 0.6848, 0.7, 0.6978, 0.7163, 0.7137, 0.7273, 0.7289, 0.7331, 0.7432, 0.7512, 0.7578, 0.7624, 0.7701, 0.78, 0.7856, 0.8008, 0.8035, 0.8156, 0.8128, 0.8298, 0.8429, 0.8536, 0.8584, 0.8723, 0.8895, 0.8978, 0.9097, 0.9222, 0.9374, 0.9555]},
        {"name": "Uncached input", "color": "red", "stackgroup": "cost", "x": [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5, 42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5, 49.5, 50.5, 51.5, 52.5, 53.5, 54.5, 55.5, 56.5, 57.5, 58.5, 59.5, 60.5, 61.5, 62.5, 63.5, 64.5, 65.5, 66.5, 67.5, 68.5, 69.5, 70.5, 71.5, 72.5, 73.5, 74.5, 75.5, 76.5, 77.5, 78.5, 79.5, 80.5, 81.5, 82.5, 83.5, 84.5, 85.5, 86.5, 87.5, 88.5, 89.5, 90.5, 91.5, 92.5, 93.5, 94.5, 95.5, 96.5, 97.5, 98.5, 99.5], "y": [0.8457, 0.7161, 0.5896, 0.636, 0.6217, 0.6178, 0.5716, 0.5472, 0.5408, 0.486, 0.4864, 0.4637, 0.4434, 0.421, 0.4229, 0.4456, 0.4111, 0.4073, 0.3798, 0.3914, 0.3664, 0.3607, 0.3652, 0.3658, 0.3649, 0.3688, 0.3415, 0.3463, 0.3291, 0.3269, 0.308, 0.3033, 0.3174, 0.2874, 0.3054, 0.2919, 0.3016, 0.2634, 0.2695, 0.2869, 0.265, 0.2548, 0.2616, 0.2399, 0.2368, 0.2351, 0.2361, 0.2347, 0.2189, 0.2133, 0.2087, 0.2068, 0.2071, 0.2034, 0.1874, 0.2064, 0.1887, 0.1932, 0.1816, 0.1747, 0.1771, 0.1675, 0.1694, 0.1642, 0.1543, 0.1522, 0.1515, 0.1447, 0.1442, 0.1374, 0.1292, 0.1305, 0.1219, 0.1249, 0.1169, 0.1163, 0.1094, 0.1039, 0.1024, 0.0987, 0.0942, 0.0889, 0.0851, 0.0811, 0.0762, 0.0741, 0.0672, 0.0647, 0.0558, 0.0543, 0.0509, 0.0466, 0.0405, 0.0369, 0.0333, 0.028, 0.0244, 0.0205, 0.0161, 0.0104]},
        {"name": "Output", "color": "green", "stackgroup": "cost", "x": [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5, 42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5, 49.5, 50.5, 51.5, 52.5, 53.5, 54.5, 55.5, 56.5, 57.5, 58.5, 59.5, 60.5, 61.5, 62.5, 63.5, 64.5, 65.5, 66.5, 67.5, 68.5, 69.5, 70.5, 71.5, 72.5, 73.5, 74.5, 75.5, 76.5, 77.5, 78.5, 79.5, 80.5, 81.5, 82.5, 83.5, 84.5, 85.5, 86.5, 87.5, 88.5, 89.5, 90.5, 91.5, 92.5, 93.5, 94.5, 95.5, 96.5, 97.5, 98.5, 99.5], "y": [0.1152, 0.1959, 0.3011, 0.2238, 0.2136, 0.1953, 0.232, 0.2445, 0.233, 0.2859, 0.2697, 0.2851, 0.2965, 0.3115, 0.2959, 0.2502, 0.2866, 0.2787, 0.3071, 0.2757, 0.3, 0.2957, 0.2758, 0.2614, 0.2499, 0.2317, 0.2652, 0.244, 0.2616, 0.2523, 0.2731, 0.2693, 0.2328, 0.2746, 0.2305, 0.244, 0.2138, 0.2746, 0.2501, 0.2038, 0.2351, 0.2423, 0.2174, 0.2493, 0.2441, 0.2355, 0.2214, 0.2117, 0.2332, 0.2336, 0.2303, 0.2229, 0.2109, 0.2092, 0.2348, 0.1779, 0.2076, 0.1846, 0.2007, 0.2068, 0.1874, 0.1987, 0.1808, 0.1817, 0.1935, 0.1857, 0.1745, 0.1794, 0.1671, 0.1746, 0.186, 0.1695, 0.1803, 0.1588, 0.1693, 0.1564, 0.1617, 0.163, 0.1543, 0.1501, 0.148, 0.1487, 0.1448, 0.1389, 0.1382, 0.1251, 0.1293, 0.1198, 0.1314, 0.1158, 0.1062, 0.0998, 0.1011, 0.0908, 0.0772, 0.0742, 0.0659, 0.0573, 0.0465, 0.034]}
      ],
      "layout": {"margin": {"r": 14}, "xaxis": {"title": {"text": "Session percentile"}, "range": [0, 100], "tickvals": [0, 25, 50, 75, 100], "unifiedhovertitle": {"text": "Percentile %{x:.0f}"}}, "yaxis": {"range": [0, 1], "tickvals": [0, 0.25, 0.5, 0.75, 1], "title": {"text": "Share of cost"}}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

**Implications:** **Serving systems** should optimize the cost of serving cache hits, not just reducing cache misses. **Agent harnesses** should focus on reducing unnecessary LLM–tool steps, since each additional request may reread hundreds of thousands of cached tokens. **Users** should pay closer attention to cache-read pricing when comparing models, rather than looking only at input and output token prices.

## 2. Tools are the main bottleneck in active sessions, while user idle time dominates overall session duration.

Coding agents alternate between LLM inference, tool execution, and waiting for users. Faster inference only improves part of this process.

On average, user idle time accounts for **50.3% of session duration**, followed by tools at **21.7%**, decode at **18.1%**, and prefill at **9.9%**. For externally routed models, queueing and other provider overheads can also contribute substantially to time before the first token.

We simulated the effect of halving the time spent on each component. Excluding user idle time and capping tool gaps at 15 minutes, **halving tool time produces a 1.38× speedup**, compared with **1.09× for prefill** and **1.16× for decode**.

{{< diagram size="large" caption="*Figure 2.* Tool acceleration provides the largest active-session speedup in this what-if analysis. User idle time is excluded and tool gaps are capped at 15 minutes." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box fig-key--blue"></i>Prefill</span>
  <span><i class="fig-key fig-key--box fig-key--amber"></i>Decode</span>
  <span><i class="fig-key fig-key--box fig-key--green"></i>Tool</span>
  <span><i class="fig-key fig-key--box fig-key--red"></i>User idle</span>
</div>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Where session time goes</div>
    {{< plotly height="280" alt="Share of session time in prefill, decode, tools and user idle, with sessions sorted by percentile. User idle time grows from almost nothing to almost all of the session across percentiles; on average it is 50.3% of session time." >}}
    {
      "decimals": 2,
      "table": false,
      "data": [
        {"name": "Prefill", "color": "blue", "stackgroup": "time", "x": [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5, 42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5, 49.5, 50.5, 51.5, 52.5, 53.5, 54.5, 55.5, 56.5, 57.5, 58.5, 59.5, 60.5, 61.5, 62.5, 63.5, 64.5, 65.5, 66.5, 67.5, 68.5, 69.5, 70.5, 71.5, 72.5, 73.5, 74.5, 75.5, 76.5, 77.5, 78.5, 79.5, 80.5, 81.5, 82.5, 83.5, 84.5, 85.5, 86.5, 87.5, 88.5, 89.5, 90.5, 91.5, 92.5, 93.5, 94.5, 95.5, 96.5, 97.5, 98.5, 99.5], "y": [0.1361, 0.1746, 0.1827, 0.1738, 0.1821, 0.1799, 0.1823, 0.2109, 0.1972, 0.1819, 0.1838, 0.1786, 0.1478, 0.1612, 0.1527, 0.1575, 0.1314, 0.1498, 0.1646, 0.1568, 0.1585, 0.1742, 0.1517, 0.1552, 0.1508, 0.158, 0.1457, 0.1409, 0.1516, 0.1373, 0.1496, 0.137, 0.1322, 0.1414, 0.1246, 0.1427, 0.1421, 0.1268, 0.1196, 0.1248, 0.1287, 0.1178, 0.1143, 0.1178, 0.1092, 0.1, 0.1047, 0.1176, 0.0978, 0.1027, 0.1082, 0.1179, 0.0988, 0.0894, 0.1016, 0.0986, 0.0921, 0.0879, 0.0899, 0.0887, 0.0813, 0.0845, 0.0817, 0.0794, 0.0745, 0.0721, 0.0717, 0.0656, 0.0656, 0.063, 0.0618, 0.0541, 0.0572, 0.053, 0.0479, 0.053, 0.0442, 0.0388, 0.0447, 0.0407, 0.0372, 0.0379, 0.0372, 0.0294, 0.0278, 0.0261, 0.0255, 0.022, 0.0217, 0.0159, 0.0138, 0.012, 0.0102, 0.0097, 0.0082, 0.0065, 0.005, 0.0034, 0.002, 0.0008]},
        {"name": "Decode", "color": "amber", "stackgroup": "time", "x": [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5, 42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5, 49.5, 50.5, 51.5, 52.5, 53.5, 54.5, 55.5, 56.5, 57.5, 58.5, 59.5, 60.5, 61.5, 62.5, 63.5, 64.5, 65.5, 66.5, 67.5, 68.5, 69.5, 70.5, 71.5, 72.5, 73.5, 74.5, 75.5, 76.5, 77.5, 78.5, 79.5, 80.5, 81.5, 82.5, 83.5, 84.5, 85.5, 86.5, 87.5, 88.5, 89.5, 90.5, 91.5, 92.5, 93.5, 94.5, 95.5, 96.5, 97.5, 98.5, 99.5], "y": [0.4044, 0.4487, 0.4468, 0.4305, 0.4013, 0.4142, 0.4171, 0.3752, 0.3242, 0.2814, 0.27, 0.3087, 0.2476, 0.3124, 0.3053, 0.2779, 0.2613, 0.2877, 0.2855, 0.3124, 0.2753, 0.3225, 0.291, 0.2724, 0.2822, 0.2685, 0.2667, 0.2791, 0.2438, 0.2824, 0.2644, 0.2588, 0.221, 0.245, 0.2391, 0.2473, 0.2395, 0.2294, 0.2372, 0.2136, 0.1942, 0.1975, 0.228, 0.2162, 0.2133, 0.1979, 0.201, 0.2086, 0.191, 0.1881, 0.1618, 0.1736, 0.1514, 0.165, 0.1521, 0.1608, 0.1611, 0.1467, 0.1332, 0.1354, 0.1407, 0.1314, 0.1242, 0.1448, 0.1251, 0.1162, 0.1109, 0.109, 0.0933, 0.1021, 0.0933, 0.0985, 0.0825, 0.0838, 0.0869, 0.074, 0.0753, 0.0716, 0.0679, 0.0624, 0.0583, 0.0561, 0.049, 0.0519, 0.042, 0.0459, 0.0344, 0.0338, 0.0306, 0.0295, 0.023, 0.0189, 0.0189, 0.0159, 0.0122, 0.0103, 0.0073, 0.0054, 0.003, 0.0012]},
        {"name": "Tool", "color": "green", "stackgroup": "time", "x": [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5, 42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5, 49.5, 50.5, 51.5, 52.5, 53.5, 54.5, 55.5, 56.5, 57.5, 58.5, 59.5, 60.5, 61.5, 62.5, 63.5, 64.5, 65.5, 66.5, 67.5, 68.5, 69.5, 70.5, 71.5, 72.5, 73.5, 74.5, 75.5, 76.5, 77.5, 78.5, 79.5, 80.5, 81.5, 82.5, 83.5, 84.5, 85.5, 86.5, 87.5, 88.5, 89.5, 90.5, 91.5, 92.5, 93.5, 94.5, 95.5, 96.5, 97.5, 98.5, 99.5], "y": [0.4591, 0.3756, 0.3687, 0.393, 0.4131, 0.4011, 0.3942, 0.405, 0.4654, 0.5182, 0.52, 0.4768, 0.5582, 0.4662, 0.468, 0.4766, 0.5061, 0.4474, 0.4214, 0.3907, 0.4119, 0.3361, 0.3767, 0.3781, 0.3597, 0.353, 0.3533, 0.3339, 0.3466, 0.3096, 0.303, 0.3088, 0.3388, 0.2928, 0.302, 0.2629, 0.2588, 0.2716, 0.2598, 0.2675, 0.2714, 0.2662, 0.2274, 0.2244, 0.224, 0.2368, 0.2166, 0.1836, 0.2095, 0.1943, 0.2031, 0.1701, 0.2001, 0.1859, 0.1759, 0.1592, 0.1541, 0.1605, 0.1596, 0.1465, 0.1356, 0.1311, 0.1306, 0.1026, 0.1149, 0.1151, 0.1092, 0.1073, 0.1115, 0.0953, 0.0949, 0.0869, 0.0892, 0.081, 0.0734, 0.0703, 0.0682, 0.0686, 0.0577, 0.057, 0.0554, 0.0471, 0.0465, 0.0426, 0.043, 0.0317, 0.0345, 0.0298, 0.0258, 0.0239, 0.024, 0.0225, 0.0165, 0.0125, 0.011, 0.0081, 0.0059, 0.0036, 0.0022, 0.0008]},
        {"name": "User idle", "color": "red", "stackgroup": "time", "x": [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5, 42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5, 49.5, 50.5, 51.5, 52.5, 53.5, 54.5, 55.5, 56.5, 57.5, 58.5, 59.5, 60.5, 61.5, 62.5, 63.5, 64.5, 65.5, 66.5, 67.5, 68.5, 69.5, 70.5, 71.5, 72.5, 73.5, 74.5, 75.5, 76.5, 77.5, 78.5, 79.5, 80.5, 81.5, 82.5, 83.5, 84.5, 85.5, 86.5, 87.5, 88.5, 89.5, 90.5, 91.5, 92.5, 93.5, 94.5, 95.5, 96.5, 97.5, 98.5, 99.5], "y": [0.0004, 0.0011, 0.0018, 0.0026, 0.0035, 0.0047, 0.0063, 0.009, 0.0132, 0.0185, 0.0262, 0.0359, 0.0464, 0.0602, 0.074, 0.0881, 0.1012, 0.115, 0.1284, 0.1402, 0.1543, 0.1673, 0.1805, 0.1943, 0.2073, 0.2205, 0.2343, 0.2461, 0.258, 0.2707, 0.283, 0.2955, 0.308, 0.3208, 0.3343, 0.3471, 0.3596, 0.3722, 0.3833, 0.3941, 0.4057, 0.4185, 0.4304, 0.4416, 0.4535, 0.4653, 0.4777, 0.4902, 0.5016, 0.515, 0.527, 0.5384, 0.5497, 0.5597, 0.5704, 0.5814, 0.5927, 0.6049, 0.6172, 0.6294, 0.6424, 0.6531, 0.6635, 0.6732, 0.6855, 0.6966, 0.7081, 0.7182, 0.7296, 0.7396, 0.75, 0.7605, 0.7712, 0.7822, 0.7918, 0.8026, 0.8123, 0.821, 0.8297, 0.8398, 0.8491, 0.8589, 0.8673, 0.8761, 0.8872, 0.8964, 0.9057, 0.9144, 0.9219, 0.9307, 0.9393, 0.9466, 0.9544, 0.9619, 0.9686, 0.9752, 0.9818, 0.9876, 0.9928, 0.9973]}
      ],
      "layout": {"margin": {"r": 14}, "xaxis": {"title": {"text": "Session percentile"}, "range": [0, 100], "tickvals": [0, 25, 50, 75, 100], "unifiedhovertitle": {"text": "Percentile %{x:.0f}"}}, "yaxis": {"range": [0, 1], "tickvals": [0, 0.25, 0.5, 0.75, 1], "title": {"text": "Share of session time"}}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Speedup if one part is 2× faster</div>
    {{< plotly height="280" alt="Session speedup when one component runs twice as fast, excluding user idle time with tool gaps capped at 15 minutes: prefill 1.09×, decode 1.16×, tools 1.38×." >}}
    {
      "table": false,
      "data": [
        {"type": "bar", "orientation": "h", "name": "Prefill", "color": "blue", "y": ["Prefill"], "x": [1.094], "texttemplate": "%{x:.2f}×", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}, "hovertemplate": "%{fullData.name}: %{x:.2f}×<extra></extra>"},
        {"type": "bar", "orientation": "h", "name": "Decode", "color": "amber", "y": ["Decode"], "x": [1.164], "texttemplate": "%{x:.2f}×", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}, "hovertemplate": "%{fullData.name}: %{x:.2f}×<extra></extra>"},
        {"type": "bar", "orientation": "h", "name": "Tool", "color": "green", "y": ["Tools"], "x": [1.376], "texttemplate": "%{x:.2f}×", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}, "hovertemplate": "%{fullData.name}: %{x:.2f}×<extra></extra>"}
      ],
      "layout": {"barmode": "overlay", "bargap": 0.6, "xaxis": {"title": {"text": "Session speedup"}, "range": [1, 1.488], "tickvals": [1, 1.1, 1.2, 1.3, 1.4], "ticksuffix": "×"}, "yaxis": {"categoryorder": "array", "categoryarray": ["Prefill", "Decode", "Tools"]}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

**Implications:** Faster LLM inference alone may not translate into much faster agents. **Agent harnesses** should prioritize lower-latency tools, reduce unnecessary tool calls, and request user clarification early, potentially asynchronously. **Serving systems** should reduce queueing delays through better scheduling and load balancing, while **hardware and runtime designers** should pay more attention to tool-execution workloads.

## 3. Tool parallelism is underused, and subagents wait for stragglers

Many tool calls can run independently, but agents often execute them one at a time. We found that **84.5% of tool-calling requests issue only one tool call**, even though batching appears in many sessions.

Batching independent calls can avoid repeated model–tool round trips. In our analysis, observed batched latency remains relatively flat as the number of calls grows, while a projected serial execution path becomes longer.

{{< diagram size="large" caption="*Figure 3.* Batching independent tools avoids repeated model–tool round trips. Serial latency is projected; batched latency comes from the trace." >}}
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Step latency by batch size</div>
    <div class="fig-legend">
      <span><i class="fig-key fig-key--gray fig-key--dash"></i>Serial calls (projected)</span>
      <span><i class="fig-key fig-key--green"></i>Batched (median)</span>
      <span><i class="fig-key fig-key--box" style="--c: rgb(27 175 122 / .28)"></i>25th–75th</span>
      <span><i class="fig-key fig-key--box" style="--c: rgb(27 175 122 / .12)"></i>10th–90th</span>
    </div>
    {{< plotly height="320" alt="Latency of a step against the number of tool calls in it. Projected serial latency rises linearly from about 6 seconds for one call to about 51 seconds for eight; observed batched latency stays near 2 seconds at the median." >}}
    {
      "unit": "s",
      "decimals": 1,
      "xname": "Tool calls",
      "data": [
        {"name": "Serial calls (projected)", "color": "gray", "x": ["1", "2", "3", "4", "5", "6", "7", "8+"], "y": [6.36, 12.73, 19.09, 25.46, 31.82, 38.18, 44.55, 50.91], "mode": "lines", "line": {"dash": "dash", "width": 2}, "zorder": 2},
        {"name": "Batched (median)", "color": "green", "x": ["1", "2", "3", "4", "5", "6", "7", "8+"], "y": [1.79, 1.95, 2.32, 2.33, 2.1, 1.93, 1.45, 1.73], "zorder": 2, "cliponaxis": false},
        {"name": "25th–75th", "legendgroup": "25th–75th", "color": "green", "x": ["1", "2", "3", "4", "5", "6", "7", "8+"], "y": [0.74, 0.84, 0.89, 0.86, 0.77, 0.75, 0.72, 0.76], "mode": "lines", "line": {"width": 0}, "showlegend": false, "table": false, "hovertemplate": null, "hoverinfo": "skip"},
        {"name": "25th–75th", "legendgroup": "25th–75th", "color": "green", "x": ["1", "2", "3", "4", "5", "6", "7", "8+"], "y": [5.04, 4.98, 6.16, 6.3, 5.42, 6.44, 4.81, 6.59], "mode": "lines", "line": {"width": 0}, "showlegend": false, "table": false, "fill": "tonexty", "fillcolor": "rgba(27,175,122,0.28)", "hoveron": "points", "customdata": ["0.74–5.04", "0.84–4.98", "0.89–6.16", "0.86–6.30", "0.77–5.42", "0.75–6.44", "0.72–4.81", "0.76–6.59"], "hovertemplate": "25th–75th: %{customdata} s<extra></extra>"},
        {"name": "10th–90th", "legendgroup": "10th–90th", "color": "green", "x": ["1", "2", "3", "4", "5", "6", "7", "8+"], "y": [0.43, 0.43, 0.45, 0.47, 0.44, 0.44, 0.43, 0.48], "mode": "lines", "line": {"width": 0}, "showlegend": false, "table": false, "hovertemplate": null, "hoverinfo": "skip"},
        {"name": "10th–90th", "legendgroup": "10th–90th", "color": "green", "x": ["1", "2", "3", "4", "5", "6", "7", "8+"], "y": [17.79, 13.87, 16.49, 16.34, 14.96, 27.53, 20.3, 24.56], "mode": "lines", "line": {"width": 0}, "showlegend": false, "table": false, "fill": "tonexty", "fillcolor": "rgba(27,175,122,0.12)", "hoveron": "points", "customdata": ["0.43–17.8", "0.43–13.9", "0.45–16.5", "0.47–16.3", "0.44–15.0", "0.44–27.5", "0.43–20.3", "0.48–24.6"], "hovertemplate": "10th–90th: %{customdata} s<extra></extra>"}
      ],
      "layout": {"xaxis": {"title": {"text": "Tool calls in the step"}, "type": "category", "range": [-0.25, 7.25], "unifiedhovertitle": {"text": "Batch of %{x}"}}, "yaxis": {"title": {"text": "Latency (s)"}, "range": [0, 54], "tickvals": [0, 10, 20, 30, 40, 50]}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Calls per request, by tool</div>
    <div class="fig-legend">
      <span><i class="fig-key fig-key--box fig-key--gray"></i>Native tool</span>
      <span><i class="fig-key fig-key--box fig-key--amber"></i>Shell command</span>
    </div>
    {{< plotly height="320" alt="Mean tool calls per tool-calling request by tool category. Subagent is highest at 1.38; most shell command categories are near 1.0 to 1.1." >}}
    {
      "unit": "calls",
      "decimals": 2,
      "xname": "Tool",
      "data": [
        {"type": "bar", "orientation": "h", "name": "Native tool", "color": "gray", "y": ["Subagent", "Browser", "Read", "MCP", "Other", "Edit", "Write"], "x": [1.381, 1.267, 1.219, 1.152, 1.104, 1.087, 1.08]},
        {"type": "bar", "orientation": "h", "name": "Shell command", "color": "amber", "y": ["File Ops", "Git/VCS", "Search", "Network", "Packages", "Interpreter", "Build/Test", "Wait/Poll"], "x": [1.142, 1.097, 1.063, 1.062, 1.047, 1.032, 1.027, 1.007]}
      ],
      "layout": {"barmode": "overlay", "bargap": 0.4, "xaxis": {"title": {"text": "Mean calls per request"}, "range": [1, 1.436], "tickvals": [1, 1.1, 1.2, 1.3, 1.4]}, "yaxis": {"categoryorder": "array", "categoryarray": ["Subagent", "Browser", "Read", "MCP", "File Ops", "Other", "Git/VCS", "Edit", "Write", "Search", "Network", "Packages", "Interpreter", "Build/Test", "Wait/Poll"]}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

Subagents introduce a related challenge. Only **10.4% of sessions use subagents**, and **67% of subagent calls are synchronous**, leaving the parent waiting. When several subagents run together, the slowest can take more than **5×** as long as the fastest. Tool execution contributes much of this imbalance.

{{< diagram size="large" caption="*Figure 4.* Parallel subagents can be limited by the slowest child. Tool time shows the largest imbalance, while role-based assignments are less balanced than work-based assignments." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--box fig-key--blue"></i>Slowest ÷ fastest sibling</span>
  <span><i class="fig-key fig-key--box fig-key--red"></i>Slowest ÷ median sibling</span>
</div>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Imbalance by metric</div>
    {{< plotly height="320" alt="Box plots of the slowest subagent over its fastest and median sibling for wall time, LLM time, tool time, requests and total tokens. Tool time has the widest spread, with a median of 3.3× over the fastest sibling." >}}
    {
      "data": [
        {"type": "box", "orientation": "h", "name": "Slowest ÷ fastest sibling", "color": "blue", "y": ["Wall time", "LLM time", "Tool time", "Requests", "Total tokens"], "q1": [1.362, 1.333, 1.666, 1.431, 1.913], "median": [2.025, 1.839, 3.293, 2.048, 3.087], "q3": [3.592, 3.772, 10.112, 3.5, 6.184], "lowerfence": [1.054, 1.066, 1.066, 1, 1.063], "upperfence": [5.452, 5.452, 10.112, 5.452, 6.184], "hoverinfo": "skip"},
        {"type": "box", "orientation": "h", "name": "Slowest ÷ median sibling", "color": "red", "y": ["Wall time", "LLM time", "Tool time", "Requests", "Total tokens"], "q1": [1.126, 1.123, 1.203, 1.151, 1.253], "median": [1.299, 1.252, 1.537, 1.333, 1.502], "q3": [1.677, 1.684, 2.013, 1.698, 1.987], "lowerfence": [1.023, 1.018, 1.028, 1, 1.022], "upperfence": [3.523, 3.476, 5.452, 3.708, 5.452], "hoverinfo": "skip"},
        {"name": "Slowest ÷ fastest sibling", "legendgroup": "Slowest ÷ fastest sibling", "color": "blue", "x": [2.025, null, 1.839, null, 3.293, null, 2.048, null, 3.087], "y": ["Wall time", null, "LLM time", null, "Tool time", null, "Requests", null, "Total tokens"], "customdata": ["1.36–3.59×", null, "1.33–3.77×", null, "1.67–10.11×", null, "1.43–3.50×", null, "1.91–6.18×"], "mode": "lines", "connectgaps": false, "table": false, "hovertemplate": "%{fullData.name}<br>median %{x:.2f}×, 25th–75th %{customdata}<extra></extra>"},
        {"name": "Slowest ÷ median sibling", "legendgroup": "Slowest ÷ median sibling", "color": "red", "x": [1.299, null, 1.252, null, 1.537, null, 1.333, null, 1.502], "y": ["Wall time", null, "LLM time", null, "Tool time", null, "Requests", null, "Total tokens"], "customdata": ["1.13–1.68×", null, "1.12–1.68×", null, "1.20–2.01×", null, "1.15–1.70×", null, "1.25–1.99×"], "mode": "lines", "connectgaps": false, "table": false, "hovertemplate": "%{fullData.name}<br>median %{x:.2f}×, 25th–75th %{customdata}<extra></extra>"}
      ],
      "layout": {"boxmode": "group", "boxgap": 0.24, "boxgroupgap": 0.21, "xaxis": {"range": [0, 5], "tickvals": [0, 1, 2, 3, 4, 5], "ticksuffix": "×", "showspikes": false, "title": {"text": "Slowest ÷ sibling"}}, "shapes": [{"type": "line", "x0": 1, "x1": 1, "yref": "paper", "y0": 0, "y1": 1, "layer": "between", "line": {"color": "#4b5563", "width": 1.5, "dash": "dot"}}]}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Wall-time imbalance by task split</div>
    {{< plotly height="320" alt="Box plots of wall-time imbalance for role-based, work-based and mixed task assignments. Role-based assignments have the largest imbalance, with a median of 2.1× over the fastest sibling." >}}
    {
      "data": [
        {"type": "box", "orientation": "h", "name": "Slowest ÷ fastest sibling", "color": "blue", "y": ["Role-based", "Work-based", "Mixed / other"], "q1": [1.626, 1.357, 1.373], "median": [2.128, 1.931, 1.775], "q3": [3.457, 2.862, 2.037], "lowerfence": [1.38, 1.023, 1.038], "upperfence": [8.772, 5.693, 2.859], "hoverinfo": "skip"},
        {"type": "box", "orientation": "h", "name": "Slowest ÷ median sibling", "color": "red", "y": ["Role-based", "Work-based", "Mixed / other"], "q1": [1.16, 1.132, 1.157], "median": [1.352, 1.289, 1.308], "q3": [1.79, 1.597, 1.487], "lowerfence": [1.074, 1.008, 1.019], "upperfence": [2.61, 2.253, 1.913], "hoverinfo": "skip"},
        {"name": "Slowest ÷ fastest sibling", "legendgroup": "Slowest ÷ fastest sibling", "color": "blue", "x": [2.128, null, 1.931, null, 1.775], "y": ["Role-based", null, "Work-based", null, "Mixed / other"], "customdata": ["1.63–3.46×", null, "1.36–2.86×", null, "1.37–2.04×"], "mode": "lines", "connectgaps": false, "table": false, "hovertemplate": "%{fullData.name}<br>median %{x:.2f}×, 25th–75th %{customdata}<extra></extra>"},
        {"name": "Slowest ÷ median sibling", "legendgroup": "Slowest ÷ median sibling", "color": "red", "x": [1.352, null, 1.289, null, 1.308], "y": ["Role-based", null, "Work-based", null, "Mixed / other"], "customdata": ["1.16–1.79×", null, "1.13–1.60×", null, "1.16–1.49×"], "mode": "lines", "connectgaps": false, "table": false, "hovertemplate": "%{fullData.name}<br>median %{x:.2f}×, 25th–75th %{customdata}<extra></extra>"}
      ],
      "layout": {"boxmode": "group", "boxgap": 0.24, "boxgroupgap": 0.21, "xaxis": {"type": "log", "range": [-0.0458, 1.0569], "tickvals": [1, 2, 3, 5, 10], "ticksuffix": "×", "showspikes": false, "title": {"text": "Slowest ÷ sibling (wall time)"}}, "shapes": [{"type": "line", "x0": 1, "x1": 1, "yref": "paper", "y0": 0, "y1": 1, "layer": "between", "line": {"color": "#4b5563", "width": 1.5, "dash": "dot"}}]}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

**Implications:** **Agent harnesses** should execute independent tool calls in parallel rather than making repeated LLM round trips. For subagents, simply spawning more workers is not enough: work should be divided more evenly, with heavier tasks started earlier to reduce stragglers. **Serving systems and harnesses** could also coordinate subagent execution and inference scheduling to reduce time spent waiting for the slowest worker.

## 4. Context mutations are costly, but sometimes necessary

Although coding-agent contexts typically grow by appending new messages, we find that context mutations, where previously generated context is modified or removed, are quite common across sessions.

Mutations occur in only 4% of step transitions, but **56.4% of sessions experience at least one**. Under infinite cache retention, mutations account for **62.5% of fresh prefill tokens**. This is because even a small change near the beginning of a prompt can invalidate the cached prefix, forcing much of the context to be processed again.

Interestingly, avoiding mutations is not always better. In our what-if analysis, **eliminating context reductions actually increases fresh prefill** tokens by about 5% with 15-minute cache retention. Without these reductions, contexts continue to grow, making future cache misses more expensive. Longer contexts also increase the cost of repeated cache reads, even when caching succeeds.

{{< diagram size="large" caption="*Figure 5.* Relatively rare context changes account for a large share of fresh prefill. Changes near the start of a prompt can disrupt reuse of much of the context." >}}
<style>
  .d-mut { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .d-mut th, .d-mut td { padding: .2rem .35rem; text-align: right; white-space: nowrap; }
  .d-mut th:first-child, .d-mut td:first-child { text-align: left; }
  .d-mut thead th { font-weight: 600; vertical-align: bottom; border-bottom: 1.5px solid var(--fig-ink); }
  .d-mut thead th span { display: block; font-weight: 400; color: var(--fig-ink-2); }
  .d-mut .d-mut-total td { font-weight: 600; border-top: 1px solid var(--fig-line); }
  .d-mut .d-mut-cause td:first-child { padding-left: 1.1rem; color: var(--fig-ink-2); }
  .d-mut tbody tr:last-child td { border-bottom: 1.5px solid var(--fig-ink); }
</style>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Context transitions</div>
    <table class="d-mut">
      <thead><tr><th>Transition</th><th>Steps<span>%</span></th><th>Sessions<span>%</span></th><th>Prefill<span>%</span></th></tr></thead>
      <tbody>
        <tr><td>Append</td><td>96.00</td><td>43.6</td><td>37.5</td></tr>
        <tr class="d-mut-total"><td>Mutation</td><td>4.00</td><td>56.4</td><td>62.5</td></tr>
        <tr class="d-mut-cause"><td>Injection</td><td>0.96</td><td>17.1</td><td>7.4</td></tr>
        <tr class="d-mut-cause"><td>System prompt</td><td>0.74</td><td>20.3</td><td>26.9</td></tr>
        <tr class="d-mut-cause"><td>Tool definitions</td><td>0.40</td><td>21.4</td><td>13.9</td></tr>
        <tr class="d-mut-cause"><td>Dropped turns</td><td>0.36</td><td>6.5</td><td>5.3</td></tr>
        <tr class="d-mut-cause"><td>Compaction</td><td>0.04</td><td>3.7</td><td>0.6</td></tr>
        <tr class="d-mut-cause"><td>Tool result drop</td><td>0.51</td><td>5.9</td><td>3.2</td></tr>
        <tr class="d-mut-cause"><td>Other</td><td>1.00</td><td>14.5</td><td>5.2</td></tr>
      </tbody>
    </table>
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Cache hit ratio after the step</div>
    <div class="fig-legend">
      <span><i class="fig-key fig-key--green"></i>Append</span>
      <span><i class="fig-key fig-key--red"></i>Mutation</span>
    </div>
    {{< plotly height="280" alt="CDF of the cache hit ratio after a step. After an append almost every request hits nearly its whole prefix; after a mutation about 40% of requests reuse less than 80% of it." >}}
    {
      "decimals": 2,
      "table": false,
      "data": [
        {"name": "Append", "color": "green", "x": [0.0, 0.0003749, 0.008658, 0.01124, 0.02247, 0.03371, 0.04494, 0.05618, 0.06742, 0.07865, 0.07873, 0.08989, 0.1011, 0.1124, 0.1236, 0.1348, 0.1461, 0.1573, 0.1685, 0.1798, 0.191, 0.2022, 0.2135, 0.2247, 0.236, 0.2472, 0.2584, 0.2697, 0.2809, 0.2921, 0.3034, 0.3146, 0.3258, 0.3371, 0.3483, 0.3596, 0.3708, 0.382, 0.3933, 0.4045, 0.4157, 0.427, 0.4382, 0.4494, 0.4607, 0.4719, 0.4831, 0.4944, 0.5056, 0.5169, 0.5281, 0.5393, 0.5506, 0.5618, 0.573, 0.5843, 0.5955, 0.6067, 0.618, 0.6262, 0.6292, 0.6404, 0.6517, 0.6629, 0.6742, 0.6854, 0.6966, 0.7079, 0.7191, 0.7303, 0.7416, 0.7528, 0.764, 0.7647, 0.7753, 0.7865, 0.7978, 0.809, 0.8202, 0.8244, 0.8315, 0.8427, 0.8539, 0.8652, 0.8764, 0.8825, 0.8876, 0.8989, 0.9101, 0.9213, 0.9217, 0.9326, 0.9331, 0.9438, 0.9481, 0.9551, 0.9631, 0.9663, 0.9688, 0.9773, 0.9775, 0.9839, 0.9888, 0.9896, 0.9963, 1], "y": [0, 0.002, 0.004, 0.004, 0.004, 0.005, 0.005, 0.005, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.007, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.009, 0.009, 0.009, 0.009, 0.009, 0.009, 0.009, 0.009, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.011, 0.011, 0.011, 0.012, 0.012, 0.012, 0.013, 0.013, 0.013, 0.014, 0.014, 0.014, 0.015, 0.015, 0.016, 0.017, 0.018, 0.018, 0.019, 0.02, 0.021, 0.023, 0.025, 0.026, 0.027, 0.03, 0.034, 0.038, 0.038, 0.044, 0.044, 0.052, 0.056, 0.064, 0.076, 0.083, 0.088, 0.116, 0.117, 0.156, 0.215, 0.228, 0.478, 1]},
        {"name": "Mutation", "color": "red", "x": [0.0, 0.001578, 0.006441, 0.01124, 0.02247, 0.03371, 0.03954, 0.04494, 0.05618, 0.06742, 0.07122, 0.07865, 0.08108, 0.08989, 0.1011, 0.1066, 0.1124, 0.1236, 0.1348, 0.1413, 0.1461, 0.1573, 0.161, 0.1685, 0.1798, 0.191, 0.2022, 0.2135, 0.2198, 0.2247, 0.236, 0.2472, 0.2584, 0.2605, 0.2697, 0.2809, 0.2921, 0.3034, 0.3146, 0.3258, 0.3367, 0.3371, 0.3483, 0.3596, 0.3708, 0.382, 0.3933, 0.4045, 0.4157, 0.427, 0.4382, 0.4494, 0.4607, 0.4719, 0.4831, 0.4846, 0.4944, 0.5056, 0.5169, 0.5281, 0.5393, 0.5506, 0.5603, 0.5618, 0.573, 0.5843, 0.5955, 0.6067, 0.618, 0.6292, 0.6404, 0.6517, 0.6629, 0.6742, 0.6854, 0.6921, 0.6966, 0.7079, 0.7191, 0.7303, 0.7416, 0.7528, 0.764, 0.7753, 0.7808, 0.7865, 0.7978, 0.809, 0.8202, 0.8315, 0.8331, 0.8427, 0.8539, 0.8567, 0.8652, 0.8721, 0.8764, 0.8876, 0.8989, 0.8998, 0.9101, 0.9213, 0.925, 0.9326, 0.9346, 0.9438, 0.9518, 0.9551, 0.9598, 0.9663, 0.9724, 0.9775, 0.9876, 0.9888, 1], "y": [0, 0.058, 0.074, 0.079, 0.092, 0.104, 0.11, 0.117, 0.135, 0.154, 0.16, 0.169, 0.172, 0.181, 0.191, 0.196, 0.2, 0.208, 0.216, 0.22, 0.222, 0.228, 0.23, 0.233, 0.238, 0.242, 0.247, 0.251, 0.254, 0.256, 0.259, 0.263, 0.267, 0.268, 0.27, 0.273, 0.275, 0.278, 0.281, 0.283, 0.286, 0.286, 0.288, 0.291, 0.293, 0.296, 0.298, 0.3, 0.303, 0.305, 0.307, 0.309, 0.312, 0.314, 0.316, 0.316, 0.319, 0.321, 0.324, 0.327, 0.33, 0.332, 0.334, 0.334, 0.338, 0.341, 0.344, 0.347, 0.35, 0.353, 0.356, 0.359, 0.362, 0.365, 0.368, 0.37, 0.372, 0.376, 0.38, 0.384, 0.389, 0.393, 0.397, 0.402, 0.404, 0.407, 0.413, 0.419, 0.425, 0.431, 0.432, 0.439, 0.446, 0.448, 0.456, 0.462, 0.466, 0.478, 0.489, 0.49, 0.506, 0.527, 0.534, 0.551, 0.556, 0.583, 0.606, 0.619, 0.638, 0.668, 0.7, 0.74, 0.818, 0.832, 1]}
      ],
      "layout": {"xaxis": {"title": {"text": "Cache hit ratio"}, "range": [0, 1], "tickvals": [0, 0.25, 0.5, 0.75, 1], "unifiedhovertitle": {"text": "Hit ratio %{x:.2f}"}}, "yaxis": {"title": {"text": "CDF"}, "range": [0, 1.02], "tickvals": [0, 0.25, 0.5, 0.75, 1]}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

**Implications:** **Agent harnesses and serving systems** should be designed with prefix reuse in mind. Harnesses should keep stable instructions and tool definitions consistent to avoid unnecessary cache invalidation. **Users** should use context reductions strategically to control context growth and future cache-read and miss costs.


## 5. The need for session-level hints to guide better prefix retention policies

Coding-agent sessions alternate between rapid LLM–tool interactions and long pauses while users review results or decide what to do next. A typical session lasts about **30 minutes**, but an individual user turn lasts only about **61 seconds**.

These phases have very different timing characteristics. The median gap between tool steps is just **1.8 seconds**, compared to **96.5 seconds between user turns**. This also affects cache reuse: mean cache hit ratios remain near **97.5% after tool steps**, but drop to **84% after user pauses**. Longer pauses make it harder to keep previously cached contexts available.

{{< diagram size="large" caption="*Figure 6.* Requests return quickly during tool loops, while longer user pauses are associated with lower cache reuse." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--green"></i>Tool gap</span>
  <span><i class="fig-key fig-key--amber"></i>Ask-user tool</span>
  <span><i class="fig-key fig-key--red"></i>User idle</span>
  <span><i class="fig-key fig-key--blue"></i>Subagent</span>
</div>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Gap before the next request</div>
    {{< plotly height="280" alt="CDF of the gap before the next request by cause. The median tool gap is 1.8 seconds and the median user idle gap is 96.5 seconds; ask-user tools and subagents fall in between." >}}
    {
      "decimals": 2,
      "table": false,
      "data": [
        {"name": "Tool gap", "color": "green", "x": [0.1, 0.1166, 0.136, 0.1585, 0.162, 0.1848, 0.205, 0.2155, 0.231, 0.2513, 0.275, 0.293, 0.309, 0.3417, 0.392, 0.3984, 0.4645, 0.474, 0.5417, 0.6316, 0.7364, 0.8587, 1.001, 1.167, 1.361, 1.587, 1.851, 2.158, 2.516, 2.934, 2.968, 3.421, 3.942, 3.989, 4.651, 5.423, 5.975, 6.324, 7.373, 8.597, 9.141, 10.02, 11.69, 13.63, 13.86, 15.89, 17.54, 18.53, 21.61, 23.76, 25.19, 29.38, 34.25, 35.21, 39.94, 46.57, 54.3, 59.45, 63.31, 66.29, 73.82, 86.08, 100.4, 117, 136.5, 139.1, 159.1, 185.5, 216.3, 252.2, 294.1, 328, 342.9, 399.9, 466.3, 543.7, 633.9, 739.2, 761.2, 861.9, 1005, 1172, 1366, 1593, 1858, 2166, 2526, 2945, 3434, 4004, 4668, 5443, 6347, 7401, 8629, 10060, 11730, 13680, 15950, 18600, 21690, 25290, 29480, 34380, 40090, 46740, 54500, 63550, 74100, 86400], "y": [0.002, 0.002, 0.002, 0.002, 0.002, 0.004, 0.006, 0.008, 0.01, 0.015, 0.022, 0.03, 0.036, 0.052, 0.078, 0.082, 0.119, 0.124, 0.161, 0.205, 0.248, 0.291, 0.334, 0.376, 0.419, 0.463, 0.506, 0.549, 0.592, 0.635, 0.638, 0.673, 0.704, 0.706, 0.735, 0.76, 0.776, 0.784, 0.807, 0.826, 0.834, 0.844, 0.861, 0.878, 0.88, 0.892, 0.9, 0.904, 0.914, 0.92, 0.923, 0.931, 0.941, 0.942, 0.947, 0.952, 0.957, 0.96, 0.966, 0.968, 0.971, 0.974, 0.977, 0.98, 0.984, 0.984, 0.986, 0.987, 0.989, 0.991, 0.993, 0.994, 0.994, 0.995, 0.996, 0.997, 0.997, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999]},
        {"name": "Ask-user tool", "color": "amber", "x": [0.1, 0.1166, 0.136, 0.1585, 0.1848, 0.2155, 0.2513, 0.2793, 0.293, 0.3417, 0.3984, 0.461, 0.4645, 0.5417, 0.6316, 0.7364, 0.8587, 0.9156, 1.001, 1.167, 1.361, 1.587, 1.851, 2.158, 2.516, 2.934, 3.421, 3.738, 3.989, 4.651, 5.423, 5.633, 6.324, 6.494, 7.373, 8.108, 8.597, 9.804, 10.02, 11.69, 12.19, 13.63, 14.17, 14.9, 15.89, 18.53, 20.49, 21.61, 23.8, 25.19, 29.38, 30.35, 34.25, 39.94, 46.57, 46.86, 54.16, 54.3, 63.31, 73.82, 81.34, 86.08, 100.4, 113.3, 117, 136.5, 139.7, 159.1, 164.4, 185.5, 210.9, 216.3, 252.2, 294.1, 308.7, 342.9, 399.9, 412.7, 466.3, 543.7, 601, 616.6, 633.9, 739.2, 861.9, 1005, 1016, 1172, 1366, 1593, 1858, 1932, 2166, 2526, 2945, 3434, 3601, 3604, 4004, 4668, 5443, 6347, 7401, 8629, 10060, 11730, 13680, 15950, 16270, 18600, 21690, 25290, 29480, 34380, 40090, 46740, 54500, 63550, 74100, 86400], "y": [0, 0.001, 0.001, 0.002, 0.002, 0.003, 0.004, 0.004, 0.005, 0.007, 0.01, 0.012, 0.012, 0.016, 0.019, 0.022, 0.025, 0.026, 0.027, 0.029, 0.031, 0.033, 0.035, 0.037, 0.039, 0.042, 0.043, 0.044, 0.047, 0.051, 0.055, 0.056, 0.061, 0.062, 0.072, 0.078, 0.084, 0.096, 0.099, 0.116, 0.12, 0.137, 0.142, 0.154, 0.162, 0.187, 0.206, 0.219, 0.24, 0.254, 0.294, 0.302, 0.336, 0.381, 0.426, 0.428, 0.462, 0.463, 0.513, 0.559, 0.59, 0.603, 0.646, 0.678, 0.687, 0.737, 0.744, 0.767, 0.772, 0.799, 0.824, 0.828, 0.851, 0.872, 0.88, 0.89, 0.905, 0.908, 0.917, 0.928, 0.934, 0.938, 0.939, 0.947, 0.953, 0.959, 0.96, 0.964, 0.968, 0.972, 0.975, 0.976, 0.978, 0.98, 0.983, 0.985, 0.986, 0.99, 0.991, 0.992, 0.993, 0.994, 0.995, 0.995, 0.996, 0.997, 0.997, 0.998, 0.998, 0.998, 0.998, 0.998, 0.999, 0.999, 0.999, 0.999, 0.999, 1, 1, 1]},
        {"name": "User idle", "color": "red", "x": [0.1, 0.1166, 0.136, 0.1585, 0.1848, 0.2155, 0.2513, 0.2635, 0.293, 0.3417, 0.3984, 0.458, 0.4645, 0.5417, 0.543, 0.6316, 0.7364, 0.8587, 1.001, 1.167, 1.361, 1.587, 1.851, 2.158, 2.305, 2.516, 2.934, 3.421, 3.455, 3.989, 4.239, 4.651, 5.423, 6.324, 7.373, 8.597, 9.76, 10.02, 11.69, 13.63, 13.66, 15.89, 17.56, 18.53, 20.37, 21.61, 25.19, 26.58, 29.38, 30.23, 34.25, 39.94, 41.69, 46.57, 54.3, 63.31, 63.66, 73.82, 86.08, 100.4, 117, 136.5, 159.1, 184.8, 185.5, 216.3, 244.2, 252.2, 294.1, 342.9, 352.5, 399.9, 460.9, 466.3, 543.7, 599.4, 633.9, 739.2, 861.9, 914.7, 1005, 1172, 1206, 1366, 1593, 1751, 1820, 1858, 2166, 2426, 2526, 2945, 3434, 4004, 4123, 4668, 5443, 6347, 7401, 7561, 8629, 10060, 11730, 13680, 15950, 18600, 21690, 25290, 29480, 34380, 40090, 42810, 46740, 54500, 63550, 73080, 74100, 86400], "y": [0.001, 0.001, 0.001, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.005, 0.006, 0.008, 0.008, 0.012, 0.012, 0.018, 0.025, 0.031, 0.037, 0.042, 0.047, 0.053, 0.059, 0.065, 0.068, 0.075, 0.093, 0.107, 0.108, 0.116, 0.12, 0.123, 0.128, 0.133, 0.138, 0.144, 0.148, 0.149, 0.156, 0.164, 0.164, 0.175, 0.182, 0.187, 0.196, 0.203, 0.222, 0.228, 0.242, 0.246, 0.267, 0.294, 0.302, 0.326, 0.359, 0.393, 0.394, 0.43, 0.47, 0.509, 0.548, 0.586, 0.622, 0.658, 0.659, 0.69, 0.718, 0.724, 0.75, 0.777, 0.782, 0.801, 0.82, 0.821, 0.839, 0.85, 0.855, 0.87, 0.884, 0.89, 0.897, 0.908, 0.91, 0.917, 0.925, 0.93, 0.934, 0.935, 0.942, 0.946, 0.947, 0.952, 0.956, 0.961, 0.962, 0.964, 0.967, 0.971, 0.974, 0.974, 0.976, 0.978, 0.98, 0.982, 0.983, 0.985, 0.987, 0.988, 0.99, 0.992, 0.993, 0.994, 0.995, 0.996, 0.997, 0.998, 0.998, 0.998]},
        {"name": "Subagent", "color": "blue", "x": [0.138, 0.1585, 0.1848, 0.2012, 0.2155, 0.2513, 0.2644, 0.293, 0.299, 0.3417, 0.354, 0.396, 0.3984, 0.4645, 0.496, 0.5417, 0.596, 0.6316, 0.7364, 0.8587, 0.963, 1.001, 1.167, 1.207, 1.361, 1.557, 1.587, 1.851, 2.158, 2.28, 2.516, 2.785, 2.934, 3.421, 3.989, 4.651, 4.702, 5.301, 5.423, 6.324, 7.373, 8.585, 8.597, 9.742, 10.02, 11.69, 13.63, 15.71, 15.89, 18.53, 19.06, 21.61, 24.3, 25.19, 29.38, 34.25, 39.94, 46.57, 47.77, 54.3, 55.17, 63.31, 73.82, 80.46, 86.08, 96.28, 100.4, 117, 121.6, 136.5, 159.1, 183.3, 185.5, 216.3, 252.2, 294.1, 342.9, 392.2, 399.9, 466.3, 543.7, 579.6, 633.9, 717.6, 739.2, 861.9, 1005, 1134, 1172, 1366, 1593, 1611, 1858, 2166, 2526, 2826, 2945, 3434, 4004, 4668, 5443, 6347, 7401, 8629, 10060, 11730, 13680, 15950, 18600, 21690, 25290, 29480, 34380, 40090, 46740, 54500, 63550, 74100, 86400], "y": [0, 0.001, 0.002, 0.002, 0.003, 0.005, 0.006, 0.009, 0.01, 0.019, 0.022, 0.034, 0.036, 0.057, 0.068, 0.087, 0.108, 0.115, 0.14, 0.162, 0.18, 0.189, 0.218, 0.224, 0.235, 0.248, 0.251, 0.273, 0.295, 0.302, 0.319, 0.336, 0.342, 0.358, 0.375, 0.39, 0.392, 0.4, 0.402, 0.416, 0.432, 0.446, 0.446, 0.452, 0.455, 0.467, 0.48, 0.492, 0.493, 0.502, 0.504, 0.515, 0.524, 0.528, 0.544, 0.561, 0.577, 0.594, 0.596, 0.612, 0.614, 0.635, 0.658, 0.672, 0.678, 0.692, 0.701, 0.728, 0.736, 0.752, 0.778, 0.802, 0.804, 0.824, 0.846, 0.868, 0.888, 0.908, 0.91, 0.926, 0.939, 0.946, 0.952, 0.962, 0.964, 0.971, 0.977, 0.982, 0.982, 0.986, 0.99, 0.99, 0.992, 0.993, 0.995, 0.996, 0.996, 0.996, 0.997, 0.997, 0.997, 0.997, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 1, 1, 1, 1]},
        {"name": "Tool gap median", "legendgroup": "Tool gap", "color": "green", "x": [1.804], "y": [0.5], "mode": "markers+text", "text": ["1.8s"], "textposition": "middle left", "textfont": {"size": 12, "color": "#1f2328", "shadow": "0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff"}, "marker": {"size": 8}, "cliponaxis": false, "hovertemplate": null, "hoverinfo": "skip", "table": false},
        {"name": "User idle median", "legendgroup": "User idle", "color": "red", "x": [96.51], "y": [0.5], "mode": "markers+text", "text": ["96.5s"], "textposition": "middle right", "textfont": {"size": 12, "color": "#1f2328", "shadow": "0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff"}, "marker": {"size": 8}, "cliponaxis": false, "hovertemplate": null, "hoverinfo": "skip", "table": false}
      ],
      "layout": {"xaxis": {"title": {"text": "Gap duration"}, "type": "log", "range": [-1, 4.9365], "tickvals": [1, 60, 3600, 86400], "ticktext": ["1s", "1m", "1h", "1d"], "unifiedhovertitle": {"text": "%{x:,.3~r} s"}}, "yaxis": {"title": {"text": "CDF"}, "range": [0, 1.02], "tickvals": [0, 0.25, 0.5, 0.75, 1]}}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Cache hit ratio after the gap</div>
    {{< plotly height="280" alt="Mean cache hit ratio after each kind of gap: tool gap 0.97, ask-user tool 0.92, user idle 0.84, subagent 0.91." >}}
    {
      "decimals": 2,
      "table": false,
      "data": [
        {"type": "bar", "orientation": "h", "name": "Tool gap", "color": "green", "y": ["Tool gap"], "x": [0.974], "texttemplate": "%{x:.2f}", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}},
        {"type": "bar", "orientation": "h", "name": "Ask-user tool", "color": "amber", "y": ["Ask-user tool"], "x": [0.922], "texttemplate": "%{x:.2f}", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}},
        {"type": "bar", "orientation": "h", "name": "User idle", "color": "red", "y": ["User idle"], "x": [0.842], "texttemplate": "%{x:.2f}", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}},
        {"type": "bar", "orientation": "h", "name": "Subagent", "color": "blue", "y": ["Subagent"], "x": [0.909], "texttemplate": "%{x:.2f}", "textposition": "outside", "cliponaxis": false, "constraintext": "none", "textfont": {"size": 12, "color": "#1f2328"}}
      ],
      "layout": {"barmode": "overlay", "bargap": 0.6, "xaxis": {"title": {"text": "Mean cache hit ratio"}, "range": [0.7, 1.05], "tickvals": [0.7, 0.8, 0.9, 1]}, "yaxis": {"categoryorder": "array", "categoryarray": ["Tool gap", "Ask-user tool", "User idle", "Subagent"]}}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

One way to improve reuse is to retain cached KV state for longer. However, **longer retention comes at a significant storage cost**. Retaining cached state for roughly a day captures nearly all potential temporal reuse, but requires **25.6× more mean storage than 15-minute retention**. Much of this extra storage holds prefixes that will never be reused, such as those from completed sessions or discarded contexts.

{{< diagram size="large" caption="*Figure 7.* Longer retention reduces fresh prefill and user cost, but provider storage costs eventually dominate. Costs are normalized to a one-minute retention time." >}}
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">User API cost</div>
    <div class="fig-legend">
      <span><i class="fig-key fig-key--box fig-key--green"></i>Output</span>
      <span><i class="fig-key fig-key--box fig-key--blue"></i>Cache reads</span>
      <span><i class="fig-key fig-key--box fig-key--red"></i>Uncached input</span>
    </div>
    {{< plotly height="280" alt="Modeled user API cost against cache retention time, split into output, cache reads and uncached input, relative to a one-minute retention. Cost falls from 3.9× at one second and levels off at a knee of 0.65× at 30 minutes." >}}
    {
      "decimals": 2,
      "table": false,
      "data": [
        {"name": "Output", "color": "green", "stackgroup": "cost", "x": [1, 10, 30, 60, 300, 600, 900, 1800, 3600, 10800, 21600, 86400], "y": [0.0649, 0.0649, 0.0649, 0.0649, 0.0649, 0.0649, 0.0649, 0.0649, 0.0649, 0.0649, 0.0649, 0.0649]},
        {"name": "Cache reads", "color": "blue", "stackgroup": "cost", "x": [1, 10, 30, 60, 300, 600, 900, 1800, 3600, 10800, 21600, 86400], "y": [0.1145, 0.3647, 0.4141, 0.4331, 0.4625, 0.4684, 0.4703, 0.4724, 0.4735, 0.4744, 0.4747, 0.4752]},
        {"name": "Uncached input", "color": "red", "stackgroup": "cost", "x": [1, 10, 30, 60, 300, 600, 900, 1800, 3600, 10800, 21600, 86400], "y": [3.6881, 1.1862, 0.6924, 0.502, 0.2083, 0.1494, 0.1301, 0.1092, 0.0981, 0.0893, 0.0864, 0.0814]},
        {"name": "Total", "x": [1, 10, 30, 60, 300, 600, 900, 1800, 3600, 10800, 21600, 86400], "y": [3.8676, 1.6159, 1.1714, 1, 0.7357, 0.6827, 0.6653, 0.6466, 0.6365, 0.6286, 0.626, 0.6215], "mode": "lines", "color": "#1f2328", "line": {"width": 0}, "table": false},
        {"name": "Knee 0.65× at 30m", "x": [1800], "y": [0.6466], "mode": "markers", "color": "#ffffff", "marker": {"size": 9, "color": "#ffffff", "line": {"color": "#1f2328", "width": 1.75}}, "hovertemplate": null, "hoverinfo": "skip", "table": false, "cliponaxis": false}
      ],
      "layout": {"xaxis": {"title": {"text": "Cache retention time (TTL)"}, "type": "log", "range": [0, 4.9365], "tickvals": [1, 60, 900, 86400], "ticktext": ["1s", "1m", "15m", "1d"], "unifiedhovertitle": {"text": "TTL %{x:,} s"}}, "yaxis": {"title": {"text": "Normalized cost"}, "range": [0, 4.2], "tickvals": [0, 1, 2, 3, 4], "ticksuffix": "×"}, "shapes": [{"type": "line", "xref": "paper", "x0": 0, "x1": 1, "y0": 1, "y1": 1, "line": {"color": "#6b7280", "width": 1, "dash": "dot"}}], "annotations": [{"x": 3.2553, "y": 0.6466, "text": "Knee 0.65× at 30m", "showarrow": true, "arrowhead": 0, "arrowwidth": 1.25, "arrowcolor": "#1f2328", "ax": 0, "ay": -46, "standoff": 5, "font": {"size": 12, "color": "#1f2328"}, "bgcolor": "rgba(255,255,255,0.85)"}]}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Provider cost</div>
    <div class="fig-legend">
      <span><i class="fig-key fig-key--box fig-key--red"></i>Recompute</span>
      <span><i class="fig-key fig-key--box fig-key--yellow"></i>Storage</span>
    </div>
    {{< plotly height="280" alt="Modeled provider cost against cache retention time, split into recompute and storage, relative to a one-minute retention. Recompute falls and storage rises with retention; the total is lowest, 0.42×, at 15 minutes and climbs to 4.6× at one day." >}}
    {
      "decimals": 2,
      "table": false,
      "data": [
        {"name": "Storage", "color": "yellow", "stackgroup": "cost", "x": [1, 10, 30, 60, 300, 600, 900, 1800, 3600, 10800, 21600, 86400], "y": [0.0087, 0.034, 0.0486, 0.0615, 0.1106, 0.1452, 0.1724, 0.2415, 0.3606, 0.7826, 1.3687, 4.4099]},
        {"name": "Recompute", "color": "red", "stackgroup": "cost", "x": [1, 10, 30, 60, 300, 600, 900, 1800, 3600, 10800, 21600, 86400], "y": [6.896, 2.218, 1.2946, 0.9385, 0.3894, 0.2793, 0.2432, 0.2043, 0.1834, 0.1669, 0.1615, 0.1522]},
        {"name": "Total", "x": [1, 10, 30, 60, 300, 600, 900, 1800, 3600, 10800, 21600, 86400], "y": [6.9047, 2.252, 1.3431, 1, 0.5, 0.4245, 0.4156, 0.4458, 0.544, 0.9495, 1.5302, 4.5621], "mode": "lines", "color": "#1f2328", "line": {"width": 0}, "table": false},
        {"name": "Min 0.42× at 15m", "x": [900], "y": [0.4156], "mode": "markers", "color": "#ffffff", "marker": {"size": 9, "color": "#ffffff", "line": {"color": "#1f2328", "width": 1.75}}, "hovertemplate": null, "hoverinfo": "skip", "table": false, "cliponaxis": false}
      ],
      "layout": {"xaxis": {"title": {"text": "Cache retention time (TTL)"}, "type": "log", "range": [0, 4.9365], "tickvals": [1, 60, 900, 86400], "ticktext": ["1s", "1m", "15m", "1d"], "unifiedhovertitle": {"text": "TTL %{x:,} s"}}, "yaxis": {"title": {"text": "Normalized cost"}, "range": [0, 7.5], "tickvals": [0, 2, 4, 6], "ticksuffix": "×"}, "shapes": [{"type": "line", "xref": "paper", "x0": 0, "x1": 1, "y0": 1, "y1": 1, "line": {"color": "#6b7280", "width": 1, "dash": "dot"}}], "annotations": [{"x": 2.9542, "y": 0.4156, "text": "Min 0.42× at 15m", "showarrow": true, "arrowhead": 0, "arrowwidth": 1.25, "arrowcolor": "#1f2328", "ax": 0, "ay": -60, "standoff": 5, "font": {"size": 12, "color": "#1f2328"}, "bgcolor": "rgba(255,255,255,0.85)"}]}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

**Implications:** **Cache management should be session-aware, rather than simply keeping everything longer.** Active tool loops benefit from retaining KV state, while longer user pauses may call for offloading or different retention decisions. **Agent harnesses** could expose signals when session pause, finish or context is mutated, allowing **serving systems** to distinguish between active and inactive sessions, and manage cache accordingly. This could improve reuse without the high memory overhead of long retention.

## 6. Benchmark agents are easier to cache than production agents

Most coding-agent benchmarks, such as SWE-Bench, give an agent a well-defined task and let it work toward a solution. However, real users interact with agents differently. They often provide shorter instructions, ask follow-up questions, and leave long pauses between interactions. These differences can significantly affect caching behavior.

Compared with our SWE-Bench replay, **production sessions last 9.4× longer and carry 5.1× more input tokens per request**. The median production session lasts about **30 minutes, compared to just 3.2 minutes** in the benchmark. Similarly, the median request contains roughly **129,000 input tokens, compared to 25,000**.

These differences also affect how long cached contexts need to be retained. In the benchmark replay, a **5-minute cache-retention window** is enough to bring fresh prefill within 3% of the infinite-retention minimum. In production, however, **a one-day retention window** is needed to reach the same range among the windows we evaluated. The benchmark replay also lacks the context mutations observed in production, which can further disrupt prefix reuse.

{{< diagram size="large" caption="*Figure 8.* Production sessions last longer and carry larger contexts than the benchmark replay, creating different cache-retention requirements." >}}
<div class="fig-legend">
  <span><i class="fig-key fig-key--blue"></i>Human-driven</span>
  <span><i class="fig-key fig-key--amber"></i>Benchmark (SWE-Bench replay)</span>
</div>
<div class="fig-plots">
  <figure class="fig-plot">
    <div class="fig-plot-title">Session duration</div>
    {{< plotly height="280" alt="CDF of session duration. The median human-driven session lasts 30.2 minutes against 192 seconds for the benchmark replay, 9.4× longer." >}}
    {
      "decimals": 2,
      "table": false,
      "data": [
        {"name": "Human-driven", "color": "blue", "x": [0.07173, 0.07438, 0.08638, 0.1003, 0.1165, 0.1353, 0.1571, 0.1825, 0.212, 0.2462, 0.2858, 0.332, 0.3328, 0.3855, 0.4477, 0.479, 0.52, 0.6038, 0.6453, 0.7013, 0.8145, 0.9458, 1.079, 1.099, 1.276, 1.398, 1.482, 1.72, 1.998, 2.05, 2.32, 2.695, 2.837, 3.13, 3.635, 3.825, 4.222, 4.902, 5.142, 5.693, 6.612, 6.763, 7.678, 8.657, 8.918, 10.36, 12.03, 13.97, 16.22, 16.43, 18.83, 21.88, 25.42, 29.52, 34.27, 39.8, 41.32, 46.22, 53.68, 62.33, 72.4, 84.08, 92.1, 97.65, 113.4, 131.7, 146.1, 152.9, 177.7, 206.3, 220, 239.5, 263.3, 278.2, 323.2, 324.5, 375.2, 435.8, 506, 566.3, 587.7, 682.5, 792.7, 920.7, 1069, 1242, 1442, 1575, 1675, 1945, 2258, 2558, 2623, 3047, 3375, 3538, 4108, 4772, 5157, 5542, 6435, 7473, 8573], "y": [0, 0, 0, 0.001, 0.001, 0.001, 0.001, 0.001, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.004, 0.004, 0.005, 0.007, 0.008, 0.01, 0.013, 0.017, 0.02, 0.021, 0.028, 0.032, 0.036, 0.048, 0.059, 0.06, 0.071, 0.084, 0.088, 0.1, 0.118, 0.124, 0.137, 0.157, 0.164, 0.18, 0.205, 0.21, 0.228, 0.246, 0.253, 0.282, 0.311, 0.339, 0.368, 0.37, 0.4, 0.434, 0.464, 0.494, 0.528, 0.56, 0.568, 0.589, 0.617, 0.647, 0.675, 0.704, 0.722, 0.731, 0.754, 0.775, 0.79, 0.795, 0.815, 0.832, 0.84, 0.849, 0.858, 0.862, 0.872, 0.872, 0.883, 0.896, 0.907, 0.916, 0.918, 0.927, 0.937, 0.946, 0.954, 0.963, 0.972, 0.978, 0.98, 0.984, 0.987, 0.99, 0.99, 0.992, 0.994, 0.994, 0.996, 0.997, 0.998, 0.998, 0.999, 0.999, 1]},
        {"name": "Benchmark (SWE-Bench replay)", "color": "amber", "x": [0.01667, 0.01667, 0.01935, 0.01942, 0.02248, 0.0261, 0.03032, 0.03522, 0.04088, 0.04748, 0.05515, 0.06405, 0.07283, 0.07438, 0.07667, 0.08337, 0.08638, 0.09522, 0.1003, 0.1165, 0.1353, 0.1506, 0.1571, 0.1825, 0.212, 0.2462, 0.2858, 0.332, 0.3565, 0.3855, 0.3988, 0.4383, 0.4477, 0.477, 0.52, 0.5937, 0.6038, 0.7013, 0.7323, 0.8005, 0.8145, 0.8602, 0.9002, 0.9458, 1.017, 1.099, 1.153, 1.257, 1.276, 1.321, 1.353, 1.403, 1.482, 1.545, 1.602, 1.72, 1.742, 1.778, 1.835, 1.938, 1.998, 2.152, 2.32, 2.342, 2.502, 2.695, 3.13, 3.172, 3.635, 3.68, 4.222, 4.388, 4.642, 4.902, 5.058, 5.175, 5.693, 5.922, 6.612, 7.265, 7.678, 7.865, 8.215, 8.602, 8.918, 10.36, 11.1, 12.03, 12.06, 13.21, 13.97, 16.22, 18.83, 19.35, 21.88, 25.3, 25.42, 26.37, 29.52, 30.73, 34.27, 39.8, 46.22, 46.57, 53.68, 62.33, 72.4, 77.43], "y": [0.001, 0.002, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.003, 0.004, 0.004, 0.004, 0.004, 0.005, 0.006, 0.014, 0.015, 0.019, 0.02, 0.022, 0.023, 0.024, 0.026, 0.027, 0.03, 0.032, 0.037, 0.039, 0.04, 0.047, 0.05, 0.064, 0.065, 0.069, 0.085, 0.108, 0.11, 0.128, 0.132, 0.135, 0.14, 0.149, 0.151, 0.159, 0.168, 0.174, 0.181, 0.201, 0.202, 0.205, 0.214, 0.216, 0.23, 0.24, 0.243, 0.266, 0.271, 0.276, 0.277, 0.29, 0.303, 0.331, 0.349, 0.352, 0.377, 0.417, 0.488, 0.496, 0.554, 0.56, 0.608, 0.618, 0.648, 0.662, 0.671, 0.686, 0.717, 0.729, 0.769, 0.808, 0.818, 0.825, 0.827, 0.836, 0.85, 0.895, 0.913, 0.921, 0.921, 0.936, 0.941, 0.957, 0.971, 0.975, 0.979, 0.984, 0.985, 0.988, 0.992, 0.993, 0.994, 0.996, 0.998, 0.998, 0.999, 0.999, 1, 1]},
        {"name": "Human-driven median", "legendgroup": "Human-driven", "color": "blue", "x": [30.22], "y": [0.5], "mode": "markers+text", "text": ["30.2m"], "textposition": "middle right", "textfont": {"size": 12, "color": "#1f2328", "shadow": "0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff"}, "marker": {"size": 8}, "cliponaxis": false, "hovertemplate": null, "hoverinfo": "skip", "table": false},
        {"name": "Benchmark (SWE-Bench replay) median", "legendgroup": "Benchmark (SWE-Bench replay)", "color": "amber", "x": [3.204], "y": [0.5], "mode": "markers+text", "text": ["192s"], "textposition": "middle left", "textfont": {"size": 12, "color": "#1f2328", "shadow": "0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff"}, "marker": {"size": 8}, "cliponaxis": false, "hovertemplate": null, "hoverinfo": "skip", "table": false}
      ],
      "layout": {"xaxis": {"title": {"text": "Duration"}, "type": "log", "range": [-1.7782, 4.0035], "tickvals": [0.01667, 1, 60, 1440, 10080], "ticktext": ["1s", "1m", "1h", "1d", "7d"], "unifiedhovertitle": {"text": "%{x:,.3~r} min"}}, "yaxis": {"title": {"text": "CDF"}, "range": [0, 1.02], "tickvals": [0, 0.25, 0.5, 0.75, 1]}, "shapes": [{"type": "line", "x0": 3.204, "x1": 30.22, "y0": 0.5, "y1": 0.5, "layer": "between", "line": {"color": "#6b7280", "width": 1, "dash": "dot"}}], "annotations": [{"xref": "paper", "x": 1, "y": 0.08, "xanchor": "right", "yanchor": "middle", "text": "9.4× longer", "showarrow": false, "font": {"size": 12, "color": "#1f2328"}}]}
    }
    {{< /plotly >}}
  </figure>
  <figure class="fig-plot">
    <div class="fig-plot-title">Input tokens per request</div>
    {{< plotly height="280" alt="CDF of input tokens per request. The median human-driven request carries 129.1K input tokens against 25.4K for the benchmark replay, 5.1× more." >}}
    {
      "decimals": 2,
      "table": false,
      "data": [
        {"name": "Human-driven", "color": "blue", "x": [1000, 1081, 1168, 1262, 1364, 1474, 1593, 1722, 1861, 2011, 2173, 2348, 2538, 2743, 2964, 3203, 3462, 3741, 4043, 4370, 4722, 5103, 5515, 5709, 5960, 6442, 6961, 7523, 8130, 8787, 9496, 10260, 11090, 11990, 12220, 12950, 14000, 15130, 15300, 16350, 17670, 19090, 20640, 21440, 22300, 24100, 26050, 27830, 28150, 30420, 32870, 33830, 35530, 38390, 39920, 41490, 44840, 47220, 48460, 52370, 55820, 56600, 61170, 66100, 69290, 71440, 77200, 83440, 87140, 90170, 97450, 105300, 113800, 123000, 132900, 143600, 155200, 167800, 181300, 195900, 200900, 211800, 228800, 247300, 257700, 267300, 288900, 312200, 337400, 364600, 379100, 394000, 425800, 460200, 485400, 497300, 537400, 580800, 612000, 627700, 678400, 702400, 733100, 792300, 811800, 856200, 920600, 925300, 1000000], "y": [0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.003, 0.003, 0.003, 0.004, 0.004, 0.005, 0.006, 0.007, 0.008, 0.008, 0.009, 0.01, 0.012, 0.012, 0.014, 0.016, 0.019, 0.022, 0.024, 0.026, 0.031, 0.037, 0.042, 0.043, 0.05, 0.059, 0.062, 0.068, 0.08, 0.086, 0.093, 0.107, 0.118, 0.124, 0.142, 0.158, 0.162, 0.184, 0.208, 0.222, 0.233, 0.26, 0.291, 0.308, 0.324, 0.36, 0.398, 0.437, 0.476, 0.513, 0.549, 0.586, 0.619, 0.651, 0.682, 0.692, 0.711, 0.739, 0.765, 0.778, 0.788, 0.81, 0.831, 0.851, 0.87, 0.88, 0.889, 0.907, 0.923, 0.934, 0.938, 0.95, 0.961, 0.968, 0.971, 0.98, 0.984, 0.987, 0.993, 0.994, 0.996, 0.998, 0.998, 0.998]},
        {"name": "Benchmark (SWE-Bench replay)", "color": "amber", "x": [1000, 1081, 1168, 1262, 1364, 1385, 1474, 1593, 1623, 1722, 1861, 2011, 2051, 2173, 2348, 2538, 2743, 2964, 3072, 3203, 3462, 3741, 4043, 4370, 4722, 5103, 5107, 5515, 5960, 6169, 6442, 6961, 7217, 7523, 8130, 8787, 9349, 9496, 10260, 11030, 11090, 11990, 12950, 13480, 14000, 15130, 16350, 17670, 18890, 19090, 20640, 22300, 24100, 26050, 26090, 28150, 30420, 32870, 35530, 38390, 41490, 43760, 44840, 48460, 52370, 53360, 56600, 61170, 64910, 66100, 71440, 73460, 77200, 79740, 83440, 90170, 94960, 97450, 105300, 113800, 119500, 123000, 132900, 143600, 155200, 167800, 181300, 195900, 211800, 228800, 247300, 267300, 288900, 312200, 337400, 364600, 394000, 425800, 460200, 497300, 537400, 580800, 627700, 678400, 733100, 792300, 856200, 925300, 1000000], "y": [0.003, 0.003, 0.003, 0.004, 0.004, 0.004, 0.005, 0.006, 0.006, 0.009, 0.014, 0.019, 0.02, 0.022, 0.025, 0.027, 0.031, 0.034, 0.036, 0.039, 0.045, 0.052, 0.058, 0.065, 0.072, 0.078, 0.078, 0.086, 0.094, 0.098, 0.104, 0.113, 0.118, 0.125, 0.138, 0.151, 0.162, 0.165, 0.182, 0.2, 0.201, 0.222, 0.245, 0.256, 0.268, 0.294, 0.323, 0.351, 0.376, 0.38, 0.411, 0.444, 0.478, 0.513, 0.514, 0.552, 0.59, 0.629, 0.667, 0.708, 0.748, 0.774, 0.786, 0.823, 0.856, 0.864, 0.885, 0.912, 0.93, 0.934, 0.952, 0.958, 0.965, 0.97, 0.974, 0.98, 0.984, 0.986, 0.99, 0.995, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 1, 1, 1, 1, 1, 1, 1]},
        {"name": "Human-driven median", "legendgroup": "Human-driven", "color": "blue", "x": [129100], "y": [0.5], "mode": "markers+text", "text": ["129.1K"], "textposition": "middle right", "textfont": {"size": 12, "color": "#1f2328", "shadow": "0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff"}, "marker": {"size": 8}, "cliponaxis": false, "hovertemplate": null, "hoverinfo": "skip", "table": false},
        {"name": "Benchmark (SWE-Bench replay) median", "legendgroup": "Benchmark (SWE-Bench replay)", "color": "amber", "x": [25360], "y": [0.5], "mode": "markers+text", "text": ["25.4K"], "textposition": "middle left", "textfont": {"size": 12, "color": "#1f2328", "shadow": "0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff"}, "marker": {"size": 8}, "cliponaxis": false, "hovertemplate": null, "hoverinfo": "skip", "table": false}
      ],
      "layout": {"xaxis": {"title": {"text": "Input tokens"}, "type": "log", "range": [3, 6], "tickvals": [1000, 10000, 100000, 1000000], "ticktext": ["1K", "10K", "100K", "1M"], "unifiedhovertitle": {"text": "%{x:,.0f} tokens"}}, "yaxis": {"title": {"text": "CDF"}, "range": [0, 1.02], "tickvals": [0, 0.25, 0.5, 0.75, 1]}, "shapes": [{"type": "line", "x0": 25360, "x1": 129100, "y0": 0.5, "y1": 0.5, "layer": "between", "line": {"color": "#6b7280", "width": 1, "dash": "dot"}}], "annotations": [{"xref": "paper", "x": 1, "y": 0.08, "xanchor": "right", "yanchor": "middle", "text": "5.1× larger", "showarrow": false, "font": {"size": 12, "color": "#1f2328"}}]}
    }
    {{< /plotly >}}
  </figure>
</div>
{{< /diagram >}}

**Implications:** **Benchmark-only evaluations may overestimate how effectively serving systems can cache agent workloads.** Real users create longer sessions, larger contexts, and unpredictable idle periods that are not well represented by benchmark replays. Serving systems should therefore be evaluated using realistic production traces that capture user pauses, follow-up interactions, and context mutations, rather than relying on benchmarks alone.

## Paper and Dataset

This work is part of our ongoing effort to release real-world LLM serving datasets through [FreeInference Open Data](https://data.freeinference.org/), including general inference traces, agentic workloads, and GPU telemetry.

Check out our [interactive session explorer](https://agent-traces.freeinference.org/) or use the public data for your own research:

- **Paper:** [From Requests to Sessions](https://data.agentic-system.org/pdf/paper/from-requests-to-sessions.pdf)

- **Code and analysis:** [GitHub repository](https://github.com/HarvardMadSys/freeinference_agentic_trace)

- **Download dataset:** [Hugging Face](https://huggingface.co/datasets/harvardMadsys/freeinference_agentic_trace)

- **Dataset collection:** [FreeInference Open Data](https://data.freeinference.org/)

Feel free to check out this dataset and our other releases! We hope they will be useful for your research, and we'd love to see what you build with them.
