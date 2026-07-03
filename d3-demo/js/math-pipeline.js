/**
 * Numerische Pipeline zur Bachelorarbeit: Zielfunktion der Relaxierung, Frank-Wolfe (Wardrop),
 * Pfadzerlegung nach Definition in main.tex, randomisiertes Runden.
 * Global: window.CongestionPipeline
 */
(function () {
  "use strict";

  const TOL = 1e-9;
  const FW_MAX = 250;
  const PATH_CAP = 80;
  const PATH_MAX_DEPTH = 14;

  function parseEdgeIndexFromName(name, ei) {
    if (name) {
      const legacyUnicode = /^c([₀₁₂₃₄₅₆₇₈₉]+)$/.exec(name);
      if (legacyUnicode) {
        const sub = "₀₁₂₃₄₅₆₇₈₉";
        return Number(
          legacyUnicode[1].replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (ch) => String(sub.indexOf(ch)))
        );
      }
      const plain = /^c_(\d+)$/.exec(name);
      if (plain) return Number(plain[1]);
    }
    return ei + 1;
  }

  /** Anzeigename c_1, c_2, … für Kante mit Index ei. */
  function edgeName(edges, ei) {
    const e = edges[ei];
    return "c_" + parseEdgeIndexFromName(e && e.name, ei);
  }

  /** LaTeX: c_{17} statt c_17 (mehrstellige Indizes). */
  function edgeNameLatex(edges, ei) {
    const e = edges[ei];
    return "c_{" + parseEdgeIndexFromName(e && e.name, ei) + "}";
  }

  /**
   * @typedef {{ kind: 'affine', a: number, b: number } | { kind: 'poly', coeffs: number[] } | { kind: 'exp', alpha: number, beta: number, gamma?: number } | { kind: 'mm1', mu: number } | { kind: 'max', left: DelaySpec, right: DelaySpec }} DelaySpec
   */

  function ce(spec, x) {
    const t = Math.max(0, x);
    if (spec.kind === "affine") return spec.a * t + spec.b;
    if (spec.kind === "poly") {
      let s = 0;
      let p = 1;
      for (let i = 0; i < spec.coeffs.length; i++) {
        s += spec.coeffs[i] * p;
        p *= t;
      }
      return Math.max(0, s);
    }
    if (spec.kind === "exp")
      return spec.alpha * Math.exp(t / spec.beta) + (spec.gamma || 0);
    if (spec.kind === "mm1") {
      if (t >= spec.mu) return Infinity;
      return 1 / (spec.mu - t);
    }
    if (spec.kind === "max")
      return Math.max(ce(spec.left, t), ce(spec.right, t));
    return 0;
  }

  /** ∫_0^f c(τ) dτ für M/M/1: ln(μ/(μ−f)) */
  function integralMm1(mu, f) {
    const x = Math.max(0, f);
    if (x >= mu) return Infinity;
    if (x <= 1e-14) return 0;
    return Math.log(mu / (mu - x));
  }

  /** Simpson-Quadratur für ∫_0^f max{p(τ), q(τ)} dτ */
  function integralMax(spec, f) {
    const x = Math.max(0, f);
    if (x <= 1e-14) return 0;
    const N = 64;
    const h = x / N;
    const evalAt = (t) => {
      const v = ce(spec, t);
      return Number.isFinite(v) ? v : Infinity;
    };
    let sum = evalAt(0) + evalAt(x);
    for (let i = 1; i < N; i += 2) {
      const v = evalAt(i * h);
      if (!Number.isFinite(v)) return Infinity;
      sum += 4 * v;
    }
    for (let i = 2; i < N; i += 2) {
      const v = evalAt(i * h);
      if (!Number.isFinite(v)) return Infinity;
      sum += 2 * v;
    }
    return (h / 3) * sum;
  }

  /** ∫_0^f c(τ) dτ */
  function integralCe(spec, f) {
    const x = Math.max(0, f);
    if (spec.kind === "affine") return (spec.a / 2) * x * x + spec.b * x;
    if (spec.kind === "poly") {
      let s = 0;
      let pow = x;
      for (let i = 0; i < spec.coeffs.length; i++) {
        s += (spec.coeffs[i] / (i + 1)) * pow;
        pow *= x;
      }
      return Math.max(0, s);
    }
    if (spec.kind === "exp") {
      const a = spec.alpha;
      const b = spec.beta;
      const g = spec.gamma || 0;
      // ∫_0^x [ α e^{τ/β} + γ ] dτ = α β (e^{x/β} − 1) + γ x
      if (b <= 1e-14) return (a + g) * x;
      return a * b * (Math.exp(x / b) - 1) + g * x;
    }
    if (spec.kind === "mm1") return integralMm1(spec.mu, x);
    if (spec.kind === "max") return integralMax(spec, x);
    return 0;
  }

  function objectiveFromLoads(loads, edges) {
    let o = 0;
    for (let ei = 0; ei < edges.length; ei++)
      o += integralCe(edges[ei].delay, loads[ei]);
    return o;
  }

  function idxMap(nodes) {
    const m = new Map();
    nodes.forEach((n, i) => m.set(n.id, i));
    return m;
  }

  /** Kanten als Adjazenzliste: zu jedem u Liste { ei, v } */
  function buildAdj(nCount, edges, idToIdx) {
    const adj = Array.from({ length: nCount }, () => []);
    for (let ei = 0; ei < edges.length; ei++) {
      const u = idToIdx.get(edges[ei].from);
      const v = idToIdx.get(edges[ei].to);
      if (u === undefined || v === undefined) continue;
      adj[u].push({ ei, v });
    }
    return adj;
  }

  function enumeratePaths(adj, nCount, s, t, maxPaths, maxDepth) {
    /** @type {number[][]} */
    const out = [];
    function dfs(u, stackEi, depth, visited) {
      if (out.length >= maxPaths) return;
      if (u === t) {
        out.push(stackEi.slice());
        return;
      }
      if (depth >= maxDepth) return;
      visited.add(u);
      const nbr = adj[u];
      if (!nbr || !Array.isArray(nbr)) {
        visited.delete(u);
        return;
      }
      for (const { ei, v } of nbr) {
        if (visited.has(v)) continue;
        stackEi.push(ei);
        dfs(v, stackEi, depth + 1, visited);
        stackEi.pop();
      }
      visited.delete(u);
    }
    dfs(s, [], 0, new Set());
    return out;
  }

  function dijkstra(adj, nCount, source, sink, edgeCost) {
    if (
      source === undefined ||
      sink === undefined ||
      typeof source !== "number" ||
      typeof sink !== "number" ||
      source < 0 ||
      source >= nCount ||
      sink < 0 ||
      sink >= nCount
    )
      return null;
    const dist = new Float64Array(nCount).fill(Infinity);
    const parent = new Int32Array(nCount).fill(-1);
    const parentEi = new Int32Array(nCount).fill(-1);
    dist[source] = 0;
    const used = new Uint8Array(nCount);
    for (let _ = 0; _ < nCount; _++) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < nCount; i++) {
        if (!used[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      }
      if (u < 0 || best === Infinity) break;
      used[u] = 1;
      if (u === sink) break;
      const nbr = adj[u];
      if (!nbr || !Array.isArray(nbr)) continue;
      for (const { ei, v } of nbr) {
        if (v === undefined || v < 0 || v >= nCount) continue;
        const nd = dist[u] + edgeCost[ei];
        if (nd < dist[v] - 1e-15) {
          dist[v] = nd;
          parent[v] = u;
          parentEi[v] = ei;
        }
      }
    }
    if (dist[sink] === Infinity) return null;
    const pathEi = [];
    for (let v = sink; v !== source; v = parent[v]) {
      if (parentEi[v] < 0) return null;
      pathEi.push(parentEi[v]);
    }
    pathEi.reverse();
    return pathEi;
  }

  function pathKey(pathEi) {
    return pathEi.join(",");
  }

  /**
   * Frank-Wolfe auf Pfadmenge (dynamisches Hinzufügen kürzester Pfade).
   * @returns {{ ok: boolean, msg?: string, fEdge: Float64Array, fCommEdge: Float64Array[], objective: number, iterations: number, pathFlows: { commodityIndex: number, pathIndex: number, flow: number, edges: number[] }[] }}
   */
  function computeWardrop(nodes, edges, commodities, opts) {
    opts = opts || {};
    const iterationTrace = opts.recordIterationTrace ? [] : null;
    const idToIdx = idxMap(nodes);
    const nCount = nodes.length;
    const adj = buildAdj(nCount, edges, idToIdx);

    /** @type {number[][]} */
    const pathLists = commodities.map((com) => {
      const s = idToIdx.get(com.sourceId);
      const t = idToIdx.get(com.sinkId);
      if (s === undefined || t === undefined) return [];
      return enumeratePaths(adj, nCount, s, t, PATH_CAP, PATH_MAX_DEPTH);
    });

    for (let k = 0; k < commodities.length; k++) {
      if (pathLists[k].length === 0) {
        return {
          ok: false,
          msg:
            "Kein Pfad für Commodity " +
            (k + 1) +
            " (Start- und Zielknoten im Graphen prüfen).",
        };
      }
    }

    /** Gleichmäßiger Start auf bis zu zwei Pfaden (sichtbare Aufteilung). */
    const h = commodities.map((_, k) => {
      const n = pathLists[k].length;
      const arr = new Float64Array(n);
      const active = Math.min(n, 2);
      for (let p = 0; p < active; p++) arr[p] = 1 / active;
      return arr;
    });

    function aggregateLoads(hLocal) {
      const loads = new Float64Array(edges.length);
      for (let k = 0; k < commodities.length; k++) {
        for (let p = 0; p < pathLists[k].length; p++) {
          const val = hLocal[k][p];
          if (val <= TOL) continue;
          for (const ei of pathLists[k][p]) loads[ei] += val;
        }
      }
      return loads;
    }

    function pathLatency(pathEi, loads) {
      let s = 0;
      for (const ei of pathEi) s += ce(edges[ei].delay, loads[ei]);
      return s;
    }

    let iter = 0;
    let lastObj = Infinity;

    for (; iter < FW_MAX; iter++) {
      const loads = aggregateLoads(h);
      const marginal = edges.map((e, ei) => ce(e.delay, loads[ei]));

      /** Extremalpunkt w: kürzeste Pfade bei marginalen Kosten (Frank-Wolfe). */
      const w = commodities.map((com, k) => {
        const s = idToIdx.get(com.sourceId);
        const t = idToIdx.get(com.sinkId);
        const sp = dijkstra(adj, nCount, s, t, marginal);
        if (!sp) return null;
        if (pathLists[k].findIndex((pe) => pathKey(pe) === pathKey(sp)) < 0) {
          pathLists[k].push(sp);
          const nNew = pathLists[k].length;
          const nh = new Float64Array(nNew);
          for (let i = 0; i < nNew - 1; i++) nh[i] = h[k][i];
          nh[nNew - 1] = 0;
          h[k] = nh;
        }
        let minLat = Infinity;
        for (let p = 0; p < pathLists[k].length; p++) {
          const lat = pathLatency(pathLists[k][p], loads);
          if (lat < minLat) minLat = lat;
        }
        const tieTol = 1e-11 * (1 + Math.abs(minLat));
        const tied = [];
        for (let p = 0; p < pathLists[k].length; p++) {
          if (pathLatency(pathLists[k][p], loads) <= minLat + tieTol) tied.push(p);
        }
        const vec = new Float64Array(pathLists[k].length);
        const share = 1 / tied.length;
        for (let ti = 0; ti < tied.length; ti++) vec[tied[ti]] = share;
        return vec;
      });

      if (w.some((x) => x === null))
        return { ok: false, msg: "Dijkstra fehlgeschlagen (Graph prüfen)." };

      const curObj = objectiveFromLoads(loads, edges);

      function objGamma(gamma) {
        const lh = commodities.map((_, k) => {
          const nk = h[k].length;
          const out = new Float64Array(nk);
          for (let p = 0; p < nk; p++)
            out[p] = (1 - gamma) * h[k][p] + gamma * w[k][p];
          return out;
        });
        return objectiveFromLoads(aggregateLoads(lh), edges);
      }

      let bestG = 0;
      let bestVal = objGamma(0);
      for (let gi = 1; gi <= 32; gi++) {
        const g = gi / 32;
        const v = objGamma(g);
        if (v < bestVal - 1e-14) {
          bestVal = v;
          bestG = g;
        }
      }

      for (let k = 0; k < commodities.length; k++) {
        const nk = h[k].length;
        for (let p = 0; p < nk; p++)
          h[k][p] = (1 - bestG) * h[k][p] + bestG * w[k][p];
      }

      if (iterationTrace) {
        const fl = aggregateLoads(h);
        iterationTrace.push({
          iteration: iter + 1,
          objective: bestVal,
          fEdge: Array.from(fl),
        });
      }

      if (Math.abs(lastObj - bestVal) < 1e-7 * (1 + Math.abs(bestVal))) break;
      lastObj = bestVal;
    }

    const finalLoads = aggregateLoads(h);
    const flat = [];
    for (let k = 0; k < commodities.length; k++) {
      for (let p = 0; p < pathLists[k].length; p++) {
        if (h[k][p] > 1e-8)
          flat.push({
            commodityIndex: k,
            pathIndex: p,
            flow: h[k][p],
            edges: pathLists[k][p].slice(),
          });
      }
    }

    const out = {
      ok: true,
      fEdge: finalLoads,
      fCommEdge: buildCommodityEdgeFlows(pathLists, h, edges.length),
      objective: objectiveFromLoads(finalLoads, edges),
      iterations: iter + 1,
      pathFlows: flat,
      pathLists,
      h,
    };
    if (iterationTrace) out.iterationTrace = iterationTrace;
    return out;
  }

  function buildCommodityEdgeFlows(pathLists, h, eCount) {
    const out = commoditiesZero(eCount, pathLists.length);
    for (let k = 0; k < pathLists.length; k++) {
      for (let p = 0; p < pathLists[k].length; p++) {
        const val = h[k][p];
        if (val <= TOL) continue;
        for (const ei of pathLists[k][p]) out[k][ei] += val;
      }
    }
    return out;
  }

  function commoditiesZero(eCount, kCount) {
    /** @type {Float64Array[]} */
    const a = [];
    for (let i = 0; i < kCount; i++) a.push(new Float64Array(eCount));
    return a;
  }

  /** Für Zerlegung: Kanten gelten als tragend, wenn Restfluss diese Schwelle übersteigt */
  const CONNECT_TOL = 1e-10;

  /**
   * Zuverlässige Pfadverteilung: direkt aus den Pfadanteilen h des Wardrop-Flusses
   * (Summe der Gewichte je Commodity = 1). Entspricht einer gültigen Pfadzerlegung.
   */
  function pathDecompositionFromWardrop(pathLists, h, edges) {
    const steps = [];
    const distributions = [];
    for (let k = 0; k < pathLists.length; k++) {
      const map = new Map();
      for (let p = 0; p < pathLists[k].length; p++) {
        const w = h[k][p];
        if (w <= TOL) continue;
        const key = pathLists[k][p].join(",");
        map.set(key, (map.get(key) || 0) + w);
      }
      const paths = [];
      let sum = 0;
      for (const [key, weight] of map) {
        const edgeIdx = key.split(",").map(Number);
        paths.push({ edges: edgeIdx, weight });
        sum += weight;
        const labs = edgeIdx
          .map((ei) => edgeNameLatex(edges, ei))
          .join(" \\to ");
        steps.push({
          commodityIndex: k,
          weight,
          edges: edgeIdx,
          pickEdgeIndex: edgeIdx[0],
          stepNote:
            "Commodity $" +
            (k + 1) +
            "$: Pfad $" +
            labs +
            "$, Gewicht $" +
            weight.toFixed(5) +
            "$",
        });
      }
      if (Math.abs(sum - 1) > 5e-3) {
        return {
          ok: false,
          msg:
            "Pfadgewichte für Commodity " +
            (k + 1) +
            " summieren zu " +
            sum.toFixed(4) +
            " (erwartet 1). Wardrop erneut berechnen.",
          steps: [],
          distributions: [],
        };
      }
      distributions.push({ paths });
    }
    return {
      ok: true,
      steps,
      distributions,
      method: "wardrop-path-flows",
    };
  }

  /**
   * Pfadzerlegung gemäß Aufzählung in main.tex (kleinster positiver Restfluss auf einer Kante).
   */
  function pathDecomposition(fCommEdge, nodes, edges, commodities) {
    const idToIdx = idxMap(nodes);
    const nCount = nodes.length;
    const adj = buildAdj(nCount, edges, idToIdx);
    const E = edges.length;
    const K = commodities.length;

    /** Kopie Restfluss */
    const rem = [];
    for (let k = 0; k < K; k++) rem.push(new Float64Array(fCommEdge[k]));

    /** @type {{ commodityIndex: number, weight: number, edges: number[], stepNote: string }[]} */
    const steps = [];
    /** @type {{ paths: { edges: number[], weight: number }[] }[]} */
    const dist = commodities.map(() => ({ paths: [] }));

    let guard = 0;
    const maxGuard = K * E * 40 + 500;

    while (guard++ < maxGuard) {
      let pickK = -1;
      let pickEi = -1;
      let minVal = Infinity;
      for (let k = 0; k < K; k++) {
        for (let ei = 0; ei < E; ei++) {
          const v = rem[k][ei];
          if (v > CONNECT_TOL && v < minVal) {
            minVal = v;
            pickK = k;
            pickEi = ei;
          }
        }
      }
      if (pickK < 0) break;

      const com = commodities[pickK];
      const s = idToIdx.get(com.sourceId);
      const t = idToIdx.get(com.sinkId);
      const edge = edges[pickEi];
      const u = idToIdx.get(edge.from);
      const v = idToIdx.get(edge.to);

      if (
        s === undefined ||
        t === undefined ||
        u === undefined ||
        v === undefined ||
        s < 0 ||
        s >= nCount ||
        t < 0 ||
        t >= nCount ||
        u < 0 ||
        u >= nCount ||
        v < 0 ||
        v >= nCount
      ) {
        return {
          ok: false,
          msg:
            "Pfadzerlegung: ungültige Knoten-Referenz (Startknoten, Zielknoten oder Kante passen nicht zur Knotenliste). Commodities und Kanten prüfen.",
          steps,
          distributions: dist,
        };
      }

      const pathUV = buildFlowPathThroughEdge(
        adj,
        rem[pickK],
        E,
        s,
        t,
        u,
        v,
        pickEi,
        nCount
      );
      if (!pathUV) {
        return {
          ok: false,
          msg:
            "Pfadzerlegung: kein gültiger Pfad durch gewählte Kante (numerisches Problem oder Fluss nicht kreisfrei).",
          steps,
          distributions: dist,
        };
      }

      const amt = minVal;
      for (const ei of pathUV) rem[pickK][ei] -= amt;

      dist[pickK].paths.push({ edges: pathUV.slice(), weight: amt });
      const pathLabel = pathUV.map((ei) => edgeNameLatex(edges, ei)).join(" \\to ");
      steps.push({
        commodityIndex: pickK,
        weight: amt,
        edges: pathUV.slice(),
        pickEdgeIndex: pickEi,
        stepNote:
          "Commodity $" +
          (pickK + 1) +
          "$: kleinster Rest auf $" +
          edgeNameLatex(edges, pickEi) +
          "$, Pfad $" +
          pathLabel +
          "$, Gewicht $" +
          amt.toFixed(5) +
          "$",
      });
    }

    for (let k = 0; k < K; k++) {
      let s = 0;
      for (const p of dist[k].paths) s += p.weight;
      if (Math.abs(s - 1) > 1e-4)
        return {
          ok: false,
          msg:
            "Pfadzerlegung: Summe der Gewichte für Commodity " +
            (k + 1) +
            " ist " +
            s.toFixed(4) +
            " statt 1.",
          steps,
          distributions: dist,
        };
    }

    return { ok: true, steps, distributions: dist, method: "iterative-edge" };
  }

  /**
   * Pfad vom Startknoten zum Zielknoten durch gerichtete Kante pickEi=(u->v), nur Kanten mit rem>0.
   */
  function buildFlowPathThroughEdge(adj, rem, E, source, sink, u, v, pickEi, nCount) {
    if (
      rem[pickEi] <= CONNECT_TOL ||
      source === undefined ||
      sink === undefined ||
      u === undefined ||
      v === undefined ||
      typeof source !== "number" ||
      typeof sink !== "number" ||
      typeof u !== "number" ||
      typeof v !== "number" ||
      source < 0 ||
      source >= nCount ||
      sink < 0 ||
      sink >= nCount ||
      u < 0 ||
      u >= nCount ||
      v < 0 ||
      v >= nCount
    )
      return null;

    function bfsForward(from, goal, blockedEdge) {
      if (
        from === undefined ||
        goal === undefined ||
        typeof from !== "number" ||
        typeof goal !== "number" ||
        from < 0 ||
        from >= nCount ||
        goal < 0 ||
        goal >= nCount
      )
        return null;
      const prev = new Int32Array(nCount).fill(-1);
      const prevEi = new Int32Array(nCount).fill(-1);
      const q = [from];
      prev[from] = from;
      for (let qi = 0; qi < q.length; qi++) {
        const x = q[qi];
        if (x === undefined || x < 0 || x >= nCount) continue;
        if (x === goal) break;
        const nbr = adj[x];
        if (!nbr || !Array.isArray(nbr)) continue;
        for (const { ei, v: next } of nbr) {
          if (ei === blockedEdge) continue;
          if (rem[ei] <= CONNECT_TOL) continue;
          if (next === undefined || next < 0 || next >= nCount) continue;
          if (prev[next] >= 0) continue;
          prev[next] = x;
          prevEi[next] = ei;
          q.push(next);
        }
      }
      if (prev[goal] < 0) return null;
      const pathEi = [];
      for (let x = goal; x !== from; x = prev[x]) {
        if (prevEi[x] < 0) return null;
        pathEi.push(prevEi[x]);
      }
      pathEi.reverse();
      return pathEi;
    }

    const toU = bfsForward(source, u, pickEi);
    if (!toU) return null;
    const fromV = bfsForward(v, sink, pickEi);
    if (!fromV) return null;
    return toU.concat([pickEi], fromV);
  }

  /**
   * Randomisiertes Runden als Einzelschritte je Commodity (für Tutorial).
   * @returns {{ steps: object[], chosen: number[][] }}
   */
  function randomizedRoundSteps(distributions, rng, edges) {
    const rnd = rng || Math.random;
    const steps = [];
    const chosen = [];
    for (let k = 0; k < distributions.length; k++) {
      const paths = distributions[k].paths;
      const r = rnd();
      const pathOptions = [];
      let acc = 0;
      for (let i = 0; i < paths.length; i++) {
        const w = paths[i].weight;
        const lower = acc;
        acc += w;
        const pathLabel = edges
          ? paths[i].edges.map((ei) => edgeNameLatex(edges, ei)).join(" \\to ")
          : paths[i].edges.join(" \\to ");
        pathOptions.push({
          index: i,
          edges: paths[i].edges.slice(),
          weight: w,
          lower,
          upper: acc,
          pathLabel,
          isLast: i === paths.length - 1,
        });
      }
      let pick = pathOptions.length > 0 ? 0 : -1;
      for (let i = 0; i < pathOptions.length; i++) {
        if (r <= pathOptions[i].upper + 1e-12) {
          pick = i;
          break;
        }
      }
      const picked = pick >= 0 ? pathOptions[pick] : null;
      const pathEdges = picked ? picked.edges.slice() : [];
      chosen.push(pathEdges);
      const pathLabel = picked ? picked.pathLabel : "?";
      steps.push({
        commodityIndex: k,
        pathEdges,
        r,
        pickIndex: pick,
        pathOptions,
        stepNote:
          "Commodity $" +
          (k + 1) +
          "$: Zufallszahl $r=" +
          r.toFixed(4) +
          "$, gewählter Pfad $" +
          pathLabel +
          "$",
      });
    }
    return { steps, chosen };
  }

  function randomizedRound(distributions, rng) {
    const rnd = rng || Math.random;
    /** @type {number[][]} */
    const chosen = [];
    for (let k = 0; k < distributions.length; k++) {
      const paths = distributions[k].paths;
      const r = rnd();
      let acc = 0;
      let pick = 0;
      for (let i = 0; i < paths.length; i++) {
        acc += paths[i].weight;
        if (r <= acc + 1e-12) {
          pick = i;
          break;
        }
      }
      chosen.push(paths[pick].edges.slice());
    }
    return chosen;
  }

  function edgeLoadsFromDiscrete(chosenPaths, eCount) {
    const loads = new Int32Array(eCount);
    for (const pe of chosenPaths) for (const ei of pe) loads[ei]++;
    return loads;
  }

  function discretePlayerCost(chosenPaths, playerIndex, edges, loadsInt) {
    const pe = chosenPaths[playerIndex];
    let s = 0;
    for (const ei of pe) {
      const x = loadsInt[ei];
      s += ce(edges[ei].delay, x);
    }
    return s;
  }

  function bestDeviationCostDiscrete(chosenPaths, playerIndex, edges) {
    const eCount = edges.length;
    const base = loadVectorWithoutPlayer(chosenPaths, playerIndex, eCount);
    return tryAllPathsForDeviation(edges, base, playerIndex, chosenPaths, Infinity);
  }

  /**
   * Alle einfachen Pfade zwischen Startknoten und Zielknoten der Commodity (über Pfadenumeration im gesamten Graphen).
   */
  function tryAllPathsForDeviation(
    edges,
    baseLoadsWithoutPlayer,
    playerIndex,
    chosenPaths,
    initialBest
  ) {
    const playerEdges = chosenPaths[playerIndex];
    if (!playerEdges || playerEdges.length === 0) return initialBest;

    const nodeSet = new Set();
    edges.forEach((e) => {
      nodeSet.add(e.from);
      nodeSet.add(e.to);
    });
    const nodes = Array.from(nodeSet).map((id) => ({ id }));
    const idToIdx = idxMap(nodes);
    const adj = buildAdj(nodes.length, edges, idToIdx);

    const firstE = edges[playerEdges[0]];
    const lastE = edges[playerEdges[playerEdges.length - 1]];
    const sourceId = firstE.from;
    const sinkId = lastE.to;

    const s = idToIdx.get(sourceId);
    const t = idToIdx.get(sinkId);
    const candPaths = enumeratePaths(adj, nodes.length, s, t, PATH_CAP, PATH_MAX_DEPTH);

    let best = initialBest;
    for (const pathEi of candPaths) {
      const loads = new Int32Array(baseLoadsWithoutPlayer.slice());
      for (const ei of pathEi) loads[ei]++;
      let cost = 0;
      for (const ei of pathEi) cost += ce(edges[ei].delay, loads[ei]);
      if (cost < best) best = cost;
    }
    return best;
  }

  function loadVectorWithoutPlayer(chosenPaths, skip, eCount) {
    const loads = new Int32Array(eCount);
    for (let j = 0; j < chosenPaths.length; j++) {
      if (j === skip) continue;
      for (const ei of chosenPaths[j]) loads[ei]++;
    }
    return loads;
  }

  function minEpsilonApproxNashDiscrete(chosenPaths, edges) {
    const eCount = edges.length;
    let maxEps = 0;
    for (let i = 0; i < chosenPaths.length; i++) {
      const loads = new Int32Array(eCount);
      for (let j = 0; j < chosenPaths.length; j++)
        for (const ei of chosenPaths[j]) loads[ei]++;
      const C = discretePlayerCost(chosenPaths, i, edges, loads);
      const base = loadVectorWithoutPlayer(chosenPaths, i, eCount);
      const star = tryAllPathsForDeviation(edges, base, i, chosenPaths, Infinity);
      if (star > 1e-14 && C / star - 1 > maxEps) maxEps = C / star - 1;
    }
    return Math.max(0, maxEps);
  }

  function isEpsilonApproxDiscrete(chosenPaths, edges, eps) {
    const eCount = edges.length;
    const tol = 1e-8;
    if (eps < 0) return false;
    for (let i = 0; i < chosenPaths.length; i++) {
      const loads = new Int32Array(eCount);
      for (let j = 0; j < chosenPaths.length; j++)
        for (const ei of chosenPaths[j]) loads[ei]++;
      const C = discretePlayerCost(chosenPaths, i, edges, loads);
      const base = loadVectorWithoutPlayer(chosenPaths, i, eCount);
      const star = tryAllPathsForDeviation(edges, base, i, chosenPaths, Infinity);
      if (star < 1e-14) {
        if (C > tol) return false;
        continue;
      }
      if (C > (1 + eps) * star + tol) return false;
    }
    return true;
  }

  /**
   * Konzentrationsintervall I_e = [l_e, u_e] aus Satz hinr (main.tex).
   * @returns {{ le: number, ue: number, m: number, L: number }}
   */
  function concentrationInterval(m, fe) {
    const mm = Math.max(1, m);
    const f = Math.max(0, fe);
    const L = Math.log(4 * mm);
    const le = f - Math.sqrt(3 * L * f);
    const ue = Math.max(6 * L, f + Math.sqrt(3 * L * f));
    return { le, ue, m: mm, L, fe: f };
  }

  /**
   * Prüft, ob alle gerundeten Kantenlasten in den Konzentrationsintervallen [l_e, u_e] liegen
   * (hinreichende Erfolgsbedingung aus Schritt 3.2 / Schlüssellemma-Voraussetzung).
   * @returns {{ ok: boolean, m: number, edges: Array<{ ei: number, Ne: number, fe: number, le: number, ue: number, ok: boolean }> }}
   */
  function checkRoundedLoadsInIntervals(chosenPaths, edges, wardropFEdge) {
    const m = edges.length;
    const loads = edgeLoadsFromDiscrete(chosenPaths, m);
    const tol = 1e-9;
    const rows = [];
    let allOk = true;
    for (let ei = 0; ei < m; ei++) {
      const fe = wardropFEdge[ei] || 0;
      const iv = concentrationInterval(m, fe);
      const Ne = loads[ei];
      const ok = Ne >= iv.le - tol && Ne <= iv.ue + tol;
      if (!ok) allOk = false;
      rows.push({
        ei,
        Ne,
        fe,
        le: iv.le,
        ue: iv.ue,
        ok,
      });
    }
    return { ok: allOk, m, edges: rows, loads };
  }

  /** Untere Schranke für a_0 bei Polynomgrad g (Bedingung aus Abschnitt 4.1). */
  function minPolyConstantTerm(coeffs, m, eps) {
    if (!coeffs || coeffs.length < 2) return 0;
    const g = coeffs.length - 1;
    let sumJ = 0;
    for (let j = 1; j < coeffs.length; j++) sumJ += Math.max(0, coeffs[j]);
    if (sumJ <= 1e-12) return 0;
    const L = Math.log(4 * Math.max(1, m));
    const lnPow = Math.pow(L, g);
    const epsPow = Math.pow(Math.max(eps, 1e-6), 2 * g + 1);
    return (lnPow / epsPow) * sumJ;
  }

  /** Untere Schranke für β (Satz exp, u = u_e). */
  function minExpBeta(m, ue, eps) {
    const L = Math.log(4 * Math.max(1, m));
    const ln1e = Math.log(1 + Math.max(eps, 1e-6));
    return (2 * Math.sqrt(6 * L * Math.max(0, ue))) / ln1e;
  }

  /** Untere Schranke für μ (Satz mm1, u = u_e). */
  function minMm1Mu(m, ue, eps) {
    const L = Math.log(4 * Math.max(1, m));
    const u = Math.max(0, ue);
    const root = Math.sqrt(1 + Math.max(eps, 1e-6)) - 1;
    return u + Math.sqrt(6 * L * u) / root + 1e-6;
  }

  /**
   * Hinreichende Parameteruntergrenzen für die Arbeit (ε, u_e).
   * @returns {Record<string, { min: number, max?: number }>}
   */
  function delayParameterBounds(spec, m, ue, eps) {
    eps = Math.max(eps, 1e-6);
    if (spec.kind === "affine") {
      const minB = minPolyConstantTerm([0, spec.a], m, eps);
      return {
        a: { min: 0 },
        b: { min: minB },
      };
    }
    if (spec.kind === "poly") {
      const minA0 = minPolyConstantTerm(spec.coeffs, m, eps);
      return {
        a0: { min: minA0 },
        a1: { min: 0 },
        a2: { min: 0 },
      };
    }
    if (spec.kind === "exp") {
      return {
        alpha: { min: 1e-6 },
        beta: { min: minExpBeta(m, ue, eps) },
        gamma: { min: 0 },
      };
    }
    if (spec.kind === "mm1") {
      const minMu = minMm1Mu(m, ue, eps);
      return { mu: { min: minMu } };
    }
    if (spec.kind === "max") {
      return {
        left: delayParameterBounds(spec.left, m, ue, eps),
        right: delayParameterBounds(spec.right, m, ue, eps),
      };
    }
    return {};
  }

  /** Prüft die Bandbedingung auf [lo, hi] durch Abtastung (Lemma Schlüssel). */
  function checkBandOnInterval(spec, fe, lo, hi, eps, samples) {
    const n = samples || 48;
    if (fe <= 0 || hi < lo) return { ok: false, reason: "kein Fluss" };
    const cf = ce(spec, fe);
    if (!Number.isFinite(cf) || cf <= 0) return { ok: false, reason: "c(f_e) ungültig" };
    const band = Math.sqrt(1 + eps);
    const bandLow = cf / band;
    const bandHigh = cf * band;
    const xLo = Math.max(0, lo);
    const xHi = Math.max(xLo, hi);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = xLo + t * (xHi - xLo);
      const y = ce(spec, x);
      if (!Number.isFinite(y)) return { ok: false, reason: "c(x) nicht endlich bei x=" + x.toFixed(2) };
      if (y < bandLow - 1e-9 || y > bandHigh + 1e-9)
        return { ok: false, reason: "Band verletzt bei x=" + x.toFixed(2) };
    }
    return { ok: true };
  }

  /**
   * Anzeige-Untergrenze: auf dieselbe Genauigkeit wie in der UI aufrunden,
   * damit erzwungene Werte nicht knapp unter der angezeigten Grenze liegen.
   */
  function effectiveBoundMin(min) {
    if (min == null || !Number.isFinite(min)) return min;
    if (min >= 100) return Math.ceil(min * 10 - 1e-9) / 10;
    if (min >= 10) return Math.ceil(min * 100 - 1e-9) / 100;
    return Math.ceil(min * 1000 - 1e-9) / 1000;
  }

  /** Setzt Parameter auf die Untergrenzen aus delayParameterBounds. */
  function enforceDelayParameterBounds(spec, m, ue, eps) {
    const b = delayParameterBounds(spec, m, ue, eps);
    if (spec.kind === "affine") {
      const minA = effectiveBoundMin(b.a.min);
      const minB = effectiveBoundMin(b.b.min);
      if (spec.a < minA - 1e-9) spec.a = minA;
      if (spec.b < minB - 1e-9) spec.b = minB;
    } else if (spec.kind === "poly") {
      if (!spec.coeffs) spec.coeffs = [1, 0, 0];
      if (spec.coeffs[1] < 0) spec.coeffs[1] = 0;
      if (spec.coeffs[2] < 0) spec.coeffs[2] = 0;
      const minA0 = effectiveBoundMin(b.a0.min);
      if (spec.coeffs[0] < minA0 - 1e-9) spec.coeffs[0] = minA0;
    } else if (spec.kind === "exp") {
      const minAlpha = effectiveBoundMin(b.alpha.min);
      const minBeta = effectiveBoundMin(b.beta.min);
      if (spec.alpha < minAlpha - 1e-9) spec.alpha = minAlpha;
      if (spec.beta < minBeta - 1e-9) spec.beta = minBeta;
      if ((spec.gamma || 0) < 0) spec.gamma = 0;
    } else if (spec.kind === "mm1") {
      const minMu = effectiveBoundMin(b.mu.min);
      if (spec.mu < minMu - 1e-9) spec.mu = minMu;
    } else if (spec.kind === "max") {
      enforceDelayParameterBounds(spec.left, m, ue, eps);
      enforceDelayParameterBounds(spec.right, m, ue, eps);
    }
    return spec;
  }

  function clampToBounds(value, bound) {
    if (!bound) return value;
    let v = value;
    if (bound.min != null) {
      const effMin = effectiveBoundMin(bound.min);
      if (v < effMin - 1e-9) v = effMin;
    }
    if (bound.max != null && v > bound.max) v = bound.max;
    return v;
  }

  /** Grobe Chernoff-Illustration zu main.tex (δ aus Beispiel, nicht vollständiger Satz 3.2) */
  function chernoffIllustration(m, fe) {
    if (fe <= 0 || m <= 0) return null;
    const ln4m = Math.log(4 * m);
    const delta = Math.sqrt((3 * ln4m) / fe);
    const upperTail = Math.exp(-((delta * delta * fe) / 3));
    return { delta, upperTailOneSided: upperTail, ln4m };
  }

  window.CongestionPipeline = {
    ce,
    integralCe,
    concentrationInterval,
    checkRoundedLoadsInIntervals,
    minPolyConstantTerm,
    minExpBeta,
    minMm1Mu,
    delayParameterBounds,
    checkBandOnInterval,
    enforceDelayParameterBounds,
    effectiveBoundMin,
    clampToBounds,
    computeWardrop,
    pathDecomposition,
    pathDecompositionFromWardrop,
    randomizedRound,
    randomizedRoundSteps,
    edgeLoadsFromDiscrete,
    discretePlayerCost,
    minEpsilonApproxNashDiscrete,
    isEpsilonApproxDiscrete,
    chernoffIllustration,
    enumeratePaths,
    buildAdj,
    idxMap,
    PATH_CAP,
    bestDeviationCostDiscrete,
  };
})();
