/**
 * Editor, Schritt-für-Schritt-Pipeline, D3-Zeichnung.
 */
(function () {
  "use strict";

  const P = window.CongestionPipeline;
  /**
   * Einheitliches ε der gesamten Demo (Parameter- und Bandprüfung im Instanz-Editor,
   * Toleranzband in den Plot-Schritten 7 und 8). Ein gemeinsamer Wert stellt sicher,
   * dass die im Editor angezeigten Parametergrenzen und das visualisierte Band
   * dieselbe Approximationsgüte beschreiben.
   */
  const THESIS_EPS = 0.3;
  /** Max. vorbereitete Commodity-Blueprints im Zufallsnetz (Obergrenze des Reglers). */
  const DEMO_COMMODITY_MAX = 1000;
  /** Höchstens so viele verschiedene Start- bzw. Zielknoten im Zufallsnetz. */
  const MAX_DISTINCT_ENDPOINTS = 5;
  /** Standard-Anzahl aktiver Spielenden beim Laden bzw. nach „Zufallsnetz“. */
  const DEFAULT_PLAYER_COUNT = 4;
  /** Gespeicherte Start- und Zielknoten aller Zufallsnetz-Commodities (für dynamische Anzahl Spielender). */
  let randomNetworkBlueprints = null;
  /** Feste Menge von bis zu drei Start- und Zielknoten je Zufallsnetz. */
  let randomNetworkEndpointPool = null;
  /** Wardrop-Vorschau für f_e und Bandprüfung im Instanz-Editor (unabhängig von der Pipeline). */
  let wardropValidationPreview = null;
  /** true nach „Zufallsnetz“. */
  let isRandomNetworkInstance = false;
  /** Gemeinsames Kostenprofil des aktuellen Zufallsnetzes (für Reharmonisierung nach Thesis-Reparatur). */
  let randomNetworkDidacticProfile = null;
  let playerCountRecomputeTimer = null;
  let playerCountControlWired = false;
  /** Wird bei jeder Pipeline-Neuberechnung erhöht, damit Plots nicht veraltete Verteilungen zeigen. */
  let pipelinePlotRevision = 0;
  let nodeIdSeq = 1;
  let edgeIdSeq = 1;
  function nid() {
    return "n" + nodeIdSeq++;
  }
  function eid() {
    return "e" + edgeIdSeq++;
  }
  function resetIdSequences() {
    nodeIdSeq = 1;
    edgeIdSeq = 1;
  }

  /** Kantenindex aus gespeichertem Namen (c_12, Legacy c₁₂) oder Position ei. */
  function parseEdgeIndex(name, ei) {
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

  /** Anzeigename c mit Index (Speicherformat c_1, c_12, …). */
  function edgeNameFromIndex(ei) {
    return "c_" + (ei + 1);
  }

  function edgeName(e, ei) {
    if (e && e.name) return "c_" + parseEdgeIndex(e.name, ei);
    return edgeNameFromIndex(ei);
  }

  /** HTML: c mit tiefgestelltem Index (ein Block, auch bei mehrstelligen Indizes). */
  function edgeNameHtml(e, ei) {
    return "c<sub>" + parseEdgeIndex(e && e.name, ei) + "</sub>";
  }

  /** LaTeX/KaTeX: c_{17} (geschweifte Klammern für mehrstellige Indizes). */
  function edgeNameLatex(e, ei) {
    return "c_{" + parseEdgeIndex(e && e.name, ei) + "}";
  }

  /** LaTeX/KaTeX für Knoten-IDs wie n17 oder n_6 → n_{17}. */
  function parseNodeIdParts(id) {
    const m = /^([a-zA-Z])_?(\d+)$/.exec(String(id || ""));
    if (!m) return null;
    return { base: m[1], index: m[2] };
  }

  function nodeIdLatex(id) {
    const p = parseNodeIdParts(id);
    if (!p) return String(id || "?").replace(/_/g, "\\_");
    return p.base + "_{" + p.index + "}";
  }

  /** Unicode-Tiefgestellt für native Selects (n₁ statt n1). */
  function nodeIdUnicodeSub(id) {
    const p = parseNodeIdParts(id);
    if (!p) return String(id || "?");
    const sub = "₀₁₂₃₄₅₆₇₈₉";
    return p.base + p.index.replace(/\d/g, function (d) {
      return sub[d];
    });
  }

  /** HTML mit KaTeX für Knoten-IDs. */
  function nodeIdHtml(id) {
    return math(nodeIdLatex(id));
  }

  /** HTML: n_{a} → n_{b} für Kanten-Endpunkte. */
  function nodePairHtml(fromId, toId) {
    return nodeIdHtml(fromId) + " " + math("\\rightarrow") + " " + nodeIdHtml(toId);
  }

  /** Anzeigetext für Knoten in Dropdowns. */
  function nodeOptionLabel(id) {
    return nodeIdUnicodeSub(id);
  }

  /** SVG: Knoten-ID n_k mit tiefgestelltem Index. */
  function appendSvgNodeIdTspans(parentSel, nodeId) {
    const p = parseNodeIdParts(nodeId);
    if (!p) {
      parentSel.append("tspan").text(String(nodeId || "?"));
      return;
    }
    parentSel.append("tspan").attr("class", "node-name-base").text(p.base);
    for (let d = 0; d < p.index.length; d++) {
      parentSel
        .append("tspan")
        .attr("class", "edge-name-sub")
        .attr("baseline-shift", "sub")
        .attr("font-size", "6.5px")
        .text(p.index[d]);
    }
  }

  function setSvgNodeIdLabel(textEl, nodeId) {
    const sel = d3.select(textEl);
    sel.selectAll("tspan").remove();
    sel.text(null);
    appendSvgNodeIdTspans(sel, nodeId);
  }

  /** LaTeX für Index der Spielenden k (1-basiert): s_{k}. */
  function playerIndexLatex(k) {
    return "s_{" + k + "}";
  }

  /** HTML-Span mit KaTeX für s_{k}. */
  function playerIndexHtml(k) {
    return math(playerIndexLatex(k));
  }

  /** HTML für Startknoten/Zielknoten der Spielenden k: p_{s_k}, t_{s_k}. */
  function playerSourceLabelHtml(k) {
    return math("p_{" + playerIndexLatex(k) + "}");
  }

  function playerSinkLabelHtml(k) {
    return math("t_{" + playerIndexLatex(k) + "}");
  }

  /** HTML: Pfad als c₁ → c₂ … (Kantenindizes). */
  function edgePathLabelHtml(edgeEis) {
    return edgeEis
      .map(function (ei, i) {
        const part = edgeNameHtml(G.edges[ei], ei);
        return i === 0 ? part : math("\\rightarrow") + " " + part;
      })
      .join(" ");
  }
  function latexifyEdgeSubscripts(str) {
    if (!str) return "";
    let s = str.replace(/c_(\d+)/g, function (_, num) {
      return "c_{" + num + "}";
    });
    s = s.replace(/\bn_?(\d+)\b/g, function (_, num) {
      return "n_{" + num + "}";
    });
    return s;
  }

  /** SVG: je Ziffer ein tiefgestelltes tspan (robust in Monospace-Schriften). */
  function appendSvgEdgeIndexTspans(parentSel, edgeIdx) {
    parentSel.append("tspan").attr("class", "edge-name-c").text("c");
    const digits = String(edgeIdx);
    for (let d = 0; d < digits.length; d++) {
      parentSel
        .append("tspan")
        .attr("class", "edge-name-sub")
        .attr("baseline-shift", "sub")
        .attr("font-size", "6.5px")
        .text(digits[d]);
    }
  }

  /** Segment für setSvgMathLabel: Tiefgestellt/ Hochgestellt wie in LaTeX (z. B. f_e, f_e^s). */
  function mvar(base, sub, sup) {
    const seg = { base: base };
    if (sub != null) seg.sub = String(sub);
    if (sup != null) seg.sup = String(sup);
    return seg;
  }

  /** Fügt Mathesegmente als SVG-tspan an parentSel an (ohne zu leeren). */
  function appendSvgMathSegments(parentSel, segments) {
    if (!segments) return;
    const list = typeof segments === "string" ? [segments] : segments;
    for (let i = 0; i < list.length; i++) {
      const seg = list[i];
      if (typeof seg === "string") {
        if (seg) parentSel.append("tspan").text(seg);
        continue;
      }
      const main = parentSel.append("tspan");
      if (seg.class) main.attr("class", seg.class);
      if (seg.dx) main.attr("dx", seg.dx);
      main.text(seg.base);
      if (seg.sub != null) {
        main
          .append("tspan")
          .attr("baseline-shift", "sub")
          .attr("font-size", "6.5px")
          .text(seg.sub);
      }
      if (seg.sup != null) {
        main
          .append("tspan")
          .attr("baseline-shift", "super")
          .attr("font-size", "6.5px")
          .text(seg.sup);
      }
    }
  }

  /** SVG-Text aus Mathesegmenten (Strings oder mvar-Objekte). */
  function setSvgMathLabel(textEl, segments) {
    const sel = d3.select(textEl);
    sel.selectAll("tspan").remove();
    sel.text(null);
    appendSvgMathSegments(sel, segments);
  }

  /** SVG-Plot-Titel: String, Segmentliste oder { segmentsBefore, edgeIdx, after }. */
  function setSvgPlotTitle(textEl, title) {
    const sel = d3.select(textEl);
    sel.selectAll("tspan").remove();
    sel.text(null);
    if (!title) return;
    if (typeof title === "string") {
      sel.text(title);
      return;
    }
    if (Array.isArray(title)) {
      appendSvgMathSegments(sel, title);
      return;
    }
    if (title.segmentsBefore) appendSvgMathSegments(sel, title.segmentsBefore);
    else if (title.before) sel.append("tspan").text(title.before);
    if (title.edgeIdx != null) appendSvgEdgeIndexTspans(sel, title.edgeIdx);
    if (title.segmentsAfter) appendSvgMathSegments(sel, title.segmentsAfter);
    else if (title.after) {
      sel.append("tspan").attr("class", "edge-name-suffix").attr("dx", "0.5").text(title.after);
    }
  }

  /** SVG-Text mit optionalem c-Index als tspan-Tiefgestellt. */
  function setSvgLabelWithEdgeName(textEl, before, edgeIdx, after) {
    setSvgPlotTitle(textEl, {
      before: before,
      edgeIdx: edgeIdx,
      after: after,
    });
  }

  /** SVG-Text: c mit tiefgestelltem Index (auch c₁₀, c₁₇). */
  function setSvgEdgeNameLabel(textEl, edgeIdx, suffix) {
    setSvgLabelWithEdgeName(textEl, "", edgeIdx, suffix);
  }

  /** Kantenbeschriftung: · f_e^s = Wert (Notation wie in main.tex). */
  function appendSvgFlowSuffix(parentSel, sub, sup, valueText) {
    parentSel.append("tspan").attr("class", "edge-name-suffix").attr("dx", "0.5").text(" · ");
    appendSvgMathSegments(parentSel, [mvar("f", sub, sup), "=" + valueText]);
  }

  /** Kanten in G.edges der Reihe nach c_1 … c_m benennen. */
  function syncEdgeNames() {
    G.edges.forEach((e, ei) => {
      e.name = edgeNameFromIndex(ei);
    });
  }

  /** @type {{ nodes: object[], edges: object[], commodities: object[] }} */
  let G = { nodes: [], edges: [], commodities: [] };

  /** Kantenbeschriftung mit Verzögerungs-/Kostenformel (und f nach Wardrop) */
  let showEdgeDelayLabels = false;

  let pipeline = {
    wardrop: null,
    decomp: null,
    rounded: null,
    stepDone: [false, false, false, false, false, false],
  };

  let currentStep = 1;

  /** Während der Pipeline: kein Editieren des Graphen */
  let pipelineLocked = false;
  /** Programmschritte 1 bis 7 (Begleittext) innerhalb der Pipeline */
  let pipelineAsideStep = 1;
  /** Kartenindex innerhalb des aktuellen Schritts (nur im Folienmodus) */
  let pipelineIntroSlide = 0;
  /**
   * null: Folien; sonst eingebettete Rechen- oder Schrittphasen im Panel.
   * wardrop_fw: Iterationen der Zielfunktionsminimierung; wardrop_done: Zusammenfassung;
   * decomp: Pfadzerlegung Schritt für Schritt; round: Ziehungen nacheinander;
   * interval_check: Intervall-Checker am Ende der Pipeline (Schritt 7).
   */
  let pipelineInteractive = null;
  let pipelineFwIdx = -1;
  let pipelineWardropTrace = null;
  /** true, sobald in dieser Pipeline-Lauf ein Wardrop-Minimierer berechnet wurde */
  let pipelineWardropCompleted = false;
  let pipelineDecompReveal = 0;
  let pipelineRoundActive = false;
  let pipelineRoundSteps = null;
  let pipelineRoundChosen = null;
  let pipelineRoundRevealed = 0;
  /** Versuche im Intervall-Checker (Schritt 7); 0 = noch nicht gestartet. */
  let pipelineCheckAttempt = 0;
  /** Ergebnis der letzten Intervallprüfung (N_e ∈ [l_e, u_e] für alle Kanten). */
  let pipelineCheckResult = null;
  /** Index der Commodity, deren Start-/Zielknoten auf Karte 1 von Schritt 1 hervorgehoben werden (−1: aus) */
  let pipelineCommodityPulseIdx = -1;
  let pipelineCommodityPulseTimer = null;
  /** Nach Wardrop: ausgewählte Commodity für Pfadanteils-Visualisierung (−1: keine) */
  let pipelineWardropCommodityIdx = -1;
  /** false, solange die Bühne einen Plot statt des Netzwerks zeigt (Zoom/Pan deaktiviert). */
  let pipelineGraphZoomEnabled = true;
  const WARDROP_PATH_FLOW_TOL = 1e-6;
  const WARDROP_PATH_COLOR_COUNT = 6;
  const COMMODITY_PULSE_MS = 1750;
  const NODE_BASE_R = 14;
  const NODE_SPOTLIGHT_R = 20;
  const NODE_LABEL_FONT = 11;
  const NODE_LABEL_FONT_SPOTLIGHT = 13;
  /** Schritt 2: Demo diskret vs. relaxiert */
  let pipelineRelaxDemoData = null;
  let pipelineRelaxDemoLayoutFp = "";
  let pipelineRelaxDemoPhase = "discrete";
  let pipelineRelaxDemoTimer = null;
  let pipelineRelaxAnimToken = 0;
  const RELAX_DEMO_PHASE_MS = 4200;
  const RELAX_TOKEN_DURATION_MS = 3400;

  const DEFAULT_GRAPH_HINT =
    "Mausrad zoomt. Ziehen auf dem leeren Hintergrund verschiebt die Ansicht (auch Umschalt+Linke Taste oder mittlere Taste). Jede Kante trägt einen eindeutigen Namen c<sub>1</sub>, c<sub>2</sub>, …. In der Beschriftung erscheinen optional f (Gesamtfluss nach Wardrop) und die Kurzform der Verzögerungsfunktion. Schalter in der Werkzeugleiste blendet die Formel ein oder aus.";

  const PLOT_STAGE_HINT =
    "Mausrad zoomt in die Diagrammansicht. Ziehen mit linker Maustaste verschiebt den sichtbaren Ausschnitt. Doppelklick setzt den Zoom zurück.";

  function escHtmlAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /** LaTeX-Formel als Block (wird nach dem Einfügen per KaTeX gesetzt). */
  function formula(latex) {
    return (
      '<div class="formula-block" data-latex="' + escHtmlAttr(latex) + '"></div>'
    );
  }

  /** LaTeX-Formel inline im Fließtext. */
  function math(latex) {
    return (
      '<span class="math-inline" data-latex="' + escHtmlAttr(latex) + '"></span>'
    );
  }

  /**
   * Ersetzt $...$-Markierungen im HTML durch KaTeX-Inline-Spans.
   * Beispiel: tex("Last $f_e$ auf Kante $e$.")
   */
  function tex(html) {
    if (!html) return "";
    return html.replace(/\$([^$]+)\$/g, function (_, latex) {
      return math(latex);
    });
  }

  /** Schrittnotizen aus Pfadzerlegung/Runden für das Pipeline-Panel. */
  function pipelineStepNoteHtml(note) {
    if (!note) return "";
    return tex("<p>" + latexifyEdgeSubscripts(note) + "</p>");
  }

  function renderPipelineMath(root) {
    if (!root || typeof katex === "undefined") return;
    root.querySelectorAll(".formula-block[data-latex], .math-inline[data-latex]").forEach(
      function (el) {
        const latex = el.getAttribute("data-latex");
        if (!latex) return;
        const displayMode = el.classList.contains("formula-block");
        try {
          katex.render(latex, el, {
            displayMode: displayMode,
            throwOnError: false,
            strict: "ignore",
          });
        } catch (err) {
          /* Fallback: data-latex bleibt sichtbar */
        }
      }
    );
  }

  function setPipelineSlideBody(el, html) {
    if (!el) return;
    el.innerHTML = html;
    renderPipelineMath(el);
  }

  /**
   * Einordnung zu Schritt 1: sachlicher Kontext zur Demo, ohne Verweis auf eine konkrete Arbeit oder Beweise.
   */
  const PIPELINE_STEP1_SLIDES = [
    {
      title: "Netzwerk-Auslastungsspiel",
      html: tex(
        "<p>Es liegt ein <strong>Netzwerk-Auslastungsspiel</strong> vor: Jede spielende Person routet je eine Einheit entlang einfacher Pfade von einem Startknoten $p_s$ zu einem Zielknoten $t_s$ in einem gerichteten Graphen $G = (V, E)$. Die Kanten tragen monoton steigende <strong>Verzögerungsfunktionen</strong> $c_e$, ausgewertet bei der Zahl der Nutzenden der Kante.</p>" +
          "<p>Eine <strong>Strategiekombination</strong> $\\sigma$ legt für jede spielende Person $s$ den gewählten einfachen Pfad von $p_s$ nach $t_s$ fest. Sie fasst damit alle Pfadwahlen zu einem gemeinsamen Zustand zusammen.</p>" +
          "<p>Die <strong>individuellen Kosten</strong> einer spielenden Person unter einer Strategiekombination $\\sigma$ ergeben sich als Summe der Verzögerungen auf den Kanten des gewählten Pfads, jeweils ausgewertet bei der gemeinsamen Kantenbelastung $n_{\\sigma}(e)$, die sich aus allen gewählten Pfaden ergibt.</p>"
      ),
    },
    {
      title: "Reines Nash-Gleichgewicht",
      html:
        tex(
          "<p>Stabilität wird im Folgenden im Sinne eines <strong>reinen Nash-Gleichgewichts</strong> verstanden.</p>"
        ) +
        '<div class="def-box">' +
        tex(
          "<strong>Reines Nash-Gleichgewicht.</strong> Eine Strategiekombination $\\sigma$ heißt (reines) Nash-Gleichgewicht, wenn für alle Spielenden $s \\in S$ und alle alternativen Strategien $\\sigma_s^* \\in Z_s$ gilt:"
        ) +
        formula("C_s(\\sigma_s, \\sigma_{-s}) \\leq C_s(\\sigma_s^*, \\sigma_{-s}).") +
        "</div>" +
        tex("<p>Keine spielende Person kann durch einseitiges Abweichen die eigenen Kosten verringern.</p>"),
    },
    {
      title: "Existenz eines Nash-Gleichgewichts",
      html:
        "<p>Für die <strong>Existenz</strong> eines stabilen Zustands gilt die folgende klassische Aussage.</p>" +
        '<div class="def-box"><strong>Existenzsatz.</strong> Jedes (ungewichtete) Auslastungsspiel besitzt mindestens ein reines Nash-Gleichgewicht.</div>',
    },
    {
      title: "Berechnung: keine effiziente Suche nach einem reinen Nash-Gleichgewicht",
      html:
        "<p>Existenz allein liefert noch keinen <strong>effizienten Algorithmus</strong>, der ein solches Gleichgewicht findet.</p>" +
        '<div class="def-box"><strong>Ergebnis (PLS-Vollständigkeit).</strong> Das Problem, ein reines Nash-Gleichgewicht in einem <em>asymmetrischen</em> Netzwerk-Auslastungsspiel zu berechnen, ist PLS-vollständig, selbst wenn alle Verzögerungsfunktionen linear sind.</div>' +
        "<p>PLS-vollständige Probleme gelten daher im Worst Case als <strong>nicht effizient lösbar</strong> (Polynomialzeit wird nicht erwartet).</p>",
    },
    {
      title: "ε-approximiertes Nash-Gleichgewicht",
      html:
        tex(
          "<p>Daher wird die Stabilitätsforderung <strong>abgeschwächt</strong>: statt der exakten Nash-Bedingung wird eine <strong>multiplikative Toleranz</strong> $(1 + \\varepsilon)$ zugelassen.</p>"
        ) +
        '<div class="def-box">' +
        tex(
          "<strong>$\\varepsilon$-approximiertes Nash-Gleichgewicht.</strong> Für $\\varepsilon > 0$ heißt $\\sigma$ ein $\\varepsilon$-approximiertes Nash-Gleichgewicht, wenn für alle $s \\in S$ und alle $\\sigma_s^* \\in Z_s$ gilt:"
        ) +
        formula(
          "C_s(\\sigma_s, \\sigma_{-s}) \\leq (1 + \\varepsilon) \\cdot C_s(\\sigma_s^*, \\sigma_{-s})."
        ) +
        "</div>" +
        tex(
          "<p>Intuitiv lohnt sich ein Wechsel nicht, solange jede Alternative die Kosten höchstens um den Faktor $(1 + \\varepsilon)$ senken könnte.</p>"
        ),
    },
    {
      title: "Nicht jedes Spiel, nicht jede Verzögerung",
      html: tex(
        "<p>Selbst <strong>$\\varepsilon$-approximierte</strong> Nash-Gleichgewichte können für festes $\\varepsilon > 0$ PLS-hart sein, wenn <strong>künstlich steile</strong> Verzögerungen zugelassen werden.</p>" +
          "<p>Beliebige monoton steigende Verzögerungsfunktionen sind damit zu allgemein. Stattdessen werden nur <strong>vier strukturierte Klassen</strong> betrachtet, für die positive algorithmische Ergebnisse bekannt sind.</p>"
      ),
    },
    {
      title: "Untersuchte Verzögerungsfunktionen",
      html:
        tex(
          "<p>Die folgende Übersicht legt diese vier Klassen fest. Demonstration und spätere Algorithmen verwenden ausschließlich Verzögerungen $c_e$ daraus. Als Grundbausteine dienen die Typen (i) bis (iii). Typ (iv) setzt $c_e$ als punktweises Maximum zweier Funktionen aus diesen drei Klassen.</p>"
        ) +
        '<div class="def-box">' +
        "<p><strong>(i) Polynome mit nichtnegativen Koeffizienten.</strong></p>" +
        formula(
          "c_e(x) = \\sum_{j=0}^{g} a_j^e \\, x^j, \\quad a_j^e \\geq 0 \\text{ für alle } j,\\; a_g^e > 0,\\; a_0^e > 0."
        ) +
        tex(
          "<p>Mit konstantem Grad $g \\in \\N_0$ und $a_0^e > 0$ gilt $c_e(0) > 0$. Alle Koeffizienten sind nichtnegativ, daher wächst $c_e$ monoton (affine Verzögerungen $a \\cdot x + b$ sind der Spezialfall kleinen Grades).</p>"
        ) +
        "<p><strong>(ii) Exponentialfunktionen.</strong></p>" +
        formula(
          "c_e(x) = \\alpha_e \\cdot \\exp\\!\\left(\\frac{x}{\\beta_e}\\right) + \\gamma_e, \\quad \\alpha_e > 0,\\; \\gamma_e \\geq 0,\\; \\beta_e > 0."
        ) +
        tex(
          "<p>Die Parameter $\\alpha_e > 0$ und $\\beta_e > 0$ steuern Amplitude und Wachstumsgeschwindigkeit. Zudem erlaubt $\\gamma_e \\geq 0$ auch reine Exponentialfunktionen ($\\gamma_e = 0$). Es gilt $c_e(0) = \\alpha_e + \\gamma_e > 0$.</p>"
        ) +
        "<p><strong>(iii) Verzögerungsfunktionen aus der Warteschlangentheorie (M/M/1).</strong></p>" +
        formula(
          "c_e(x) = \\frac{1}{\\mu_e - x} \\quad \\text{für } 0 \\leq x < \\mu_e, \\quad \\mu_e > 0."
        ) +
        tex(
          "<p>Die Kapazität $\\mu_e$ begrenzt den natürlichen Definitionsbereich. Für $x \\to \\mu_e^-$ divergiert $c_e(x)$. Die Kosten wachsen bei Annäherung an die Kapazitätsgrenze unbeschränkt an. In allen Anwendungen wird nur auf Intervallen $[0, u]$ mit $u < \\mu_e$ gearbeitet.</p>"
        ) +
        "<p><strong>(iv) Kombinationen.</strong></p>" +
        formula(
          "c_e(x) = \\max\\{ p(x),\\, q(x) \\}, \\quad \\text{wobei } p, q \\in \\{(i), (ii), (iii)\\}."
        ) +
        "<p>Es gilt stets der größere der beiden Funktionswerte. So lassen sich unterschiedliche Wachstumsregime auf derselben Kante kombinieren, ohne eine neue Funktionsklasse einzuführen.</p>" +
        "</div>" +
        tex(
          "<p>In <strong>Schritt 7</strong> der Pipeline wird geprüft, unter welchen Parameterbedingungen diese Klassen die hinreichende Bandbedingung aus Schritt 6 erfüllen.</p>"
        ),
    },
    {
      title: "Zu dieser Demonstration",
      html: tex(
        "<p>Das Programm erzeugt Instanzen mit <strong>affinen</strong>, <strong>polynomialen</strong> (nichtnegative Koeffizienten, innerhalb des Programms beschränkt auf Grad 2, in der Theorie beliebig hoher Grad), <strong>exponentiellen</strong>, <strong>M/M/1-Warteschlangen-</strong> und <strong>Max-Kombinations-</strong>Verzögerungen. Diese Formen entsprechen den in der Arbeit untersuchten Klassen (i) bis (iv).</p>" +
          "<p>Über <strong>Weiter</strong> schließt sich <strong>Schritt 2</strong> an: die Relaxierung zum kontinuierlichen Multi-Commodity-Flow-Problem, wie sie im Begleittext (Definition zur Relaxierung) formuliert ist. Topologie und Verzögerungen $c_e$ bleiben dabei unverändert.</p>"
      ),
    },
  ];

  /**
   * Einordnung zu Schritt 2: kontinuierliche Relaxierung (Definition wie in der Bachelorarbeit, Abschnitt zur Relaxierung).
   */
  const PIPELINE_STEP2_SLIDES = [
    {
      title: "Diskret versus relaxiert",
      html:
        tex(
          "<p>Diese Karte führt in die <strong>Relaxierung</strong> ein. Die Animation im Graph macht den <strong>Unterschied</strong> zum diskreten Modell aus Schritt 1 sichtbar. Sie ist dafür <strong>kein</strong> Abbild der späteren Berechnung.</p>"
        ) +
        '<div class="def-box">' +
        tex(
          "<p><strong>Diskret (Schritt 1).</strong> Jede spielende Person $s \\in S$ wählt <strong>genau einen</strong> einfachen Pfad von $p_s$ nach $t_s$. Die volle Einheit läuft auf diesem Pfad. Auf jeder Kante $e$ trägt $s$ entweder den vollen Anteil $1$ oder gar nichts.</p>" +
            "<p><strong>Relaxiert (ab Schritt 2).</strong> Die Nachfrage je spielender Person bleibt <strong>eine Einheit</strong>, darf aber auf <strong>mehrere</strong> $p_s$-$t_s$-Pfade verteilt werden. Statt $0/1$ pro Pfad entstehen nichtnegative Kantenanteile $f_e^s \\geq 0$.</p>"
        ) +
        "</div>" +
        tex(
          "<p>Die Animation wechselt für eine exemplarische spielende Person zwischen beiden Bildern. Im <strong>diskreten</strong> Bild läuft die Ware ungeteilt auf genau einem Pfad. Im <strong>relaxierten</strong> Bild darf sie auf mehrere Pfade aufgeteilt werden. Die Teilströme vereinigen sich am violetten Zielknoten $t_s$ wieder zu <strong>einer</strong> Einheit. Die sichtbare Aufteilung (z. B. zwei Hälften) ist nur ein Beispiel.</p>"
        ),
    },
    {
      title: "Commodities und Kantenanteile",
      html: tex(
        "<p>Alle Spielenden werden jeweils einer <strong>Commodity</strong> mit Nachfrage $1$ von $p_s$ nach $t_s$ zugeordnet.</p>" +
          "<p>Der $s$-Fluss auf Kante $e$ ist der nichtnegative Kantenanteil $f_e^s \\geq 0$. Die <strong>Gesamtlast</strong> auf Kante $e$ ist $f_e = \\sum_{s \\in S} f_e^s$. Im diskreten Spiel sind nur ganzzahlige Lasten zulässig, im relaxierten Modell reelle Zahlen.</p>"
      ),
    },
    {
      title: "Zielfunktion der Relaxierung",
      html:
        "<p>Gesucht wird ein zulässiger Multi-Commodity-Fluss, der die folgende Zielfunktion minimiert:</p>" +
        formula("\\min_{f \\geq 0} \\sum_{e \\in E} \\int_0^{f_e} c_e(\\tau)\\,\\mathrm{d}\\tau") +
        tex(
          "<p>Die Verzögerungsfunktionen $c_e$ sind dieselben wie im diskreten Spiel. Ausgewertet wird bei der Gesamtlast $f_e$ auf der Kante.</p>"
        ),
    },
    {
      title: "Flusserhaltung",
      html:
        tex(
          "<p>Für jedes $s \\in S$ und jeden Knoten $v \\in V$ gelten die <strong>Flusserhaltungsbedingungen</strong> für den $s$-Fluss (Abfluss minus Zufluss am Knoten $v$):</p>"
        ) +
        formula(
          "\\sum_{\\substack{e = (v,u) \\\\ e \\in E}} f_e^s - \\sum_{\\substack{e = (u,v) \\\\ e \\in E}} f_e^s = \\begin{cases} 1 & \\text{falls } v = p_s, \\\\ -1 & \\text{falls } v = t_s, \\\\ 0 & \\text{sonst.} \\end{cases}"
        ) +
        tex(
          "<p>Genau eine Einheit Fluss wird von $p_s$ nach $t_s$ geroutet, aufgeteilt auf Kantenanteile $f_e^s \\geq 0$.</p>"
        ),
    },
    {
      title: "Konvexes Minimierungsproblem",
      html: tex(
        "<p>Die Zielfunktion ist <strong>konvex</strong>, weil jede $c_e$ monoton steigt und das Integral einer monoton steigenden Funktion konvex in der Obergrenze ist. Der zulässige Bereich ist durch <strong>lineare Gleichungen und Ungleichungen</strong> beschrieben (Flusserhaltung und $f_e^s \\geq 0$).</p>" +
          "<p>Daraus folgt: ein Minimierer lässt sich in Polynomialzeit ansteuern (konvexes Optimieren über lineare Nebenbedingungen).</p>"
      ),
    },
    {
      title: "Formulierung abgeschlossen",
      html: tex(
        "<p>Schritt 2 ist damit abgeschlossen: Das diskrete Auslastungsspiel ist als kontinuierliches Multi-Commodity-Flow-Problem mit Integralzielfunktion und Flusserhaltung formuliert. Graph, blaue Startknoten $p_s$, violette Zielknoten $t_s$ und Verzögerungen $c_e$ entsprechen weiterhin der Instanz aus Schritt 1.</p>" +
          "<p>Über <strong>Weiter</strong> beginnt <strong>Schritt 3</strong>. Dort wird das <strong>Wardrop-Gleichgewicht</strong> als Minimierer berechnet und im Graphen als fraktionale Kantenlasten $f_e$ sichtbar.</p>"
      ),
    },
  ];

  /**
   * Einordnung zu Schritt 3: Wardrop-Gleichgewicht und numerischer Minimierer (Begleittext, Abschnitt zu Wardrop).
   */
  const PIPELINE_STEP3_SLIDES = [
    {
      title: "Wardrop-Gleichgewicht",
      html:
        tex(
          "<p>Das <strong>Wardrop-Gleichgewicht</strong> ist das kontinuierliche Analogon zum Nash-Gleichgewicht: statt diskreter Pfadwahl entsteht ein fraktionaler Gleichgewichtszustand auf Kantenlasten $f_e$. Während ein <strong>reines Nash</strong>-Gleichgewicht im asymmetrischen Netzwerkspiel PLS-hart ist, lässt sich ein Wardrop-Gleichgewicht über das konvexe Optimierungsproblem aus Schritt 2 ansteuern.</p>"
        ) +
        tex(
          "<p>Für einen einfachen Pfad $P$ ist die <strong>Pfadverzögerung unter dem Fluss $f$</strong></p>"
        ) +
        formula("d_P(f) = \\sum_{e \\in P} c_e(f_e).") +
        tex(
          "<p>Ein Multi-Commodity-Fluss $f$ heißt Wardrop-Gleichgewicht, wenn für jede Commodity $s \\in S$ und alle Pfade $P_1$, $P_2$ von $p_s$ nach $t_s$ gilt: Liegt auf $P_1$ überall positiver $s$-Fluss auf den Kanten, dann ist</p>"
        ) +
        formula("d_{P_1}(f) \\leq d_{P_2}(f)."),
    },
    {
      title: "Lesart der Bedingung",
      html:
        "<p>Für jede Commodity haben alle <strong>benutzten</strong> Pfade mit positivem Fluss dieselbe (minimale) Pfadverzögerung. Kein <strong>unbenutzter</strong> Pfad bietet eine strikt geringere Verzögerung, sonst wäre eine profitable Umlagerung von Fluss möglich.</p>" +
        "<p>Intuitiv ähnelt dies stark dem <strong>Nash-Gleichgewicht</strong> aus Schritt 1.</p>",
    },
    {
      title: "Minimierer und Äquivalenzsatz",
      html:
        '<div class="def-box"><strong>Satz (Berechenbarkeit, siehe Begleittext).</strong> Jeder Minimierer des konvexen Optimierungsproblems aus Schritt 2 ist ein Wardrop-Gleichgewicht.</div>' +
        tex(
          "<p>Die gesuchte Wardrop-Lösung fällt damit mit einem <strong>Minimierer der Integralzielfunktion</strong> zusammen. Polynomialzeit folgt aus der Konvexität und der linearen zulässigen Menge. Dieser Minimierer dient als Ausgangspunkt für Pfadzerlegung und randomisiertes Runden in den späteren Schritten.</p>"
        ),
    },
    {
      title: "Berechnung starten",
      html:
        "<p>Mit <strong>Weiter</strong> auf dieser Karte startet die numerische Minimierung der Zielfunktion. Zwischenstände können einzeln durchgeklickt werden. <strong>Alle verbleibenden Schritte</strong> springt direkt zum Ergebnis.</p>" +
        tex(
          "<p>Im Graph erscheinen während der Minimierung vorläufige Kantenlasten $f_e$. Nach Abschluss werden Kanten mit $f_e > 0$ <strong>grün</strong> hervorgehoben. In der Beschriftung steht der Kantenname $c_e$ zusammen mit $f_e$. Dies ist weiterhin der <strong>kontinuierliche</strong> Gleichgewichtsfluss. Die Diskretisierung folgt erst in Schritt 4 und 5.</p>"
        ) +
        '<div class="def-box"><strong>Technischer Hinweis (nur Implementierung).</strong> Im Browser wird iterativ angenähert. Intern kommt das Verfahren von Frank und Wolfe auf einer wachsenden Pfadmenge zum Einsatz. Dieses Verfahren gehört nicht zur theoretischen Kette der Arbeit.</div>',
    },
  ];

  /**
   * Schritt 4: Pfadzerlegung (Begleittext, Abschnitt zur Pfadzerlegung).
   */
  const PIPELINE_STEP4_SLIDES = [
    {
      title: "Vom Wardrop-Fluss zu Pfadverteilungen",
      html: tex(
        "<p>Das Wardrop-Gleichgewicht $f$ beschreibt <strong>fraktionale</strong> Kantenflüsse $f_e^s$, noch keine diskrete Wahl eines Pfads pro spielender Person.</p>" +
          "<p>Für das spätere <strong>randomisierte Runden</strong> wird $f$ je Commodity in eine <strong>Wahrscheinlichkeitsverteilung über einfache Pfade</strong> zerlegt, sodass der Erwartungswert der Kantenlast pro spielender Person mit dem $s$-Anteil des Wardrop-Flusses übereinstimmt.</p>" +
          "<p>Im Graph markieren <strong>grüne</strong> Kanten den Wardrop-Fluss mit $f_e > 0$. <strong>Orange</strong> Kanten ohne Fluss gehören noch zur Topologie, werden für die Zerlegung aber nicht benötigt. Ab der nächsten Karte werden sie ausgeblendet. Pfadzerlegung und weiterer Verlauf beziehen sich ausschließlich auf den grünen Teilgraphen.</p>"
      ),
    },
    {
      title: "Iterative Zerlegung",
      html:
        tex(
          "<p>Ausgangspunkt sind die Restmengen $f_e^s$ des Wardrop-Flusses auf dem grünen Teilgraphen. Die Zerlegung <strong>entleert</strong> diese Restmengen schrittweise: In jedem Durchlauf wird ein einfacher Pfad extrahiert und mit einem Gewicht in die Liste $\\mathcal{D}_s$ übernommen.</p>"
        ) +
        '<div class="def-box"><strong>Algorithmus (je Durchlauf):</strong><br>' +
        tex(
          "(1) Die Kante $e$ mit dem <strong>kleinsten</strong> noch positiven $s$-Fluss wird gewählt (über alle Commodities hinweg).<br>" +
            "(2) Ein Pfad $P$ vom Startknoten zum Zielknoten wird bestimmt, der $e$ enthält und nur Kanten mit positivem $s$-Restfluss nutzt.<br>" +
            "(3) $P$ wird in $\\mathcal{D}_s$ gespeichert. Das Gewicht ist $f_P^s = f_e^s$ auf der gewählten Kante.<br>" +
            "(4) Von allen Kanten auf $P$ wird genau $f_e^s$ subtrahiert. Ist danach kein positiver $s$-Fluss mehr vorhanden, ist die Commodity fertig."
        ) +
        "</div>" +
        tex(
          "<p>Die Wahl der <strong>kleinsten</strong> Kante verhindert negative Restflüsse und sichert $\\sum_{P \\in \\mathcal{D}_s} f_P^s = 1$ für jede Commodity $s$. Jeder extrahierte Pfad ist einfach, da der Wardrop-Fluss kreisfrei ist.</p>" +
            "<p><strong>Wozu das dient:</strong> Erst die Liste $\\mathcal{D}_s$ mit Gewichten $f_P^s$ macht aus dem fraktionalen Fluss eine <strong>explizite Wahrscheinlichkeitsverteilung über konkrete Pfade</strong>. Die Wahrscheinlichkeit, eine Kante $e$ zu benutzen, bleibt dabei $f_e^s$.</p>" +
            "<p><strong>Anschluss:</strong> Im nächsten Schritt wird je Commodity <strong>unabhängig ein Pfad</strong> gemäß dieser Verteilung gezogen. So entsteht wieder ein diskretes Profil mit Kantenlasten $n_{\\sigma}(e) \\in \\mathbb{N}$, dessen Erwartung mit dem Wardrop-Fluss übereinstimmt.</p>" +
            "<p>Mit <strong>Weiter</strong> wird die Zerlegung für das aktuelle Netzwerk berechnet. Jeder Extraktionsschritt lässt sich anschließend einzeln im Graphen nachverfolgen.</p>"
        ),
    },
  ];

  /**
   * Schritt 5: Randomisiertes Runden und Chernoff-Konzentration.
   * Karte PIPELINE_STEP5_ROUND_SLIDE startet die schrittweise Pfadwahl im Graph;
   * ab PIPELINE_STEP5_CHERNOFF_SLIDE Histogramm statt Graph.
   */
  const PIPELINE_STEP5_ROUND_SLIDE = 0;
  const PIPELINE_STEP5_CHERNOFF_SLIDE = 1;
  /** Ab dieser Karte: Graph statt Chernoff-Histogramm (Erfolgswahrscheinlichkeit). */
  const PIPELINE_STEP5_SUCCESS_SLIDE = 5;

  const PIPELINE_STEP5_SLIDES = [
    {
      title: "Randomisiertes Runden",
      html: tex(
        "<p>Aus Schritt 4 liegt für jede Commodity $s$ eine Pfadmenge $\\mathcal{D}_s$ mit Gewichten $f_P^s$ vor, die eine <strong>Wahrscheinlichkeitsverteilung</strong> bilden ($\\sum_{P \\in \\mathcal{D}_s} f_P^s = 1$). Nun wird <strong>unabhängig</strong> je Commodity ein Pfad $P \\in \\mathcal{D}_s$ gezogen. Jeder Pfad tritt mit Wahrscheinlichkeit <strong>$f_P^s$</strong> auf, also proportional zu seinem Gewicht aus der Zerlegung.</p>" +
          "<p>Dadurch entsteht wieder ein <strong>diskretes</strong> Profil mit Kantenlasten in den <strong>natürlichen Zahlen</strong>, $n_{\\sigma}(e) \\in \\mathbb{N}$. Im Erwartungswert stimmen diese Lasten mit dem Wardrop-Fluss überein. Die konkrete Ziehung ist zufällig. Mit <strong>Weiter</strong> beginnt die Ziehung im Graph: jede Commodity wird nacheinander eingefärbt. Bereits gezogene Pfade bleiben sichtbar, die aktuelle Ziehung wird stärker hervorgehoben. <strong>Alle verbleibenden Schritte</strong> zieht alle Ziehungen auf einmal.</p>"
      ),
    },
    {
      title: "Wie zufällig ist das gerundete Profil?",
      html:
        tex(
          "<p>Das Runden liefert eine <strong>zufällige</strong> Strategiekombination $\\sigma$. Nach <strong>einer</strong> konkreten Ziehung liegt eine <strong>feste</strong> Strategiekombination vor. Auf Kante $e$ ist die Last $n_{\\sigma}(e) \\in \\mathbb{N}$ fest (im Graphen sichtbar). In der Analyse wird $N_e := n_{\\sigma}(e)$ als <strong>Zufallsvariable</strong> über alle möglichen Ziehungen gefasst: Jede spielende Person entscheidet unabhängig, ob der gezogene Pfad über $e$ führt. $N_e$ ist damit eine Summe unabhängiger Ja/Nein-Entscheidungen.</p>" +
            "<p>Vor dem Runden war der Wardrop-Fluss $f_e$ auf Kante $e$ deterministisch bekannt (fraktional). Der <strong>Erwartungswert</strong> der gerundeten Last stimmt mit diesem Fluss überein. Im Mittel trifft das Runden die kontinuierliche Lösung exakt.</p>"
        ) +
        formula("\\mathbb{E}[N_e] = \\sum_s f_e^s = f_e"),
    },
    {
      title: "Chernoff: die Last bleibt nah am Erwartungswert",
      html: tex(
        "<p>Eine Summe vieler unabhängiger Ja/Nein-Entscheidungen streut nur wenig um ihren Erwartungswert. Diese Tatsache heißt <strong>Konzentration</strong> und wird durch die <strong>Chernoff-Schranken</strong> quantifiziert: Die Wahrscheinlichkeit einer großen Abweichung von $f_e$ fällt <strong>exponentiell</strong>.</p>" +
          "<p>Rechts ist die Verteilung von $N_e$ für eine Beispielkante gezeichnet. Die Balken häufen sich um den Erwartungswert $f_e$ (orange Linie). Je mehr Spielende beteiligt sind, desto schmaler wird diese Glocke im Verhältnis zu $f_e$.</p>"
      ),
    },
    {
      title: "Ein Intervall, das fast immer hält",
      html:
        tex(
          "<p>Aus den Chernoff-Schranken ergibt sich um jede Kante ein <strong>Konzentrationsintervall</strong> $[l_e, u_e]$ (rechts blau hinterlegt), in dem $N_e$ mit hoher Wahrscheinlichkeit landet.</p>"
        ) +
        formula(
          "\\begin{aligned} l_e &= f_e - \\sqrt{3 \\ln(4m) \\cdot f_e} \\\\ u_e &= \\max\\{ 6 \\ln(4m), f_e + \\sqrt{3 \\ln(4m) \\cdot f_e} \\} \\end{aligned}"
        ) +
        tex(
          "<p>Für eine einzelne Kante liegt $N_e$ mit Wahrscheinlichkeit mindestens $1 - 1/(2m)$ in diesem Intervall. Über alle $m$ Kanten zusammen bleibt nach der Union-Schranke mit Wahrscheinlichkeit mindestens $\\frac{1}{2}$ jede Last in ihrem Intervall.</p>"
        ),
    },
    {
      title: "Konzentration genügt noch nicht",
      html: tex(
        "<p>Die Chernoff-Schranken sichern: Die Last bleibt nah an $f_e$. Daraus folgt aber noch <strong>nicht</strong> automatisch ein $\\varepsilon$-approximiertes Nash-Gleichgewicht.</p>" +
          "<p>Entscheidend sind die <strong>Kosten</strong>, und die hängen über die Verzögerungsfunktion $c_e$ von der Last ab. Bleibt die Last nah an $f_e$, dürfen sich auch die Kosten $c_e(N_e)$ nur wenig von $c_e(f_e)$ unterscheiden. Die Bandbedingung dazu ist Inhalt von <strong>Schritt 6</strong>. Zuvor wird hier noch die <strong>Erfolgswahrscheinlichkeit</strong> eines Runden-Versuchs und die praktische Wiederholung erläutert.</p>"
      ),
    },
    {
      title: "Mindestens 50 % Erfolg pro Versuch",
      html:
        tex(
          "<p>Liegen nach <strong>einem</strong> Runden-Versuch für <strong>alle</strong> Kanten $e$ die gerundeten Lasten im Intervall $N_e \\in [l_e, u_e]$, so sind die Voraussetzungen des Schlüssellemmas erfüllt (zusammen mit der Bandbedingung an $c_e$ aus Schritt 6). Dann ist die Strategiekombination $\\sigma$ ein $\\varepsilon$-approximiertes Nash-Gleichgewicht.</p>"
        ) +
        '<div class="def-box">' +
        tex(
          "<strong>Schritt 3 im Beweis (Union-Schranke).</strong> Pro Kante liegt $N_e$ mit Wahrscheinlichkeit mindestens $1 - 1/(2m)$ im Intervall. Über alle $m$ Kanten gleichzeitig gilt deshalb $\\Pr[\\forall e:\\, N_e \\in [l_e, u_e]] \\geq \\tfrac{1}{2}$. Die tatsächliche Erfolgswahrscheinlichkeit kann höher sein. Der Wert $\\tfrac{1}{2}$ ist nur die vom Beweis garantierte untere Schranke."
        ) +
        "</div>" +
        tex(
          "<p>Im Graphen ist das Ergebnis der konkreten Ziehung aus Schritt 5 sichtbar. Die vollständige $\\varepsilon$-Garantie verknüpft diese Intervalle mit der Bandbedingung aus <strong>Schritt 6</strong> und den Parameteranforderungen aus <strong>Schritt 7</strong>. Die abschließende Prüfung erfolgt am Ende der Pipeline.</p>"
        ),
    },
    {
      title: "Wiederholen bis alle Lasten im Intervall liegen",
      html:
        tex(
          "<p>Ein einzelner Versuch kann scheitern, obwohl die Erfolgswahrscheinlichkeit mindestens $\\tfrac{1}{2}$ beträgt. Für die Aussage <em>mit hoher Wahrscheinlichkeit</em> aus dem Satz wird das Runden deshalb $k$-mal <strong>unabhängig</strong> wiederholt. Die Fehlerwahrscheinlichkeit sinkt auf höchstens $2^{-k}$.</p>" +
            "<p>Praktisch genügt folgendes Verfahren: Nach jedem Versuch wird geprüft, ob für alle Kanten $N_e \\in [l_e, u_e]$ gilt. Liegt ein Erfolg vor, ist $\\sigma$ unter den Satzvoraussetzungen ein $\\varepsilon$-approximiertes Nash-Gleichgewicht. Sonst wird mit derselben Pfadzerlegung erneut gewürfelt und erneut geprüft.</p>" +
            "<p>Mit <strong>Weiter</strong> folgt <strong>Schritt 6</strong>, die hinreichende Bedingung an die Verzögerungsfunktionen.</p>"
        ),
    },
  ];

  /**
   * Schritt 6: Die hinreichende Bedingung an die Verzögerungsfunktionen.
   * Visualisierung: c_e als Funktionsplot mit Intervall [l_e,u_e] und Toleranzband.
   */
  const PIPELINE_STEP6_SLIDES = [
    {
      title: "Das verbleibende Problem",
      html: tex(
        "<p>Angenommen, die Last $N_e$ liegt wie versprochen nah am Wardrop-Fluss $f_e$. Ob das gerundete Profil stabil ist, entscheidet die <strong>Verzögerungsfunktion</strong> $c_e$.</p>" +
          "<p>Ist $c_e$ in der Umgebung von $f_e$ nahezu flach, so ändern kleine Lastschwankungen die Kosten kaum. Steigt $c_e$ dort dagegen <strong>steil</strong> an, kann schon eine winzige Abweichung die Kosten stark verändern und zum Strategiewechsel verleiten.</p>" +
          "<p>Rechts ist eine <strong>illustrative Skizze</strong> einer Verzögerungsfunktion mit Konzentrationsintervall $[l_e, u_e]$ um $f_e$. Es handelt sich nicht um eine konkrete Kante der Instanz.</p>"
      ),
    },
    {
      title: "Die hinreichende Bedingung",
      html:
        tex(
          "<p>Die Idee wird zu einer präzisen Forderung: Auf dem Intervall $[l_e, u_e]$ darf $c_e$ nur innerhalb eines schmalen <strong>Toleranzbands</strong> um $c_e(f_e)$ liegen.</p>"
        ) +
        formula(
          "\\frac{c_e(f_e)}{\\sqrt{1+\\varepsilon}} \\leq c_e(x) \\leq \\sqrt{1+\\varepsilon} \\cdot c_e(f_e)"
        ) +
        "<p>Rechts ist dieses Band grün eingezeichnet. Verläuft die Kurve auf dem ganzen Intervall innerhalb des Bands, ist die Bedingung für diese Kante erfüllt.</p>",
    },
    {
      title: "Vom Band zum ε-Nash (Schlüssellemma)",
      html:
        tex(
          "<p>Erfüllt <strong>jede</strong> Kante diese Bandbedingung und liegt jede Last in ihrem Intervall, dann ist das gerundete Profil ein <strong>$\\varepsilon$-approximiertes Nash-Gleichgewicht</strong>.</p>"
        ) +
        '<div class="def-box">' +
        tex(
          "<strong>Schlüssellemma (Approximationsgarantie).</strong> Liegt $N_e \\in [l_e, u_e]$ und gilt dort die Bandbedingung für alle Kanten, so ist $\\sigma$ ein $\\varepsilon$-approximiertes Nash-Gleichgewicht."
        ) +
        "</div>" +
        tex(
          "<p>Anschaulich zerfällt der Faktor $(1+\\varepsilon)$ multiplikativ in zwei gleiche Faktoren $\\sqrt{1+\\varepsilon}$: Die Kosten auf dem eigenen Pfad steigen höchstens um $\\sqrt{1+\\varepsilon}$, die einer Alternative sinken höchstens um $\\sqrt{1+\\varepsilon}$. Das Produkt beider Faktoren ergibt genau den Spielraum $(1+\\varepsilon)$.</p>"
        ),
    },
    {
      title: "Wenn die Bedingung verletzt wird",
      html:
        "<p>Zum Vergleich rechts eine <strong>illustrative, zu steile</strong> Verzögerungsfunktion auf demselben Intervall. Die Kurve verlässt das Toleranzband, die Bedingung ist <strong>verletzt</strong>.</p>" +
        "<p>Genau solche künstlich steilen Funktionen zeigen, dass selbst approximierte Gleichgewichte im Allgemeinen PLS-hart bleiben können. Die Bedingung grenzt also die <strong>gutartigen</strong> Verzögerungen ab, für die das Verfahren funktioniert.</p>" +
        "<p>Welche üblichen Funktionsklassen die Bedingung erfüllen, zeigt <strong>Schritt 7</strong>.</p>",
    },
  ];

  /**
   * Schritt 7: Funktionsklassen, die die Bedingung erfüllen.
   * Visualisierung: idealisierte Plots je Klasse mit Band und Intervall.
   * Letzte Karte erklärt didaktisch die hohe Erfolgswahrscheinlichkeit; davor startet der Intervall-Checker.
   */
  const PIPELINE_STEP7_CHECKER_SLIDE = 6;
  const PIPELINE_STEP7_WHY_SUCCESS_SLIDE = 7;

  const PIPELINE_STEP7_SLIDES = [
    {
      title: "Für welche Verzögerungen funktioniert es?",
      html:
        "<p>Die Bandbedingung aus Schritt 6 ist die <strong>zentrale Schnittstelle</strong> der Arbeit: Eine Funktionsklasse ist genau dann zulässig, wenn ihre Vertreter das Toleranzband auf dem relevanten Intervall einhalten.</p>" +
        "<p>In den nächsten Karten wird das für die <strong>natürlichen</strong> Funktionsklassen geprüft, die in realen Netzwerken vorkommen: Polynome, Exponentialfunktionen, Warteschlangen-Verzögerungen und deren Kombinationen.</p>",
    },
    {
      title: "Polynome mit nichtnegativen Koeffizienten",
      html:
        tex(
          "<p>Polynome vom Grad $g$ mit nichtnegativen Koeffizienten $c_e(x) = a_0 + a_1 x + \\cdots + a_g x^g$ modellieren polynomial wachsende Verzögerung. Sie erfüllen die Bedingung auf <strong>ganz</strong> $\\mathbb{R}_{\\geq 0}$, sofern der <strong>konstante Term $a_0$</strong> (die Grundverzögerung) groß genug gegenüber den übrigen Koeffizienten ist:</p>"
        ) +
        formula("a_0 \\gtrsim \\frac{(\\ln m)^g}{\\varepsilon^{2g+1}} \\cdot \\sum_{j \\geq 1} a_j") +
        tex(
          "<p>Für eine <strong>lineare</strong> Verzögerung ($g = 1$) bedeutet das $a_0 \\in \\Omega(a_1 \\cdot \\ln m)$. Höhere Grade verschärfen die Anforderung sowohl im $\\ln m$- als auch im $1/\\varepsilon$-Faktor.</p>" +
            "<p>Anschaulich: Eine spürbare Grundverzögerung glättet die Kurve im relevanten Bereich. In realen Netzen ist das oft erfüllt, da die Ausbreitungsverzögerung die Stauverzögerung dominiert.</p>"
        ),
    },
    {
      title: "Exponentialfunktionen",
      html:
        tex(
          "<p>Funktionen $c_e(x) = \\alpha \\cdot e^{x/\\beta} + \\gamma$ wachsen schneller als jedes Polynom. Global lässt sich das Band nicht halten, aber nur das <strong>beschränkte</strong> Intervall $[0, u_e]$ zählt.</p>"
        ) +
        formula(
          "\\beta \\geq \\frac{2\\sqrt{6 \\ln(4m) \\cdot u_e}}{\\ln(1+\\varepsilon)} \\in \\Omega\\!\\left(\\frac{\\sqrt{\\ln m \\cdot u_e}}{\\varepsilon}\\right)"
        ) +
        tex(
          "<p>Solange der Wachstumsparameter $\\beta$ groß genug ist, verläuft die Funktion auf dem relevanten Intervall flach genug. Das exponentielle Regime setzt dann erst jenseits des typischen Auslastungsbereichs ein.</p>"
        ),
    },
    {
      title: "Warteschlangen-Verzögerung (M/M/1)",
      html:
        tex(
          "<p>Das M/M/1-Modell liefert $c_e(x) = 1/(\\mu_e - x)$: Die Verzögerung explodiert, wenn die Last $x$ gegen die Kapazität $\\mu_e$ strebt.</p>"
        ) +
        formula(
          "\\mu_e \\geq u_e + \\frac{\\sqrt{6 \\ln(4m) \\cdot u_e}}{\\sqrt{1+\\varepsilon} - 1} \\in \\Omega\\!\\left(u_e + \\frac{\\sqrt{\\ln m \\cdot u_e}}{\\varepsilon}\\right)"
        ) +
        "<p>Die Bedingung verlangt einen <strong>Sicherheitsabstand</strong> zwischen Auslastung und Kapazität. Das entspricht dem Designprinzip, einen Link nie bis an die Kapazitätsgrenze zu belasten.</p>",
    },
    {
      title: "Kombinationen: punktweises Maximum",
      html: tex(
        "<p>Reale Links zeigen oft mehrere Regime: erst flach, dann steil. Das wird durch das <strong>punktweise Maximum</strong> $c_e(x) = \\max\\{ p(x), q(x) \\}$ modelliert.</p>" +
          "<p>Erfüllen beide Komponenten die Bedingung einzeln, so erfüllt auch ihr Maximum die Bedingung. Damit lassen sich Polynome, Exponential- und Warteschlangenanteile <strong>modular</strong> zu einer zulässigen Verzögerung zusammensetzen.</p>" +
          "<p>Rechts: eine <strong>illustrative Skizze</strong> mit flachem Polynomanteil (blau) und exponentiellem Anteil (violett). Die effektive Verzögerung (schwarz) ist ihr Maximum. Es handelt sich nicht um eine konkrete Kante der Instanz.</p>"
      ),
    },
    {
      title: "Zusammenfassung der Pipeline",
      html: tex(
        "<p>Der rote Faden in einem Satz: Das exakte Gleichgewicht ist zu schwer (PLS-hart), also wird <strong>relaxiert</strong> (Wardrop-Gleichgewicht), die Lösung in Pfadverteilungen <strong>zerlegt</strong>, daraus zufällig ein Profil <strong>gerundet</strong>, und mit <strong>Chernoff</strong> plus <strong>Bandbedingung</strong> gezeigt, dass dieses Profil mit hoher Wahrscheinlichkeit $\\varepsilon$-stabil ist.</p>" +
          "<p>Für Polynome, Exponential- und M/M/1-Funktionen sowie deren Maxima ist die Bedingung unter bestimmten Parameteranforderungen erfüllt. Auf der nächsten Karte wird geprüft, ob die konkrete gerundete Instanz die Intervallbedingung erfüllt und damit ein $\\varepsilon$-approximiertes Nash-Gleichgewicht liefert.</p>"
      ),
    },
    {
      title: "ε-Nash-Gleichgewicht prüfen",
      html: tex(
        "<p>Nun sind die Bausteine bekannt: Chernoff-Konzentration (Schritt 5), die Bandbedingung (Schritt 6) und die Parameteranforderungen der Funktionsklassen (Schritt 7). Unter diesen Voraussetzungen liefert das Schlüssellemma die $\\varepsilon$-Approximation.</p>" +
          "<p>Unten wird für die gerundete Strategiekombination aus Schritt 5 geprüft, ob alle Kantenlasten in den Konzentrationsintervallen $[l_e, u_e]$ liegen. Erfüllt die Demo-Instanz zusätzlich die Band- und Parameterbedingungen, liegt ein $\\varepsilon$-approximiertes Nash-Gleichgewicht vor. Bei Misserfolg kann per <strong>Neu runden</strong> ein weiterer unabhängiger Versuch gezogen werden. Nach erfolgreicher Prüfung folgt mit <strong>Weiter</strong> die Erläuterung, warum die Demo in der Praxis fast immer erfolgreich ist.</p>"
      ),
    },
    {
      title: "Warum die Demo fast immer erfolgreich ist",
      html:
        tex(
          "<p>Schritt 5 hat gezeigt: Der Beweis garantiert pro Runden-Versuch eine Erfolgswahrscheinlichkeit von <strong>mindestens</strong> $\\tfrac{1}{2}$. In der Demo scheitert ein Versuch aber fast nie. Das liegt nicht an einem Fehler im Beweis, sondern daran, dass die garantierte Schranke sehr vorsichtig konstruiert ist und typische Instanzen deutlich mehr Spielraum bieten als der vom Beweis betrachtete Grenzfall.</p>"
        ) +
        '<div class="def-box">' +
        tex(
          "<strong>Viele Kanten tragen wenig Last.</strong> Der Wardrop-Fluss konzentriert sich auf wenige Routen. Auf den übrigen Kanten ist $f_e$ klein oder null. Dort sind die Konzentrationsintervalle aus Schritt 5 besonders breit: Eine zu kleine Last ist ohnehin unmöglich, weil $N_e \\geq 0$ gilt. Die obere Schranke ist für alle schwach belasteten Kanten dieselbe moderate Größe $6\\ln(4m)$, die nur von der Kantenzahl abhängt."
        ) +
        "</div>" +
        '<div class="def-box">' +
        tex(
          "<strong>Wenige Spielende im Vergleich zur Obergrenze.</strong> Jede spielende Person nutzt jede Kante höchstens einmal. Die gerundete Last $N_e$ kann deshalb höchstens $n$ erreichen. In kleinen Demo-Instanzen liegt $n$ oft unter der festen Obergrenze $6\\ln(4m)$. Dann kann $N_e > u_e$ auf keiner Kante eintreten, unabhängig vom Ausgang der Ziehung."
        ) +
        "</div>" +
        '<div class="def-box">' +
        tex(
          "<strong>Starke Kanten haben breite Sicherheitszonen.</strong> Wo viel Fluss liegt, wächst das Konzentrationsintervall schneller als die übliche Schwankung der Last um $f_e$. Die Intervalle aus Schritt 5 lassen deshalb auf stark belasteten Kanten viel Spielraum. Ein Ausreißer außerhalb des Intervalls wäre ungewöhnlich, auch wenn der Beweis dafür nur eine sehr konservative Einzelschranke von $\\tfrac{1}{2m}$ pro Kante verwendet."
        ) +
        "</div>" +
        tex(
          "<p>Zusätzlich werden im Beweis die Fehlerwahrscheinlichkeiten aller $m$ Kanten pauschal addiert (Union-Schranke aus Schritt 5), obwohl die Ziehungen gemeinsam erfolgen. In Summe erklären diese Effekte, warum ein einzelner Versuch in der Demo meist sofort erfolgreich ist.</p>" +
            "<p>Über <strong>Pipeline abbrechen</strong> (oder Escape) endet die Tour. Über <strong>Zufallsnetz</strong> oder <strong>Instanz bearbeiten</strong> lässt sich ein neues Beispiel ausprobieren.</p>"
        ),
    },
  ];

  function currentPipelineSlides() {
    if (pipelineAsideStep === 1) return PIPELINE_STEP1_SLIDES;
    if (pipelineAsideStep === 2) return PIPELINE_STEP2_SLIDES;
    if (pipelineAsideStep === 3) return PIPELINE_STEP3_SLIDES;
    if (pipelineAsideStep === 4) return PIPELINE_STEP4_SLIDES;
    if (pipelineAsideStep === 5) return PIPELINE_STEP5_SLIDES;
    if (pipelineAsideStep === 6) return PIPELINE_STEP6_SLIDES;
    return PIPELINE_STEP7_SLIDES;
  }

  const PIPELINE_LAST_STEP = 7;

  function playerCountPhrase() {
    const k = G.commodities.length;
    if (k <= 0) return "In der Instanz sind noch keine Spielenden eingetragen.";
    if (k === 1) return "In der Instanz ist <strong>1 spielende Person</strong> eingetragen.";
    return "In der Instanz sind <strong>" + k + " Spielende</strong> eingetragen.";
  }

  function recommendedPlayerCountForPipelineStep() {
    if (pipelineAsideStep >= 5) {
      if (
        pipelineAsideStep === 5 &&
        pipelineIntroSlide < PIPELINE_STEP5_CHERNOFF_SLIDE
      )
        return 4;
      return 200;
    }
    return 4;
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Wählt bis zu poolSize verschiedene Start- und Zielknoten aus dem linken bzw. rechten
   * Graphbereich; es werden nur Paare gezählt, die keinen direkten Kantenverbund haben.
   */
  function pickEndpointPool(nodes, nCount, seen, poolSize) {
    const band = Math.max(
      MAX_DISTINCT_ENDPOINTS,
      Math.max(2, Math.floor(nCount / 3))
    );
    const srcCandidates = [];
    for (let si = 0; si < band && si < nCount; si++) srcCandidates.push(si);
    const sinkCandidates = [];
    for (let j = 0; j < band && j < nCount; j++) sinkCandidates.push(nCount - 1 - j);

    function countValidPairs(srcIdx, sinkIdx) {
      let n = 0;
      for (let a = 0; a < srcIdx.length; a++) {
        for (let b = 0; b < sinkIdx.length; b++) {
          const si = srcIdx[a];
          const ti = sinkIdx[b];
          if (si >= ti - 2) continue;
          if (seen.has(directEdgeKey(nodes[si].id, nodes[ti].id))) continue;
          n++;
        }
      }
      return n;
    }

    let best = null;
    for (let attempt = 0; attempt < 48; attempt++) {
      const srcPick = shuffleInPlace(srcCandidates.slice()).slice(
        0,
        Math.min(poolSize, srcCandidates.length)
      );
      const sinkPick = shuffleInPlace(sinkCandidates.slice()).slice(
        0,
        Math.min(poolSize, sinkCandidates.length)
      );
      const valid = countValidPairs(srcPick, sinkPick);
      const entry = {
        sources: srcPick.map((si) => nodes[si].id),
        sinks: sinkPick.map((ti) => nodes[ti].id),
        srcIndices: srcPick,
        sinkIndices: sinkPick,
        validPairs: valid,
      };
      if (valid >= Math.min(poolSize, poolSize * poolSize)) {
        return entry;
      }
      if (!best || valid > best.validPairs) best = entry;
    }
    return best;
  }

  /**
   * Ordnet Spielenden Start-/Zielknoten zu: mindestens so viele verschiedene Endpunkte
   * wie Spielende (bis maximal drei), möglichst wenig identische OD-Paare.
   */
  function assignCommodityEndpointPairs(sourceIds, sinkIds, playerCount) {
    const n = Math.max(1, Math.round(playerCount));
    const activeSize = Math.min(
      Math.max(n, 1),
      MAX_DISTINCT_ENDPOINTS,
      sourceIds.length,
      sinkIds.length
    );
    const src = sourceIds.slice(0, activeSize);
    const snk = sinkIds.slice(0, activeSize);
    const order = [];
    const used = new Set();

    for (let i = 0; i < activeSize; i++) {
      const key = src[i] + "|" + snk[i];
      if (used.has(key)) continue;
      used.add(key);
      order.push({ sourceId: src[i], sinkId: snk[i] });
    }
    for (let i = 0; i < src.length; i++) {
      for (let j = 0; j < snk.length; j++) {
        const key = src[i] + "|" + snk[j];
        if (used.has(key)) continue;
        used.add(key);
        order.push({ sourceId: src[i], sinkId: snk[j] });
      }
    }

    const out = [];
    for (let p = 0; p < n; p++) {
      const pair = order[p % order.length];
      out.push({ sourceId: pair.sourceId, sinkId: pair.sinkId });
    }
    return out;
  }

  function buildCommoditiesFromBlueprints(count) {
    const n = Math.max(1, Math.min(Math.round(count), DEMO_COMMODITY_MAX));
    if (randomNetworkEndpointPool) {
      const pairs = assignCommodityEndpointPairs(
        randomNetworkEndpointPool.sources,
        randomNetworkEndpointPool.sinks,
        n
      );
      return pairs.map(function (p, i) {
        return {
          id: "c" + (i + 1),
          sourceId: p.sourceId,
          sinkId: p.sinkId,
        };
      });
    }
    if (!randomNetworkBlueprints || !randomNetworkBlueprints.length) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const bp = randomNetworkBlueprints[i % randomNetworkBlueprints.length];
      out.push({
        id: "c" + (i + 1),
        sourceId: bp.sourceId,
        sinkId: bp.sinkId,
      });
    }
    return out;
  }

  function refreshRandomNetworkBlueprintsFromPool(count) {
    if (!randomNetworkEndpointPool) return;
    randomNetworkBlueprints = assignCommodityEndpointPairs(
      randomNetworkEndpointPool.sources,
      randomNetworkEndpointPool.sinks,
      count
    ).map(function (p) {
      return { sourceId: p.sourceId, sinkId: p.sinkId };
    });
  }

  /** Übernimmt Start- und Zielknoten und die aktive Anzahl der Spielenden aus dem Instanz-Editor in die Blueprints. */
  function syncRandomNetworkBlueprintsFromInstance() {
    if (!isRandomNetworkInstance) return;
    if (!G.commodities.length) return;
    if (randomNetworkEndpointPool) {
      refreshRandomNetworkBlueprintsFromPool(G.commodities.length);
      G.commodities.forEach(function (c, i) {
        if (i < randomNetworkBlueprints.length) {
          randomNetworkBlueprints[i] = {
            sourceId: c.sourceId,
            sinkId: c.sinkId,
          };
        }
      });
      return;
    }
    if (!randomNetworkBlueprints) return;
    G.commodities.forEach(function (c, i) {
      if (i < randomNetworkBlueprints.length) {
        randomNetworkBlueprints[i] = {
          sourceId: c.sourceId,
          sinkId: c.sinkId,
        };
      }
    });
  }

  function setPlayerCountControlBusy(busy) {
    ["graph-player-count-control", "instance-player-count-control"].forEach(function (id) {
      const root = document.getElementById(id);
      if (root) root.classList.toggle("is-busy", !!busy);
    });
    const busyIds = ["graph-player-count-busy", "instance-player-count-busy"];
    busyIds.forEach(function (id) {
      const busyEl = document.getElementById(id);
      if (busyEl) busyEl.hidden = !busy;
    });
  }

  function syncPlayerCountControlInputs(count) {
    const max = DEMO_COMMODITY_MAX;
    [
      ["graph-player-count-range", "graph-player-count-input"],
      ["instance-player-count-range", "instance-player-count-input"],
    ].forEach(function (pair) {
      const range = document.getElementById(pair[0]);
      const input = document.getElementById(pair[1]);
      if (range) {
        range.min = "1";
        range.max = String(max);
        range.value = String(count);
      }
      if (input) {
        input.min = "1";
        input.max = String(max);
        input.value = String(count);
      }
    });
    const rec = document.getElementById("graph-player-count-recommended");
    if (rec) {
      const recommended = recommendedPlayerCountForPipelineStep();
      rec.textContent =
        "Empfohlen für diesen Schritt: " +
        recommended +
        (recommended === 1 ? " spielende Person" : " Spielende");
    }
    const instHint = document.getElementById("instance-player-count-hint");
    if (instHint) {
      instHint.textContent =
        "Vorbereitet im Zufallsnetz: bis zu " +
        max +
        " Paare spielender Personen (Startknoten und Zielknoten).";
    }
  }

  function shouldShowPlayerCountControl() {
    return (
      pipelineLocked &&
      isRandomNetworkInstance &&
      (!!randomNetworkBlueprints || !!randomNetworkEndpointPool)
    );
  }

  function shouldShowInstancePlayerCountControl() {
    return isRandomNetworkInstance && (!!randomNetworkBlueprints || !!randomNetworkEndpointPool);
  }

  function updateInstancePlayerCountControl() {
    const root = document.getElementById("instance-player-count-control");
    const addBtn = document.getElementById("btn-add-commodity");
    const showSlider = shouldShowInstancePlayerCountControl();
    if (root) root.hidden = !showSlider;
    if (addBtn) addBtn.hidden = showSlider;
    if (showSlider) {
      syncPlayerCountControlInputs(G.commodities.length);
      if (!playerCountControlWired) wirePlayerCountControl();
    }
  }

  function updateGraphPlayerCountControl() {
    const root = document.getElementById("graph-player-count-control");
    if (!root) return;
    const show = shouldShowPlayerCountControl();
    root.hidden = !show;
    if (!show) {
      if (!document.getElementById("instance-modal")?.classList.contains("open")) {
        setPlayerCountControlBusy(false);
      }
      return;
    }
    syncPlayerCountControlInputs(G.commodities.length);
    if (!playerCountControlWired) wirePlayerCountControl();
  }

  function recomputePipelineAfterPlayerCountChange(ctx) {
    ctx = ctx || {};
    const prevFwIdx = pipelineFwIdx;
    const prevFwLen = pipelineWardropTrace ? pipelineWardropTrace.length : 0;
    const prevDecompReveal = pipelineDecompReveal;
    const prevRoundRevealed = pipelineRoundRevealed;
    const wasRoundInteractive = pipelineInteractive === "round";
    const wasIntervalCheck = pipelineInteractive === "interval_check";
    const hadRounded = !!ctx.hadRounded;
    const hadPastRound = !!ctx.hadPastRound;
    const wasOnCheckerSlide = !!ctx.wasOnCheckerSlide;

    const wardropNeeded =
      pipelineWardropCompleted ||
      !!pipeline.wardrop ||
      pipelineAsideStep >= 3 ||
      currentStep >= 3;

    if (!wardropNeeded) {
      pipeline.wardrop = null;
      pipeline.decomp = null;
      pipeline.rounded = null;
      pipeline.stepDone = pipeline.stepDone.map(() => false);
      pipelineWardropCompleted = false;
      pipelineRoundSteps = null;
      pipelineRoundChosen = null;
      pipelineRoundRevealed = 0;
      pipelineRoundActive = false;
      if (pipelineInteractive === "wardrop_fw" || pipelineInteractive === "wardrop_done") {
        resetPipelineInteractiveState();
      }
      refreshWardropValidationPreview();
      return;
    }

    const res = P.computeWardrop(G.nodes, G.edges, G.commodities, {
      recordIterationTrace: true,
    });
    if (!res.ok) {
      logLine("Wardrop-Fehler nach Anpassung der Anzahl Spielender: " + res.msg);
      return;
    }
    pipeline.wardrop = res;
    wardropValidationPreview = res;
    pipeline.stepDone[1] = true;
    pipeline.stepDone[2] = true;
    pipelineWardropCompleted = true;

    if (pipelineInteractive === "wardrop_fw") {
      if (res.iterationTrace && res.iterationTrace.length > 1) {
        pipelineWardropTrace = res.iterationTrace;
        if (prevFwLen > 1 && prevFwIdx >= 0) {
          const ratio = prevFwIdx / (prevFwLen - 1);
          pipelineFwIdx = Math.round(ratio * (res.iterationTrace.length - 1));
        } else {
          pipelineFwIdx = 0;
        }
        pipelineFwIdx = Math.max(0, Math.min(pipelineFwIdx, res.iterationTrace.length - 1));
      } else {
        pipelineInteractive = "wardrop_done";
        pipelineWardropTrace = null;
        pipelineFwIdx = -1;
        ensureWardropCommoditySelected();
      }
    }

    const decompNeeded =
      (pipeline.decomp && pipeline.decomp.ok) ||
      pipelineAsideStep >= 4 ||
      currentStep >= 4 ||
      pipelineInteractive === "decomp" ||
      wasRoundInteractive ||
      hadRounded ||
      (pipelineAsideStep === 5 && pipelineIntroSlide >= PIPELINE_STEP5_ROUND_SLIDE) ||
      (pipelineAsideStep === 7 && pipelineIntroSlide >= PIPELINE_STEP7_CHECKER_SLIDE);

    if (!decompNeeded) {
      pipeline.decomp = null;
      pipeline.rounded = null;
      pipeline.stepDone[3] = false;
      pipeline.stepDone[4] = false;
      pipeline.stepDone[5] = false;
      pipelineRoundSteps = null;
      pipelineRoundChosen = null;
      pipelineRoundRevealed = 0;
      pipelineRoundActive = false;
      return;
    }

    let dec = P.pathDecomposition(res.fCommEdge, G.nodes, G.edges, G.commodities);
    if (!dec.ok) {
      dec = P.pathDecompositionFromWardrop(res.pathLists, res.h, G.edges);
    }
    if (!dec.ok) {
      logLine("Pfadzerlegung nach Anpassung der Anzahl Spielender: " + dec.msg);
      pipeline.decomp = null;
      pipeline.rounded = null;
      pipelineRoundSteps = null;
      pipelineRoundChosen = null;
      return;
    }
    pipeline.decomp = dec;
    pipeline.stepDone[3] = true;

    if (pipelineInteractive === "decomp" && dec.steps && dec.steps.length) {
      pipelineDecompReveal = Math.max(1, Math.min(prevDecompReveal, dec.steps.length));
    }

    const roundNeeded =
      hadRounded ||
      hadPastRound ||
      wasRoundInteractive ||
      wasIntervalCheck ||
      wasOnCheckerSlide ||
      pipelineRoundSteps ||
      pipelineRoundActive ||
      (pipelineAsideStep === 5 && pipelineIntroSlide >= PIPELINE_STEP5_ROUND_SLIDE) ||
      (pipelineAsideStep === 7 && pipelineIntroSlide >= PIPELINE_STEP7_CHECKER_SLIDE);

    if (!roundNeeded) {
      pipeline.rounded = null;
      pipeline.stepDone[4] = false;
      pipeline.stepDone[5] = false;
      pipelineRoundSteps = null;
      pipelineRoundChosen = null;
      pipelineRoundRevealed = 0;
      pipelineRoundActive = false;
      return;
    }

    const sr = P.randomizedRoundSteps(dec.distributions, undefined, G.edges);
    pipelineRoundSteps = sr.steps;
    pipelineRoundChosen = sr.chosen;

    if (roundNeeded) {
      pipeline.rounded = sr.chosen;
      pipeline.stepDone[4] = true;
      pipeline.stepDone[5] = true;
      pipelineCheckAttempt = 0;
      pipelineCheckResult = null;
      if (wasIntervalCheck || wasOnCheckerSlide) {
        pipelineCheckAttempt = 1;
        refreshIntervalCheckResult();
      }
    }

    if (wasRoundInteractive) {
      pipelineRoundActive = true;
      pipelineRoundRevealed = Math.max(0, Math.min(prevRoundRevealed, sr.steps.length));
    }
  }

  function applyPlayerCountChange(count) {
    if (!isRandomNetworkInstance || (!randomNetworkEndpointPool && !randomNetworkBlueprints)) return;
    const max = DEMO_COMMODITY_MAX;
    const next = Math.max(1, Math.min(Math.round(Number(count)), max));
    if (!isFinite(next) || next === G.commodities.length) {
      syncPlayerCountControlInputs(G.commodities.length);
      return;
    }

    G.commodities = buildCommoditiesFromBlueprints(next);
    if (randomNetworkEndpointPool) refreshRandomNetworkBlueprintsFromPool(next);
    sanitizeCommodities();
    invalidateRelaxDemoData();
    const playerCountRecomputeCtx = {
      hadRounded: !!(pipeline.rounded || pipelineRoundChosen),
      hadPastRound: !!pipeline.stepDone[5],
      wasOnCheckerSlide:
        pipelineAsideStep === 7 &&
        pipelineIntroSlide === PIPELINE_STEP7_CHECKER_SLIDE &&
        pipelineInteractive === null,
    };
    pipeline.decomp = null;
    pipeline.rounded = null;
    invalidatePlotView();

    if (pipelineWardropCommodityIdx >= G.commodities.length) {
      pipelineWardropCommodityIdx = G.commodities.length > 0 ? 0 : -1;
    }
    if (pipelineCommodityPulseIdx >= G.commodities.length) {
      stopCommodityPulse();
    }

    const loadRef = estimateDidacticLoadRef(G.commodities.length, G.nodes.length);
    balanceWardropPathShares(G.nodes, G.edges, G.commodities, {
      targetMaxShare: 0.62,
      xRef: loadRef,
    });
    wardropValidationPreview = null;
    const validation = ensureRandomNetworkThesisValidDelays();
    recomputePipelineAfterPlayerCountChange(playerCountRecomputeCtx);
    bumpPipelinePlotRevision();
    syncPlayerCountControlInputs(G.commodities.length);
    plotInstantRender = true;
    renderAll();
    plotInstantRender = false;
    const instModal = document.getElementById("instance-modal");
    if (instModal && instModal.classList.contains("open")) {
      renderEdgeTable();
      renderCommodityPanel();
    }
    if (pipelineLocked) renderPipelinePanel();
    let logTail =
      " abhängige Pipeline-Ergebnisse wurden neu berechnet.";
    if (validation.edgesRepaired > 0) {
      logTail +=
        " Verzögerungen wurden an die neue Lastverteilung angepasst.";
    }
    if (validation.ok) {
      logTail += " Band- und Parameterbedingungen gelten für alle Kanten mit f_e > 0.";
    } else if (validation.failedEdges > 0) {
      logTail +=
        " Hinweis: " +
        validation.failedEdges +
        " Kante(n) mit f_e > 0 erfüllen die Bedingungen noch nicht.";
    }
    logLine("Anzahl Spielender auf " + G.commodities.length + " gesetzt." + logTail);
  }

  function flushPlayerCountChange(count) {
    if (playerCountRecomputeTimer) {
      clearTimeout(playerCountRecomputeTimer);
      playerCountRecomputeTimer = null;
    }
    setPlayerCountControlBusy(true);
    requestAnimationFrame(function () {
      try {
        applyPlayerCountChange(count);
      } finally {
        setPlayerCountControlBusy(false);
      }
    });
  }

  function schedulePlayerCountChange(count) {
    if (playerCountRecomputeTimer) clearTimeout(playerCountRecomputeTimer);
    playerCountRecomputeTimer = setTimeout(function () {
      playerCountRecomputeTimer = null;
      flushPlayerCountChange(count);
    }, 300);
  }

  function wirePlayerCountInputs(rangeId, inputId) {
    const range = document.getElementById(rangeId);
    const input = document.getElementById(inputId);
    if (!range || !input) return;
    range.addEventListener("input", function () {
      input.value = range.value;
      schedulePlayerCountChange(range.value);
    });
    range.addEventListener("change", function () {
      input.value = range.value;
      flushPlayerCountChange(range.value);
    });
    input.addEventListener("change", function () {
      range.value = input.value;
      flushPlayerCountChange(input.value);
    });
  }

  function wirePlayerCountControl() {
    if (playerCountControlWired) return;
    wirePlayerCountInputs("graph-player-count-range", "graph-player-count-input");
    wirePlayerCountInputs("instance-player-count-range", "instance-player-count-input");
    playerCountControlWired = true;
    const applyBtn = document.getElementById("btn-graph-player-count-apply");
    if (!applyBtn) return;

    applyBtn.addEventListener("click", function () {
      const recommended = recommendedPlayerCountForPipelineStep();
      const range = document.getElementById("graph-player-count-range");
      const input = document.getElementById("graph-player-count-input");
      if (range) range.value = String(recommended);
      if (input) input.value = String(recommended);
      flushPlayerCountChange(recommended);
    });
  }

  function graphSizePhrase() {
    return (
      "Der Graph enthält <strong>" +
      G.nodes.length +
      " Knoten</strong> und <strong>" +
      G.edges.length +
      " gerichtete Kanten</strong>."
    );
  }

  function graphHintBox(extra) {
    return '<p class="pipeline-graph-hint">' + extra + "</p>";
  }

  function enrichPipelineSlideHtml(step, slideIdx, html) {
    if (step === 1 && slideIdx === 0) {
      return (
        html +
        graphHintBox(
          tex(
            "Im Graph markiert <strong>Blau</strong> jeden Startknoten $p_s$ und <strong>Violett</strong> jeden Zielknoten $t_s$. Die Liste links neben dem Graph fasst alle Spielenden mit Start- und Zielknoten zusammen. " +
              playerCountPhrase() +
              " " +
              graphSizePhrase() +
              " Unterhalb des Graphen lässt sich die Anzahl der Spielenden anpassen. Pro Schritt wird eine empfohlene Größe angezeigt, abhängige Berechnungen werden im Hintergrund aktualisiert, und die Verzögerungsfunktionen werden so angepasst, dass Band- und Parameterbedingungen für die neue Lastverteilung gelten. " +
              "Nacheinander werden die Start- und Zielknoten von Spielende $1$, dann Spielende $2$ und so weiter kurz vergrößert. Die jeweils aktive Zeile in der Liste wird hervorgehoben. Jede Kante ist als $c_1$, $c_2$, $\\ldots$ benannt. In der Beschriftung erscheint zusätzlich die Kurzform der Verzögerungsfunktion."
          )
        )
      );
    }
    if (step === 1 && slideIdx === 1) {
      return (
        html +
        graphHintBox(
          tex(
            "Jede spielende Person wählt im Graph einen einfachen Pfad vom blauen Startknoten $p_s$ zum violetten Zielknoten $t_s$. Die Stabilitätsbedingung bezieht sich auf diese Pfadwahl unter der gemeinsamen Kantenbelastung aller Spielenden."
          )
        )
      );
    }
    if (step === 2 && slideIdx === 1) {
      return (
        html +
        graphHintBox(
          tex(
            "Im Graph bleiben dieselben blauen Startknoten $p_s$ und violetten Zielknoten $t_s$ sichtbar. Pro Commodity $s$ darf der Fluss nun auf mehrere $p_s$-$t_s$-Pfade verteilt werden, statt genau einen Pfad zu wählen."
          )
        )
      );
    }
    if (step === 2 && slideIdx === 3) {
      return (
        html +
        graphHintBox(
          tex(
            "Im Beispielgraph bedeutet das: Am blauen Knoten $p_s$ fließt je Commodity eine Einheit hinaus, am violetten Knoten $t_s$ eine Einheit hinein, an allen anderen Knoten wird der $s$-Fluss nur umgeleitet, nicht erzeugt oder verbraucht."
          )
        )
      );
    }
    if (step === 3 && slideIdx === 3) {
      return (
        html +
        graphHintBox(
          tex(
            "Nach der Berechnung erscheint ein fraktionaler Fluss: belastete Kanten werden grün, in der Beschriftung steht $f_e$ für den Gesamtfluss auf der Kante. Noch fehlt die Zuordnung je spielender Person zu einem Pfad. Das folgt in Schritt $4$ und $5$."
          )
        )
      );
    }
    if (step === 4 && slideIdx === 0) {
      return (
        html +
        graphHintBox(
          tex(
            "<strong>Grün:</strong> Wardrop-Fluss ($f_e > 0$). <strong>Orange:</strong> Kanten ohne Fluss, nur noch zur Einordnung auf dieser Karte. Ab der nächsten Karte bleibt der grüne Teilgraph sichtbar. Die Pfadzerlegung arbeitet nur mit belasteten Kanten."
          )
        )
      );
    }
    if (step === 4 && slideIdx === 1) {
      return (
        html +
        graphHintBox(
          tex(
            "Sichtbar ist nur der grüne Teilgraph mit positivem Fluss. Mit <strong>Weiter</strong> startet die Berechnung. Danach wird je Extraktionsschritt der zugehörige Pfad <strong>blau</strong> markiert."
          )
        )
      );
    }
    if (step === 5 && slideIdx === 0) {
      return (
        html +
        graphHintBox(
          tex(
            "Mit <strong>Weiter</strong> beginnt die Ziehung: je Commodity wird nacheinander ein Pfad gezogen. Die aktuelle Ziehung wird im Graph hervorgehoben, bereits gezogene Pfade bleiben sichtbar."
          )
        )
      );
    }
    if (step === 5 && slideIdx === 3) {
      return html + chernoffConcretePhrase();
    }
    if (step === 5 && slideIdx === PIPELINE_STEP5_SUCCESS_SLIDE) {
      return html + checkerSuccessConcretePhrase();
    }
    if (step === 7 && slideIdx === PIPELINE_STEP7_CHECKER_SLIDE) {
      let body = html;
      if (syncIntervalCheckerOnCheckerSlide()) {
        body += buildIntervalCheckerPanelHtml();
      } else {
        body +=
          '<div class="def-box">' +
          tex(
            "<p><strong>Hinweis:</strong> Es liegt noch kein gerundetes Profil vor. In Schritt 5 muss zuerst randomisiert gerundet werden.</p>"
          ) +
          "</div>";
      }
      if (pipelineCheckResult && pipelineCheckResult.ok && pipelineInteractive === null) {
        return (
          body +
          graphHintBox(
            tex(
              "<strong>Erfolg:</strong> Alle Kantenlasten liegen in den Intervallen. Mit <strong>Weiter</strong> folgt die Erläuterung zur hohen Erfolgswahrscheinlichkeit in der Demo."
            )
          )
        );
      }
      return (
        body +
        graphHintBox(
          tex(
            "Im Graphen sind die gerundeten Pfade sichtbar. Kanten außerhalb von $[l_e, u_e]$ werden orange markiert. Bei Bedarf <strong>Neu runden</strong> verwenden."
          )
        )
      );
    }
    if (step === 7 && slideIdx === PIPELINE_STEP7_WHY_SUCCESS_SLIDE) {
      return html + whyAlmostAlwaysSuccessConcretePhrase();
    }
    return html;
  }

  function shouldHideUnusedGraphEdges() {
    if (!pipelineLocked || pipelineAsideStep < 4) return false;
    if (pipelineAsideStep > 4) return true;
    if (pipelineInteractive === "decomp") return true;
    return pipelineIntroSlide >= 1;
  }

  function graphEdgesForRender(allEdges, fW, th) {
    if (!shouldHideUnusedGraphEdges()) return allEdges;
    return allEdges.filter(function (d, ei) {
      const fe = fW ? fW[ei] : 0;
      if (fe > 1e-6) return true;
      if (th.decompFocus && th.decompRem && th.decompRem[ei] > 1e-6) return true;
      if (th.decompPickEdge && th.decompPickEdge.has(d.id)) return true;
      return th.edgeStrong.has(d.id) || th.edgeSoft.has(d.id);
    });
  }

  function shouldRunCommodityPulse() {
    return (
      pipelineLocked &&
      pipelineInteractive === null &&
      pipelineAsideStep === 1 &&
      pipelineIntroSlide === 0 &&
      G.commodities.length > 0
    );
  }

  function shouldShowWardropCommodityExplorer() {
    return (
      pipelineLocked &&
      pipelineInteractive === "wardrop_done" &&
      pipeline.wardrop &&
      pipeline.wardrop.ok &&
      pipeline.wardrop.h &&
      pipeline.wardrop.pathLists &&
      G.commodities.length > 0
    );
  }

  function shouldShowDecompDetail() {
    return (
      pipelineLocked &&
      pipelineInteractive === "decomp" &&
      pipeline.decomp &&
      pipeline.decomp.ok &&
      pipeline.decomp.steps &&
      pipelineDecompReveal > 0
    );
  }

  /**
   * Restflüsse unmittelbar vor dem angezeigten Extraktionsschritt (revealIdx 1-basiert).
   * @returns {{ rem: Float64Array[], extracted: object[] } | null}
   */
  function computeDecompRemBeforeStep(revealIdx) {
    const w = pipeline.wardrop;
    const dec = pipeline.decomp;
    if (!w || !w.ok || !w.fCommEdge || !dec || !dec.steps) return null;
    const K = G.commodities.length;
    const rem = [];
    for (let k = 0; k < K; k++) {
      rem.push(w.fCommEdge[k].slice());
    }
    const extracted = [];
    const applyCount = Math.max(0, Math.min(revealIdx - 1, dec.steps.length));
    for (let i = 0; i < applyCount; i++) {
      const st = dec.steps[i];
      extracted.push(st);
      const amt = st.weight;
      for (let j = 0; j < st.edges.length; j++) {
        rem[st.commodityIndex][st.edges[j]] -= amt;
      }
    }
    return { rem, extracted };
  }

  function buildDecompStepPanelHtml(cur, stepIdx, totalSteps, beforeState) {
    if (!cur || !beforeState) return "";
    const k = cur.commodityIndex;
    const com = G.commodities[k];
    const pickEi =
      typeof cur.pickEdgeIndex === "number" ? cur.pickEdgeIndex : cur.edges[0];
    const pickLabel = edgeNameLatex(G.edges[pickEi], pickEi);
    const pathTex = cur.edges
      .map(function (ei) {
        return edgeNameLatex(G.edges[ei], ei);
      })
      .join(" \\to ");
    const remPick =
      beforeState.rem[k] && typeof pickEi === "number"
        ? beforeState.rem[k][pickEi]
        : cur.weight;
    const src = com ? nodeIdLatex(com.sourceId) : "?";
    const snk = com ? nodeIdLatex(com.sinkId) : "?";

    let html =
      '<div class="decomp-step-panel">' +
      "<p class=\"decomp-step-lead\"><strong>Extraktionsschritt " +
      (stepIdx + 1) +
      "</strong> von " +
      totalSteps +
      ". Es werden nur die Restflüsse " +
      math("f_e^s") +
      " des aktiven Spielenden " +
      playerIndexHtml(k + 1) +
      " betrachtet, nicht die Summe über alle Spielenden.</p>" +
      '<ol class="decomp-algo-steps">' +
      tex(
        "<li><strong>Minimum wählen:</strong> Kante $" +
          pickLabel +
          "$ mit kleinstem positivem $f_e^s = " +
          remPick.toFixed(3) +
          "$.</li>"
      ) +
      tex(
        "<li><strong>Pfad finden:</strong> einfacher Weg von $" +
          src +
          "$ nach $" +
          snk +
          "$ durch $" +
          pickLabel +
          "$, nur Kanten mit positivem $s$-Restfluss.</li>"
      ) +
      tex(
        "<li><strong>In $\\mathcal{D}_{" +
          (k + 1) +
          "}$ speichern:</strong> Pfad $" +
          pathTex +
          "$ mit Gewicht $f_P^s = " +
          cur.weight.toFixed(3) +
          "$.</li>"
      ) +
      tex(
        "<li><strong>Subtrahieren:</strong> von allen Kanten auf dem Pfad wird $" +
          cur.weight.toFixed(3) +
          "$ vom $s$-Restfluss abgezogen.</li>"
      ) +
      "</ol>";

    const prevSame = beforeState.extracted.filter(function (st) {
      return st.commodityIndex === k;
    });
    if (prevSame.length > 0) {
      html +=
        '<p class="decomp-extracted-title">' +
        tex("Bereits in $\\mathcal{D}_{" + (k + 1) + "}$:") +
        '</p><ul class="decomp-extracted-list">';
      for (let i = 0; i < prevSame.length; i++) {
        const st = prevSame[i];
        html +=
          "<li>" +
          tex(
            "$f_P^s = " +
              st.weight.toFixed(3) +
              "$ auf " +
              st.edges
                .map(function (ei) {
                  return "$" + edgeNameLatex(G.edges[ei], ei) + "$";
                })
                .join(" $\\to$ ")
          ) +
          "</li>";
      }
      html += "</ul>";
    }

    html += "</div>";
    return html;
  }

  function roundSelectionTex(step) {
    const opt = step.pathOptions[step.pickIndex];
    if (!opt) return "";
    const r = step.r.toFixed(4);
    const lo = opt.lower.toFixed(4);
    if (opt.isLast) {
      return (
        "Da $" +
        lo +
        " \\leq r = " +
        r +
        " \\leq 1$ gilt, wird Pfad $" +
        opt.pathLabel +
        "$ gewählt."
      );
    }
    return (
      "Da $" +
      lo +
      " \\leq r = " +
      r +
      " < " +
      opt.upper.toFixed(4) +
      "$ gilt, wird Pfad $" +
      opt.pathLabel +
      "$ gewählt."
    );
  }

  function roundDrawHintHtml(compact) {
    if (compact) {
      return (
        '<div class="def-box round-draw-hint">' +
        tex(
          "<strong>Ziehung auf $[0,1)$:</strong> Die Gewichte $f_{P_i}^s$ der Pfade $P_i \\in \\mathcal{D}_s$ werden zu aneinandergrenzenden Teilintervallen summiert. Liegt die Zufallszahl $r$ im Intervall zu $P_i$, wird $P_i$ gewählt. Die Intervalllänge ist $f_{P_i}^s$."
        ) +
        "</div>"
      );
    }
    return (
      '<div class="def-box round-draw-hint">' +
      tex(
        "<strong>Wie wird der Pfad zufällig bestimmt?</strong> Für jede Commodity wird unabhängig eine Zufallszahl $r \\in [0,1)$ gezogen. Die Gewichte $f_{P_i}^s$ der Pfade $P_i \\in \\mathcal{D}_s$ bilden eine Wahrscheinlichkeitsverteilung und werden als <strong>aneinandergrenzende Teilintervalle</strong> auf $[0,1)$ gelegt (kumulative Summe). Liegt $r$ im Teilintervall zu $P_i$, wird $P_i$ gewählt. Die Länge dieses Intervalls ist genau $f_{P_i}^s$."
      ) +
      "</div>"
    );
  }

  function buildRoundStepPanelHtml(step, stepIdx, totalSteps) {
    if (!step || !step.pathOptions || step.pathOptions.length === 0) return "";
    const k = step.commodityIndex;
    const com = G.commodities[k];
    const src = com ? nodeIdLatex(com.sourceId) : "?";
    const snk = com ? nodeIdLatex(com.sinkId) : "?";

    let html =
      '<div class="round-step-panel decomp-step-panel">' +
      roundDrawHintHtml(true) +
      tex(
        "<p class=\"decomp-step-lead\"><strong>Ziehung " +
          (stepIdx + 1) +
          "</strong> von " +
          totalSteps +
          " für $" +
          playerIndexLatex(k + 1) +
          " ($" +
          src +
          " \\to " +
          snk +
          "$).</p>"
      ) +
      '<p class="round-path-list-title">' +
      tex("Mögliche Pfade in $\\mathcal{D}_{" + (k + 1) + "}$:") +
      '</p><ul class="round-path-list">';

    for (let i = 0; i < step.pathOptions.length; i++) {
      const opt = step.pathOptions[i];
      const isPick = i === step.pickIndex;
      const interval =
        opt.isLast
          ? "[" + opt.lower.toFixed(4) + ",\\,1]"
          : "[" + opt.lower.toFixed(4) + ",\\," + opt.upper.toFixed(4) + ")";
      html +=
        '<li class="round-path-item' +
        (isPick ? " round-path-pick" : "") +
        '">' +
        tex(
          "Pfad $" +
            opt.pathLabel +
            "$ mit $f_P^s = " +
            opt.weight.toFixed(4) +
            "$, Intervall $" +
            interval +
            "$"
        ) +
        (isPick ? " <strong>(gewählt)</strong>" : "") +
        "</li>";
    }

    html +=
      "</ul>" +
      tex(
        "<p><strong>Zufallszahl:</strong> $r = " +
          step.r.toFixed(4) +
          "$.</p><p><strong>Rechnung:</strong> " +
          roundSelectionTex(step) +
          "</p>"
      ) +
      "</div>";
    return html;
  }

  function wardropPathsForCommodity(k) {
    const w = pipeline.wardrop;
    if (!w || !w.ok || !w.h || !w.pathLists || k < 0 || k >= w.pathLists.length) return [];
    const paths = [];
    for (let p = 0; p < w.pathLists[k].length; p++) {
      const weight = w.h[k][p];
      if (weight <= WARDROP_PATH_FLOW_TOL) continue;
      const edgeEis = w.pathLists[k][p];
      const edgeIds = [];
      for (let j = 0; j < edgeEis.length; j++) {
        const e = G.edges[edgeEis[j]];
        if (e) edgeIds.push(e.id);
      }
      paths.push({ pathIndex: p, weight, edgeEis, edgeIds });
    }
    paths.sort(function (a, b) {
      return b.weight - a.weight;
    });
    return paths;
  }

  function formatWardropShare(weight) {
    const pct = weight * 100;
    if (pct >= 99.95) return "100\u00a0%";
    if (pct <= 0.05) return "<0,1\u00a0%";
    if (pct >= 10) return pct.toFixed(0) + "\u00a0%";
    if (pct >= 1) return pct.toFixed(1) + "\u00a0%";
    return pct.toFixed(2) + "\u00a0%";
  }

  function buildWardropPathBreakdownHtml(commodityIdx) {
    const paths = wardropPathsForCommodity(commodityIdx);
    if (paths.length === 0) return "";
    let html = '<div class="wardrop-path-breakdown wardrop-path-breakdown-slide">';
    html +=
      '<p class="wardrop-path-breakdown-title">' +
      "Pfadanteile (" +
      playerIndexHtml(commodityIdx + 1) +
      ")</p>";
    html += '<ul class="wardrop-path-breakdown-items">';
    for (let pi = 0; pi < paths.length; pi++) {
      const p = paths[pi];
      html +=
        '<li class="wardrop-path-breakdown-item">' +
        '<span class="wardrop-path-color-dot wardrop-path-color-dot-' +
        (pi % WARDROP_PATH_COLOR_COUNT) +
        '" aria-hidden="true"></span>' +
        '<span class="wardrop-path-share">' +
        formatWardropShare(p.weight) +
        "</span>" +
        '<span class="wardrop-path-route">' +
        edgePathLabelHtml(p.edgeEis) +
        "</span></li>";
    }
    html += "</ul></div>";
    return html;
  }

  function ensureWardropCommoditySelected() {
    if (!shouldShowWardropCommodityExplorer()) return;
    if (
      pipelineWardropCommodityIdx < 0 ||
      pipelineWardropCommodityIdx >= G.commodities.length
    ) {
      pipelineWardropCommodityIdx = 0;
    }
  }

  function selectWardropCommodity(idx) {
    if (!shouldShowWardropCommodityExplorer()) return;
    if (idx < 0 || idx >= G.commodities.length) return;
    pipelineWardropCommodityIdx = idx;
    renderSvg();
    updateSvgContextHint();
    if (pipelineInteractive === "wardrop_done") renderPipelinePanel();
  }

  function resetCommoditySpotlightVisuals() {
    gMain.selectAll("circle.node-disk").interrupt().attr("r", NODE_BASE_R);
    gMain
      .selectAll("text.node-label")
      .interrupt()
      .attr("font-size", NODE_LABEL_FONT)
      .style("font-weight", null);
  }

  function triggerCommoditySpotlightPulse() {
    if (!shouldRunCommodityPulse() || pipelineCommodityPulseIdx < 0) {
      resetCommoditySpotlightVisuals();
      return;
    }
    const c = G.commodities[pipelineCommodityPulseIdx];
    if (!c) return;
    const ids = [];
    if (c.sourceId) ids.push(c.sourceId);
    if (c.sinkId && c.sinkId !== c.sourceId) ids.push(c.sinkId);
    if (ids.length === 0) return;

    resetCommoditySpotlightVisuals();

    const idSet = new Set(ids);
    const half = COMMODITY_PULSE_MS * 0.38;

    gMain
      .selectAll("circle.node-disk")
      .filter((d) => idSet.has(d.id))
      .transition()
      .duration(half)
      .ease(d3.easeSinInOut)
      .attr("r", NODE_SPOTLIGHT_R)
      .transition()
      .duration(half)
      .ease(d3.easeSinInOut)
      .attr("r", NODE_BASE_R);

    gMain
      .selectAll("text.node-label")
      .filter((d) => idSet.has(d.id))
      .style("font-weight", "700")
      .transition()
      .duration(half)
      .ease(d3.easeSinInOut)
      .attr("font-size", NODE_LABEL_FONT_SPOTLIGHT)
      .transition()
      .duration(half)
      .ease(d3.easeSinInOut)
      .attr("font-size", NODE_LABEL_FONT)
      .on("end", function () {
        d3.select(this).style("font-weight", null);
      });
  }

  function stopCommodityPulse() {
    if (pipelineCommodityPulseTimer) {
      clearInterval(pipelineCommodityPulseTimer);
      pipelineCommodityPulseTimer = null;
    }
    pipelineCommodityPulseIdx = -1;
    resetCommoditySpotlightVisuals();
  }

  /** @returns {"started"|"running"|"stopped"} */
  function syncCommodityPulse() {
    if (!shouldRunCommodityPulse()) {
      stopCommodityPulse();
      return "stopped";
    }
    if (pipelineCommodityPulseTimer) return "running";
    pipelineCommodityPulseIdx = 0;
    pipelineCommodityPulseTimer = setInterval(function () {
      if (!shouldRunCommodityPulse()) {
        stopCommodityPulse();
        renderSvg();
        updateSvgContextHint();
        return;
      }
      pipelineCommodityPulseIdx = (pipelineCommodityPulseIdx + 1) % G.commodities.length;
      renderSvg();
      triggerCommoditySpotlightPulse();
      updateSvgContextHint();
    }, COMMODITY_PULSE_MS);
    return "started";
  }

  function shouldRunRelaxDemo() {
    return (
      pipelineLocked &&
      pipelineInteractive === null &&
      pipelineAsideStep === 2 &&
      pipelineIntroSlide === 0
    );
  }

  function invalidateRelaxDemoData() {
    pipelineRelaxDemoData = null;
    pipelineRelaxDemoLayoutFp = "";
  }

  function ensureRelaxDemoDataFresh() {
    const fp = graphLayoutFingerprint();
    if (pipelineRelaxDemoData && fp !== pipelineRelaxDemoLayoutFp) {
      invalidateRelaxDemoData();
    }
    if (!pipelineRelaxDemoData) {
      pipelineRelaxDemoData = buildRelaxDemoData();
      pipelineRelaxDemoLayoutFp = fp;
    }
    return pipelineRelaxDemoData;
  }

  function buildRelaxDemoData() {
    if (G.commodities.length === 0 || G.nodes.length === 0) return null;
    const idToIdx = P.idxMap(G.nodes);
    const adj = P.buildAdj(G.nodes.length, G.edges, idToIdx);

    for (let ci = 0; ci < G.commodities.length; ci++) {
      const com = G.commodities[ci];
      const s = idToIdx.get(com.sourceId);
      const t = idToIdx.get(com.sinkId);
      if (s === undefined || t === undefined) continue;

      const paths = P.enumeratePaths(adj, G.nodes.length, s, t, 24, 14);
      if (paths.length < 2) continue;

      paths.sort(function (a, b) {
        return a.length - b.length || a.join(",").localeCompare(b.join(","));
      });
      const pathDiscrete = paths[0];
      const set0 = new Set(pathDiscrete);
      let pathAlt = null;
      let bestOverlap = Infinity;
      for (let i = 1; i < paths.length; i++) {
        const p = paths[i];
        if (p.join(",") === pathDiscrete.join(",")) continue;
        let overlap = 0;
        for (let j = 0; j < p.length; j++) {
          if (set0.has(p[j])) overlap++;
        }
        if (overlap < bestOverlap) {
          bestOverlap = overlap;
          pathAlt = p;
        }
      }
      if (!pathAlt) pathAlt = paths[1];

      return {
        commodityIndex: ci,
        sourceId: com.sourceId,
        sinkId: com.sinkId,
        pathDiscrete: pathDiscrete,
        relaxedSplit: [
          { edges: pathDiscrete, share: 0.5 },
          { edges: pathAlt, share: 0.5 },
        ],
      };
    }
    return null;
  }

  function stopRelaxDemo() {
    if (pipelineRelaxDemoTimer) {
      clearInterval(pipelineRelaxDemoTimer);
      pipelineRelaxDemoTimer = null;
    }
    pipelineRelaxDemoPhase = "discrete";
    pipelineRelaxAnimToken++;
    gMain.selectAll(".relax-demo-overlay").remove();
  }

  /** @returns {"started"|"running"|"stopped"|"unavailable"} */
  function syncRelaxDemo() {
    if (!shouldRunRelaxDemo()) {
      stopRelaxDemo();
      return "stopped";
    }
    if (!ensureRelaxDemoDataFresh()) return "unavailable";
    if (pipelineRelaxDemoTimer) return "running";
    pipelineRelaxDemoPhase = "discrete";
    pipelineRelaxDemoTimer = setInterval(function () {
      if (!shouldRunRelaxDemo()) {
        stopRelaxDemo();
        renderSvg();
        updateSvgContextHint();
        return;
      }
      ensureRelaxDemoDataFresh();
      pipelineRelaxDemoPhase =
        pipelineRelaxDemoPhase === "discrete" ? "relaxed" : "discrete";
      renderSvg();
      scheduleRelaxTokenAnimation();
      updateSvgContextHint();
    }, RELAX_DEMO_PHASE_MS);
    return "started";
  }

  function scheduleRelaxTokenAnimation() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (shouldRunRelaxDemo()) startRelaxTokenAnimation();
      });
    });
  }

  function pathPolylinePoints(edgeIndices) {
    return pathBezierSamplePoints(edgeIndices, 14);
  }

  function animateTokenAlongPath(g, edgeIndices, color, radius, duration, animGen) {
    const points = pathPolylinePoints(edgeIndices);
    if (points.length < 2) return;
    const segments = [];
    let totalLen = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      const len = Math.hypot(dx, dy);
      segments.push({ from: points[i], to: points[i + 1], len: len, start: totalLen });
      totalLen += len;
    }
    if (totalLen < 1) return;

    function posAt(t) {
      const dist = Math.max(0, Math.min(1, t)) * totalLen;
      for (let s = 0; s < segments.length; s++) {
        const seg = segments[s];
        if (dist <= seg.start + seg.len || s === segments.length - 1) {
          const u = seg.len < 1e-6 ? 1 : (dist - seg.start) / seg.len;
          return {
            x: seg.from.x + u * (seg.to.x - seg.from.x),
            y: seg.from.y + u * (seg.to.y - seg.from.y),
          };
        }
      }
      return points[points.length - 1];
    }

    const p0 = posAt(0);
    const circle = g
      .append("circle")
      .attr("class", "relax-flow-token")
      .attr("r", radius)
      .attr("fill", color)
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .attr("cx", p0.x)
      .attr("cy", p0.y);

    circle
      .transition()
      .duration(duration)
      .ease(d3.easeLinear)
      .attrTween("cx", function () {
        return function (t) {
          if (animGen !== pipelineRelaxAnimToken) return p0.x;
          return posAt(t).x;
        };
      })
      .attrTween("cy", function () {
        return function (t) {
          if (animGen !== pipelineRelaxAnimToken) return p0.y;
          return posAt(t).y;
        };
      })
      .on("end", function () {
        if (animGen !== pipelineRelaxAnimToken) return;
        d3.select(this).remove();
      });
  }

  function startRelaxTokenAnimation() {
    pipelineRelaxAnimToken++;
    const animGen = pipelineRelaxAnimToken;
    gMain.selectAll(".relax-demo-overlay").remove();

    const data = pipelineRelaxDemoData;
    if (!data || !shouldRunRelaxDemo()) return;

    const src = nodeCenterById(data.sourceId);
    const snk = nodeCenterById(data.sinkId);
    if (!src || !snk) return;

    const g = gMain.append("g").attr("class", "relax-demo-overlay");
    g.raise();

    if (pipelineRelaxDemoPhase === "discrete") {
      g.append("text")
        .attr("class", "relax-unit-badge relax-badge-source")
        .attr("x", src.x)
        .attr("y", src.y - 24)
        .text("1");
      g.append("text")
        .attr("class", "relax-unit-badge relax-badge-sink")
        .attr("x", snk.x)
        .attr("y", snk.y - 24)
        .text("1");
      animateTokenAlongPath(
        g,
        data.pathDiscrete,
        "#ff9500",
        7,
        RELAX_TOKEN_DURATION_MS,
        animGen
      );
    } else {
      g.append("text")
        .attr("class", "relax-unit-badge relax-badge-source")
        .attr("x", src.x)
        .attr("y", src.y - 24)
        .text("½ + ½");
      g.append("text")
        .attr("class", "relax-unit-badge relax-badge-sink")
        .attr("x", snk.x)
        .attr("y", snk.y - 24)
        .text("= 1");
      animateTokenAlongPath(
        g,
        data.relaxedSplit[0].edges,
        "#007aff",
        5.5,
        RELAX_TOKEN_DURATION_MS,
        animGen
      );
      animateTokenAlongPath(
        g,
        data.relaxedSplit[1].edges,
        "#af52de",
        5.5,
        RELAX_TOKEN_DURATION_MS,
        animGen
      );
    }
  }

  function relaxDemoPhaseHint() {
    if (!shouldRunRelaxDemo()) return "";
    return pipelineRelaxDemoPhase === "discrete"
      ? "Diskrete Animation"
      : "Relaxierte Animation";
  }

  function updateGraphPlayerList() {
    const root = document.getElementById("graph-player-list");
    const stage = document.getElementById("graph-stage");
    if (!root) return;
    const pulseMode = shouldRunCommodityPulse();
    const wardropMode = shouldShowWardropCommodityExplorer();
    const decompMode = shouldShowDecompDetail();
    const show = pulseMode || wardropMode || decompMode;
    if (stage) stage.classList.toggle("graph-stage-with-player-list", show);
    if (!show) {
      root.hidden = true;
      root.classList.remove("graph-player-list-many");
      root.replaceChildren();
      return;
    }
    root.hidden = false;
    root.classList.toggle("graph-player-list-many", G.commodities.length > 12);
    const title = document.createElement("p");
    title.className = "graph-player-list-title";
    title.textContent = decompMode ? "Spielende (aktiv hervorgehoben)" : "Spielende";
    const list = document.createElement("ul");
    list.className = "graph-player-list-items";
    let decompActiveIdx = -1;
    if (decompMode && pipeline.decomp && pipeline.decomp.steps) {
      const stepIdx = Math.min(
        Math.max(pipelineDecompReveal - 1, 0),
        pipeline.decomp.steps.length - 1
      );
      decompActiveIdx = pipeline.decomp.steps[stepIdx].commodityIndex;
    }
    for (let i = 0; i < G.commodities.length; i++) {
      const c = G.commodities[i];
      const item = document.createElement("li");
      const activeIdx = decompMode
        ? decompActiveIdx
        : wardropMode
          ? pipelineWardropCommodityIdx
          : pipelineCommodityPulseIdx;
      item.className =
        "graph-player-list-item" +
        (i === activeIdx ? " is-active" : "") +
        (wardropMode ? " is-clickable" : "");
      const num = document.createElement("span");
      num.className = "graph-player-list-num";
      num.innerHTML = playerIndexHtml(i + 1) + ":";
      const nodes = document.createElement("span");
      nodes.className = "graph-player-list-nodes";
      const src = document.createElement("span");
      src.className = "graph-player-node graph-player-source";
      src.innerHTML = nodeIdHtml(c.sourceId);
      const arrow = document.createElement("span");
      arrow.className = "graph-player-arrow";
      arrow.innerHTML = math("\\rightarrow");
      const snk = document.createElement("span");
      snk.className = "graph-player-node graph-player-sink";
      snk.innerHTML = nodeIdHtml(c.sinkId);
      nodes.append(src, arrow, snk);
      item.append(num, nodes);
      if (wardropMode) {
        item.setAttribute("role", "button");
        item.tabIndex = 0;
        item.addEventListener("click", function () {
          selectWardropCommodity(i);
        });
        item.addEventListener("keydown", function (evt) {
          if (evt.key === "Enter" || evt.key === " ") {
            evt.preventDefault();
            selectWardropCommodity(i);
          }
        });
      }
      list.appendChild(item);
    }
    root.replaceChildren(title, list);
    if (decompMode && decompActiveIdx >= 0 && pipeline.decomp && pipeline.decomp.steps) {
      const stepIdx = Math.min(
        Math.max(pipelineDecompReveal - 1, 0),
        pipeline.decomp.steps.length - 1
      );
      const steps = pipeline.decomp.steps;
      const rows = [];
      for (let i = 0; i <= stepIdx; i++) {
        const st = steps[i];
        if (!st || st.commodityIndex !== decompActiveIdx) continue;
        rows.push({ st: st, idx: i, isCurrent: i === stepIdx });
      }
      if (rows.length > 0) {
        const breakdown = document.createElement("div");
        breakdown.className = "wardrop-path-breakdown decomp-path-breakdown";
        const head = document.createElement("p");
        head.className = "wardrop-path-breakdown-title";
        head.innerHTML = "Extrahierte Pfade (" + playerIndexHtml(decompActiveIdx + 1) + ")";
        breakdown.appendChild(head);
        const pathList = document.createElement("ul");
        pathList.className = "wardrop-path-breakdown-items";
        for (let ri = 0; ri < rows.length; ri++) {
          const row = rows[ri];
          const item = document.createElement("li");
          item.className =
            "wardrop-path-breakdown-item" + (row.isCurrent ? " decomp-path-current" : "");
          const dot = document.createElement("span");
          dot.className =
            "wardrop-path-color-dot wardrop-path-color-dot-" + (ri % WARDROP_PATH_COLOR_COUNT);
          dot.setAttribute("aria-hidden", "true");
          const share = document.createElement("span");
          share.className = "wardrop-path-share";
          share.textContent = formatWardropShare(row.st.weight);
          const route = document.createElement("span");
          route.className = "wardrop-path-route";
          route.innerHTML = edgePathLabelHtml(row.st.edges);
          item.append(dot, share, route);
          pathList.appendChild(item);
        }
        breakdown.appendChild(pathList);
        root.appendChild(breakdown);
      }
    }
    renderPipelineMath(root);
  }

  const viewW = 800;
  const viewHGraph = 440;
  const viewHPlot = 520;
  /** Zeichenfläche der Plot-Bühne (Pipeline-Diagramme nutzen viewHPlot). */
  const PLOT_BOX = { x0: 54, x1: 786, y0: 20, y1: 478 };
  const PLOT_COL = {
    axis: "#c7c7cc",
    grid: "rgba(60, 60, 67, 0.12)",
    curve: "#1c1c1e",
    band: "rgba(52, 199, 89, 0.16)",
    bandStroke: "rgba(52, 199, 89, 0.55)",
    interval: "rgba(0, 122, 255, 0.10)",
    intervalStroke: "rgba(0, 122, 255, 0.5)",
    mean: "#ff9500",
    bar: "rgba(0, 122, 255, 0.55)",
    barStroke: "#007aff",
    good: "#248a3d",
    bad: "#ff3b30",
    poly: "#007aff",
    expo: "#af52de",
  };

  const svg = d3.select("#viz-svg");
  const gZoom = svg.append("g").attr("class", "zoom-layer");
  gZoom
    .append("rect")
    .attr("class", "pan-bg")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", viewW)
    .attr("height", viewHGraph)
    .attr("fill", "transparent");
  const gMain = gZoom.append("g").attr("class", "main-g");
  svg.append("defs").html(
    '<marker id="arr-idle" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path fill="#e68600" d="M 0 0 L 10 5 L 0 10 z" /></marker>' +
      '<marker id="arr-flow" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path fill="#28b04d" d="M 0 0 L 10 5 L 0 10 z" /></marker>'
  );

  /** Plot-Bühne für Schritte 6 bis 8 (Histogramm, Funktionsplots). Liegt außerhalb der Zoom-Ebene. */
  const gPlot = svg.append("g").attr("class", "plot-layer").style("display", "none");
  gPlot
    .append("defs")
    .append("clipPath")
    .attr("id", "plot-clip")
    .append("rect")
    .attr("x", PLOT_BOX.x0)
    .attr("y", PLOT_BOX.y0)
    .attr("width", PLOT_BOX.x1 - PLOT_BOX.x0)
    .attr("height", PLOT_BOX.y1 - PLOT_BOX.y0);
  const gPlotContent = gPlot
    .append("g")
    .attr("class", "plot-content")
    .attr("clip-path", "url(#plot-clip)");
  /** Achsen, Ticks und Beschriftungen außerhalb des Clip-Bereichs (sonst unsichtbar). */
  const gPlotChrome = gPlot.append("g").attr("class", "plot-chrome");
  const gPlotInteraction = gPlot.append("g").attr("class", "plot-interaction");
  gPlotInteraction
    .append("rect")
    .attr("class", "plot-zoom-surface")
    .attr("x", PLOT_BOX.x0)
    .attr("y", PLOT_BOX.y0)
    .attr("width", PLOT_BOX.x1 - PLOT_BOX.x0)
    .attr("height", PLOT_BOX.y1 - PLOT_BOX.y0)
    .attr("fill", "transparent");

  function isPanBackgroundTarget(t) {
    if (!t || !t.tagName) return false;
    if (t === svg.node()) return true;
    if (t.classList && t.classList.contains("pan-bg")) return true;
    if (t.tagName.toLowerCase() === "g" && t.classList && t.classList.contains("main-g")) return true;
    return false;
  }

  const zoom = d3
    .zoom()
    .scaleExtent([0.35, 5])
    .clickDistance(8)
    .filter(function (event) {
      if (!pipelineGraphZoomEnabled) return false;
      if (event.type === "wheel") {
        event.preventDefault();
        return true;
      }
      if (event.type === "dblclick") return false;
      if (event.type === "mousedown") {
        if (event.button === 1 || event.shiftKey) return true;
        if (event.button !== 0) return false;
        const tag = event.target.tagName.toLowerCase();
        if (tag === "circle" || tag === "path" || tag === "text") return false;
        return isPanBackgroundTarget(event.target);
      }
      return false;
    })
    .on("start", function (event) {
      if (event.sourceEvent && event.sourceEvent.type === "mousedown" && event.sourceEvent.button === 0) {
        d3.selectAll(".pan-bg").style("cursor", "grabbing");
      }
    })
    .on("zoom", function (event) {
      gZoom.attr("transform", event.transform);
    })
    .on("end", function () {
      d3.selectAll(".pan-bg").style("cursor", "grab");
    });
  svg.call(zoom);

  function resetGraphZoom() {
    svg.call(zoom.transform, d3.zoomIdentity);
  }

  /** Leicht reingezoomt, zentriert auf die Knotenwolke (v. a. nach Zufallsnetz). */
  function zoomToGraphContent(scale) {
    const nodes = G.nodes;
    if (!nodes.length) {
      resetGraphZoom();
      return;
    }
    let minx = Infinity;
    let miny = Infinity;
    let maxx = -Infinity;
    let maxy = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      minx = Math.min(minx, n.x);
      miny = Math.min(miny, n.y);
      maxx = Math.max(maxx, n.x);
      maxy = Math.max(maxy, n.y);
    }
    const cx = (minx + maxx) / 2;
    const cy = (miny + maxy) / 2;
    const k = scale;
    const t = d3.zoomIdentity.translate(viewW / 2, viewHGraph / 2).scale(k).translate(-cx, -cy);
    svg.transition().duration(220).ease(d3.easeCubicOut).call(zoom.transform, t);
  }

  function snap(x) {
    return Math.round(x / 10) * 10;
  }

  /** Mindestabstand der Knotenmittelpunkte beim Zufallsnetz (Kreis + Beschriftung). */
  const RANDOM_NODE_MIN_DIST = 2 * NODE_BASE_R + 22;

  function nodesTooClose(x1, y1, x2, y2, minDist) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy < minDist * minDist;
  }

  function collidesWithPlacedNodes(x, y, placed, minDist) {
    for (let i = 0; i < placed.length; i++) {
      const n = placed[i];
      if (nodesTooClose(x, y, n.x, n.y, minDist)) return true;
    }
    return false;
  }

  /**
   * Zufällige Knotenpositionen ohne Überlappung (Ablehnungsstichprobe, Raster-Fallback).
   * @param {number} nCount
   * @param {number} layoutW
   * @param {number} layoutH
   */
  function placeRandomNonOverlappingNodes(nCount, layoutW, layoutH) {
    const pad = 40;
    const minDist = RANDOM_NODE_MIN_DIST;
    const gridStep = 10;
    const nodes = [];
    const maxAttemptsPerNode = 1200;

    function boundsOk(x, y) {
      return x >= pad && x <= layoutW - pad && y >= pad && y <= layoutH - pad;
    }

    function tryPlaceAt(x, y) {
      const sx = snap(x);
      const sy = snap(y);
      if (!boundsOk(sx, sy)) return false;
      if (collidesWithPlacedNodes(sx, sy, nodes, minDist)) return false;
      nodes.push({ id: nid(), x: sx, y: sy });
      return true;
    }

    for (let i = 0; i < nCount; i++) {
      let placed = false;
      for (let attempt = 0; attempt < maxAttemptsPerNode; attempt++) {
        if (
          tryPlaceAt(
            pad + Math.random() * (layoutW - 2 * pad),
            pad + Math.random() * (layoutH - 2 * pad)
          )
        ) {
          placed = true;
          break;
        }
      }
      if (placed) continue;

      const candidates = [];
      for (let y = pad; y <= layoutH - pad; y += gridStep) {
        for (let x = pad; x <= layoutW - pad; x += gridStep) {
          if (!collidesWithPlacedNodes(x, y, nodes, minDist)) candidates.push({ x, y });
        }
      }
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        nodes.push({ id: nid(), x: pick.x, y: pick.y });
      } else {
        const cols = Math.max(1, Math.ceil(Math.sqrt(nCount * (layoutW / layoutH))));
        const rows = Math.ceil(nCount / cols);
        const cellW = (layoutW - 2 * pad) / cols;
        const cellH = (layoutH - 2 * pad) / rows;
        const gi = i % cols;
        const gj = Math.floor(i / cols);
        nodes.push({
          id: nid(),
          x: snap(pad + cellW * (gi + 0.5)),
          y: snap(pad + cellH * (gj + 0.5)),
        });
      }
    }
    return nodes;
  }

  /** Bildkoordinaten unter Berücksichtigung von Pan/Zoom (für Knoten-Drag). */
  function pointerInGraph(event) {
    const t = d3.zoomTransform(svg.node());
    const p = d3.pointer(event, svg.node());
    return t.invert(p);
  }

  function graphLayoutFingerprint() {
    let s = "";
    for (let i = 0; i < G.nodes.length; i++) {
      const n = G.nodes[i];
      s += n.id + ":" + n.x + "," + n.y + ";";
    }
    return s;
  }

  function quadraticBezierPoint(p0, p1, p2, t) {
    const u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    };
  }

  function nodeCenterById(id) {
    const n = G.nodes.find(function (nd) {
      return nd.id === id;
    });
    if (!n) return null;
    const sel = gMain.selectAll("circle.node-disk").filter(function (d) {
      return d.id === id;
    });
    if (!sel.empty()) {
      const cx = sel.attr("cx");
      const cy = sel.attr("cy");
      if (cx != null && cy != null && cx !== "" && cy !== "") {
        return { x: +cx, y: +cy };
      }
    }
    return { x: n.x, y: n.y };
  }

  function edgeControlPoint(fromNode, toNode) {
    return {
      x: (fromNode.x + toNode.x) / 2,
      y: (fromNode.y + toNode.y) / 2 - 18,
    };
  }

  /** Quadratische Bézier-Kante, an den Knotenrändern abgeschnitten (Pfeil sichtbar). */
  function trimmedEdgePath(fromNode, toNode, trimR) {
    const p0 = { x: fromNode.x, y: fromNode.y };
    const cp = edgeControlPoint(fromNode, toNode);
    const p2 = { x: toNode.x, y: toNode.y };
    const dx0 = cp.x - p0.x;
    const dy0 = cp.y - p0.y;
    const len0 = Math.hypot(dx0, dy0);
    const dx1 = p2.x - cp.x;
    const dy1 = p2.y - cp.y;
    const len1 = Math.hypot(dx1, dy1);
    if (len0 < 1e-6 || len1 < 1e-6) {
      return "M " + p0.x + " " + p0.y + " L " + p2.x + " " + p2.y;
    }
    const start = { x: p0.x + (dx0 / len0) * trimR, y: p0.y + (dy0 / len0) * trimR };
    const end = { x: p2.x - (dx1 / len1) * trimR, y: p2.y - (dy1 / len1) * trimR };
    if (Math.hypot(p2.x - p0.x, p2.y - p0.y) <= trimR * 2 + 2) {
      const mx = (start.x + end.x) / 2;
      const my = (start.y + end.y) / 2 - 6;
      return "M " + start.x + " " + start.y + " Q " + mx + " " + my + " " + end.x + " " + end.y;
    }
    return "M " + start.x + " " + start.y + " Q " + cp.x + " " + cp.y + " " + end.x + " " + end.y;
  }

  /** Stützpunkte entlang der sichtbaren quadratischen Bézier-Kanten (wie edge-line). */
  function pathBezierSamplePoints(edgeIndices, samplesPerEdge) {
    const pts = [];
    if (!edgeIndices || edgeIndices.length === 0) return pts;
    const nSample = samplesPerEdge || 12;

    for (let i = 0; i < edgeIndices.length; i++) {
      const e = G.edges[edgeIndices[i]];
      if (!e) continue;
      const su = nodeCenterById(e.from);
      const sv = nodeCenterById(e.to);
      if (!su || !sv) continue;
      const cp = edgeControlPoint(su, sv);
      const startS = i === 0 ? 0 : 1;
      for (let s = startS; s <= nSample; s++) {
        pts.push(quadraticBezierPoint(su, cp, sv, s / nSample));
      }
    }
    return pts;
  }

  const ATOMIC_DELAY_KINDS = [
    { v: "affine", l: "affin a·x+b" },
    { v: "poly", l: "Polynom (nichtneg.)" },
    { v: "exp", l: "exp α·e^{x/β}+γ" },
    { v: "mm1", l: "M/M/1 1/(μ−x)" },
  ];

  const EDGE_DELAY_KINDS = ATOMIC_DELAY_KINDS.concat([
    { v: "max", l: "max{p, q}" },
  ]);

  function defaultDelaySpec(kind) {
    if (kind === "affine") return { kind: "affine", a: 0.5, b: 1 };
    if (kind === "poly") return { kind: "poly", coeffs: [1, 0.5, 0.1] };
    if (kind === "exp") return { kind: "exp", alpha: 0.5, beta: 4, gamma: 1 };
    if (kind === "mm1") return { kind: "mm1", mu: 25 };
    return {
      kind: "max",
      left: { kind: "poly", coeffs: [1, 0.35, 0.05] },
      right: { kind: "exp", alpha: 0.5, beta: 5, gamma: 1 },
    };
  }

  function randomAtomicDelaySpec() {
    const r = Math.random();
    if (r < 0.4) {
      return {
        kind: "affine",
        a: 0.05 + Math.random() * 1.2,
        b: 0.4 + Math.random() * 3.5,
      };
    }
    if (r < 0.7) {
      const c0 = 0.4 + Math.random() * 1.4;
      const c1 = 0.15 + Math.random() * 1.2;
      const c2 = Math.random() * 0.35;
      return { kind: "poly", coeffs: [c0, c1, c2] };
    }
    if (r < 0.88) {
      return {
        kind: "exp",
        alpha: 0.25 + Math.random() * 0.75,
        beta: 3 + Math.random() * 5,
        gamma: 0.4 + Math.random() * 1.6,
      };
    }
    // M/M/1: μ deutlich über typischer Last (Anzahl der Spielendenn ca. 10 bis 20)
    return { kind: "mm1", mu: 18 + Math.random() * 22 };
  }

  function randomDelaySpec() {
    if (Math.random() < 0.12) {
      return {
        kind: "max",
        left: randomAtomicDelaySpec(),
        right: randomAtomicDelaySpec(),
      };
    }
    return randomAtomicDelaySpec();
  }

  function cloneDelaySpec(spec) {
    return JSON.parse(JSON.stringify(spec));
  }

  function directEdgeKey(fromId, toId) {
    return fromId + ">" + toId;
  }

  /** Entfernt Kanten, die einen Commodity-Startknoten direkt mit dem Zielknoten verbinden. */
  function stripDirectSourceSinkEdges(edgeList, commodityList) {
    const forbid = new Set();
    for (let i = 0; i < commodityList.length; i++) {
      const com = commodityList[i];
      forbid.add(directEdgeKey(com.sourceId, com.sinkId));
    }
    return edgeList.filter(function (e) {
      return !forbid.has(directEdgeKey(e.from, e.to));
    });
  }

  const DIDACTIC_ATOMIC_KINDS = ["affine", "poly", "exp", "mm1"];
  const DIDACTIC_EDGE_KINDS = DIDACTIC_ATOMIC_KINDS.concat(["max"]);

  /** Typische Kantenlast bei empfohlener Anzahl Spielender im Wardrop-Schritt (ca. 25). */
  function estimateDidacticLoadRef(nCommodities, nNodes) {
    const players = Math.min(25, Math.max(1, nCommodities));
    const estEdges = Math.max(14, nNodes - 1 + Math.round(nNodes * 1.8) + players * 5);
    return Math.max(0.6, Math.min(5, players / estEdges));
  }

  /**
   * Ein gemeinsames Kostenprofil pro Zufallsnetz: gleiche Basis c(xRef) und Steigung
   * für alle Funktionsklassen. Nur die Klasse variiert je Kante, nicht die Parameter.
   */
  function createDidacticSharedProfile(xRef) {
    const x = Math.max(0.1, xRef);
    const base = 1.12;
    const marginal = 0.095;
    return { x, base, marginal, cRef: base + marginal * x };
  }

  /** Wendet die Thesis-Parameteruntergrenzen auf eine didaktische Verzögerung an. */
  function applyDidacticParameterBounds(spec, edgeCount, fe) {
    const m = Math.max(1, edgeCount || 20);
    const iv = P.concentrationInterval(m, Math.max(0, fe));
    P.enforceDelayParameterBounds(spec, iv.m, iv.ue, THESIS_EPS);
    return spec;
  }

  /** Kalibrierte Verzögerung einer Funktionsklasse aus dem gemeinsamen Profil (ohne Zufallsstreuung). */
  function createDidacticDelayOfKind(kind, xRef, profile, edgeCount) {
    const p = profile || createDidacticSharedProfile(xRef);
    const x = p.x;
    const base = p.base;
    const marginal = p.marginal;
    const cRef = p.cRef;

    if (kind === "max") {
      const left = createDidacticDelayOfKind("affine", xRef, p, edgeCount);
      const right = createDidacticDelayOfKind("exp", xRef, p, edgeCount);
      if (P.ce(right, x) >= P.ce(left, x)) {
        right.alpha *= 0.55;
        right.gamma = Math.max(0.35, base * 0.75);
      }
      const out = { kind: "max", left, right };
      if (edgeCount != null) applyDidacticParameterBounds(out, edgeCount, xRef);
      return out;
    }
    const out =
      kind === "affine"
        ? { kind: "affine", a: marginal, b: base }
        : kind === "poly"
          ? (function () {
              const c2 = 0.022;
              const c1 = Math.max(0.03, marginal - 2 * c2 * x);
              const c0 = Math.max(0.45, cRef - c1 * x - c2 * x * x);
              return { kind: "poly", coeffs: [c0, c1, c2] };
            })()
          : kind === "exp"
            ? (function () {
                const beta = 7;
                const alpha = (marginal * beta) / Math.exp(x / beta);
                const gamma = Math.max(0.4, base - alpha * 0.85);
                return { kind: "exp", alpha, beta, gamma };
              })()
            : kind === "mm1"
              ? { kind: "mm1", mu: x + 1 / cRef + 0.08 }
              : createDidacticDelayOfKind("affine", xRef, p, edgeCount);
    if (edgeCount != null) applyDidacticParameterBounds(out, edgeCount, xRef);
    return out;
  }

  /** Skaliert c(xRef) um factor (alle Klassen), Form bleibt erhalten. */
  function scaleDidacticDelayAtRef(spec, factor, xRef) {
    const x = Math.max(0, xRef);
    const f = Math.max(0.2, factor);
    if (spec.kind === "affine") {
      return { kind: "affine", a: spec.a * f, b: spec.b * f };
    }
    if (spec.kind === "poly") {
      return {
        kind: "poly",
        coeffs: spec.coeffs.map(function (c) {
          return c * f;
        }),
      };
    }
    if (spec.kind === "exp") {
      return {
        kind: "exp",
        alpha: spec.alpha * f,
        beta: spec.beta,
        gamma: (spec.gamma || 0) * f,
      };
    }
    if (spec.kind === "mm1") {
      const d = spec.mu - x;
      if (d <= 1e-9) return cloneDelaySpec(spec);
      return { kind: "mm1", mu: x + d / f };
    }
    if (spec.kind === "max") {
      return {
        kind: "max",
        left: scaleDidacticDelayAtRef(spec.left, f, xRef),
        right: scaleDidacticDelayAtRef(spec.right, f, xRef),
      };
    }
    return cloneDelaySpec(spec);
  }

  /** Leichte Streuung um c(xRef) (relSpread z. B. 0.04 = ±4 %). */
  function jitterDidacticDelay(spec, relSpread, xRef) {
    const spread = relSpread == null ? 0.04 : relSpread;
    if (spread <= 0) return cloneDelaySpec(spec);
    const factor = 1 + (Math.random() * 2 - 1) * spread;
    return scaleDidacticDelayAtRef(spec, factor, xRef);
  }

  /** Jede Funktionsklasse mindestens einmal, Rest zufällig gemischt. */
  function buildDidacticKindSequence(minCount) {
    const seq = DIDACTIC_EDGE_KINDS.slice();
    while (seq.length < minCount) {
      seq.push(DIDACTIC_ATOMIC_KINDS[Math.floor(Math.random() * DIDACTIC_ATOMIC_KINDS.length)]);
    }
    for (let i = seq.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = seq[i];
      seq[i] = seq[j];
      seq[j] = tmp;
    }
    return seq;
  }

  /** Parallelpfade: identische affine Hop-Kosten aus dem gemeinsamen Profil. */
  function createDidacticParallelHopTemplate(xRef, profile, edgeCount) {
    return createDidacticDelayOfKind("affine", xRef, profile, edgeCount);
  }

  /** Teurer machen von Kettenkanten im OD-Korridor (ohne sie zu entfernen, Erreichbarkeit bleibt). */
  function penalizeBackboneCorridor(nodes, edges, si, ti, factor, xRef, penalizedKeys) {
    const f = Math.max(1, factor);
    for (let k = si; k < ti; k++) {
      const fromId = nodes[k].id;
      const toId = nodes[k + 1].id;
      const key = directEdgeKey(fromId, toId);
      if (penalizedKeys.has(key)) continue;
      penalizedKeys.add(key);
      for (let ei = 0; ei < edges.length; ei++) {
        const e = edges[ei];
        if (e.from === fromId && e.to === toId) {
          e.delay = scaleDidacticDelayAtRef(e.delay, f, xRef);
          break;
        }
      }
    }
  }

  /** Prüft, ob für jede Commodity ein s–t-Pfad existiert (über Wardrop-Pfadenumeration). */
  function commoditiesHavePaths(nodes, edges, commodities) {
    if (!commodities.length) return false;
    const res = P.computeWardrop(nodes, edges, commodities);
    return !!(res && res.ok);
  }

  function pathLatencyAtLoads(pathEi, edgeList, loads) {
    let sum = 0;
    for (let i = 0; i < pathEi.length; i++) {
      sum += P.ce(edgeList[pathEi[i]].delay, loads[pathEi[i]]);
    }
    return sum;
  }

  /** Anzahl Commodities mit mindestens minActive Pfaden mit positivem Wardrop-Fluss. */
  function countCommoditiesWithPathSplit(nodes, edges, commodities, minActive) {
    const need = minActive == null ? 2 : minActive;
    const res = P.computeWardrop(nodes, edges, commodities);
    if (!res.ok || !res.h) return 0;
    let count = 0;
    for (let k = 0; k < res.h.length; k++) {
      let active = 0;
      for (let p = 0; p < res.h[k].length; p++) {
        if (res.h[k][p] > WARDROP_PATH_FLOW_TOL) active++;
      }
      if (active >= need) count++;
    }
    return count;
  }

  /** Größter Pfadanteil im Wardrop (Stichprobe) für didaktische Balance. */
  function wardropMaxPathShare(nodes, edges, commodities) {
    const res = P.computeWardrop(nodes, edges, commodities);
    if (!res.ok || !res.h) return 1;
    let maxShare = 0;
    for (let k = 0; k < res.h.length; k++) {
      let commodityMax = 0;
      for (let p = 0; p < res.h[k].length; p++) {
        if (res.h[k][p] > commodityMax) commodityMax = res.h[k][p];
      }
      if (commodityMax > maxShare) maxShare = commodityMax;
    }
    return maxShare;
  }

  /**
   * Skaliert Kantenverzögerungen entlang konkurrierender Pfade, bis mehrere Routen
   * im Wardrop nahezu gleich teuer sind (fraktionale Pfadanteile statt 100 %).
   */
  function balanceWardropPathShares(nodes, edges, commodities, opts) {
    opts = opts || {};
    const targetMax =
      opts.targetMaxShare != null ? opts.targetMaxShare : 0.62;
    const maxRounds = opts.maxRounds != null ? opts.maxRounds : 20;
    const xRef =
      opts.xRef != null
        ? opts.xRef
        : estimateDidacticLoadRef(commodities.length, nodes.length);

    let lastRes = null;
    for (let round = 0; round < maxRounds; round++) {
      const res = P.computeWardrop(nodes, edges, commodities);
      if (!res.ok) return { ok: false, maxShare: 1, rounds: round, wardrop: null };
      lastRes = res;

      let globalMax = 0;
      let changed = false;
      const loads = res.fEdge;

      for (let k = 0; k < commodities.length; k++) {
        let kMax = 0;
        for (let p = 0; p < res.h[k].length; p++) {
          if (res.h[k][p] > kMax) kMax = res.h[k][p];
        }
        if (kMax > globalMax) globalMax = kMax;
        if (kMax <= targetMax) continue;

        let bestP = -1;
        let bestLat = Infinity;
        for (let p = 0; p < res.pathLists[k].length; p++) {
          const lat = pathLatencyAtLoads(res.pathLists[k][p], edges, loads);
          if (lat < bestLat) {
            bestLat = lat;
            bestP = p;
          }
        }
        if (bestP < 0) continue;

        let secondP = -1;
        let secondLat = Infinity;
        for (let p = 0; p < res.pathLists[k].length; p++) {
          if (p === bestP) continue;
          const lat = pathLatencyAtLoads(res.pathLists[k][p], edges, loads);
          if (lat < secondLat) {
            secondLat = lat;
            secondP = p;
          }
        }
        if (secondP < 0) continue;

        const dom = new Set(res.pathLists[k][bestP]);
        const sec = new Set(res.pathLists[k][secondP]);

        if (secondLat > bestLat + 1e-9) {
          for (const ei of res.pathLists[k][secondP]) {
            if (dom.has(ei)) continue;
            edges[ei].delay = scaleDidacticDelayAtRef(edges[ei].delay, 0.965, xRef);
            changed = true;
          }
        }
        if (kMax > 0.82) {
          for (const ei of res.pathLists[k][bestP]) {
            if (sec.has(ei)) continue;
            edges[ei].delay = scaleDidacticDelayAtRef(edges[ei].delay, 1.035, xRef);
            changed = true;
          }
        }
      }

      if (globalMax <= targetMax || !changed) {
        return { ok: true, maxShare: globalMax, rounds: round + 1, wardrop: res };
      }
    }

    const finalShare = wardropMaxPathShare(nodes, edges, commodities);
    return {
      ok: finalShare <= targetMax + 0.04,
      maxShare: finalShare,
      rounds: maxRounds,
      wardrop: lastRes,
    };
  }

  /**
   * Legt je Commodity bis zu drei parallele Routen mit identischen Hop-Kosten an,
   * damit im Wardrop-Fluss typischerweise fraktionale Pfadanteile entstehen.
   */
  function addDidacticParallelRoutes(nodes, edges, seen, commodity, hopTemplate) {
    const si = nodes.findIndex((n) => n.id === commodity.sourceId);
    const ti = nodes.findIndex((n) => n.id === commodity.sinkId);
    if (si < 0 || ti < 0 || ti <= si + 1) return;

    const gap = ti - si;
    const rot = (si * 5 + ti * 11) % Math.max(1, gap - 2);
    const inner = [];
    for (let m = si + 1; m < ti; m++) inner.push(m);
    if (inner.length < 1) return;
    const mids = [];
    const seenMid = new Set();
    const want = Math.min(3, inner.length);
    for (let i = 0; i < want; i++) {
      const idx = (rot + Math.round(((i + 1) * inner.length) / (want + 1))) % inner.length;
      const m = inner[idx];
      if (seenMid.has(m)) continue;
      seenMid.add(m);
      mids.push(m);
    }
    if (!mids.length) return;

    const hopDelay = cloneDelaySpec(hopTemplate);

    function putEdge(fromId, toId, delay) {
      const key = directEdgeKey(fromId, toId);
      if (fromId === toId || seen.has(key)) return;
      seen.add(key);
      edges.push({
        id: eid(),
        from: fromId,
        to: toId,
        delay: cloneDelaySpec(delay),
      });
    }

    const sId = nodes[si].id;
    const tId = nodes[ti].id;
    for (let i = 0; i < mids.length; i++) {
      const mid = mids[i];
      putEdge(sId, nodes[mid].id, hopDelay);
      putEdge(nodes[mid].id, tId, hopDelay);
    }
  }

  function estimateFeForEdge(ei) {
    const m = Math.max(1, G.edges.length);
    if (pipeline.wardrop?.ok && pipeline.wardrop.fEdge)
      return { fe: pipeline.wardrop.fEdge[ei] || 0, estimated: false };
    if (wardropValidationPreview?.ok && wardropValidationPreview.fEdge)
      return { fe: wardropValidationPreview.fEdge[ei] || 0, estimated: false };
    const n = Math.max(1, G.commodities.length);
    return { fe: n / m, estimated: true };
  }

  function edgeValidationCtx(ei) {
    const m = G.edges.length;
    const { fe, estimated } = estimateFeForEdge(ei);
    const iv = P.concentrationInterval(m, fe);
    return {
      m: iv.m,
      L: iv.L,
      le: iv.le,
      ue: iv.ue,
      fe,
      feEstimated: estimated,
      eps: THESIS_EPS,
      ei,
    };
  }

  function delayParamsWithinBounds(spec, ctx) {
    const b = P.delayParameterBounds(spec, ctx.m, ctx.ue, ctx.eps);
    if (spec.kind === "affine")
      return (
        spec.a >= P.effectiveBoundMin(b.a.min) - 1e-9 &&
        spec.b >= P.effectiveBoundMin(b.b.min) - 1e-9
      );
    if (spec.kind === "poly")
      return (
        spec.coeffs[0] >= P.effectiveBoundMin(b.a0.min) - 1e-9 &&
        spec.coeffs[1] >= P.effectiveBoundMin(b.a1.min) - 1e-9 &&
        spec.coeffs[2] >= P.effectiveBoundMin(b.a2.min) - 1e-9
      );
    if (spec.kind === "exp")
      return (
        spec.alpha >= P.effectiveBoundMin(b.alpha.min) - 1e-9 &&
        spec.beta >= P.effectiveBoundMin(b.beta.min) - 1e-9 &&
        (spec.gamma || 0) >= P.effectiveBoundMin(b.gamma.min) - 1e-9
      );
    if (spec.kind === "mm1")
      return spec.mu >= P.effectiveBoundMin(b.mu.min) - 1e-9;
    if (spec.kind === "max")
      return (
        delayParamsWithinBounds(spec.left, ctx) &&
        delayParamsWithinBounds(spec.right, ctx)
      );
    return true;
  }

  function enforceEdgeDelay(delay, ctx) {
    P.enforceDelayParameterBounds(delay, ctx.m, ctx.ue, ctx.eps);
  }

  function edgeDelayThesisValid(spec, ctx) {
    if (ctx.fe <= 1e-9) return true;
    const band = P.checkBandOnInterval(spec, ctx.fe, ctx.le, ctx.ue, ctx.eps);
    return band.ok && delayParamsWithinBounds(spec, ctx);
  }

  function replaceDelaySpec(spec, next) {
    for (const key of Object.keys(spec)) delete spec[key];
    Object.assign(spec, next);
  }

  /** Konstante affine Verzögerung, die Parameter- und Bandbedingung erfüllt. */
  function constantThesisDelay(ctx) {
    const tmp = { kind: "affine", a: 0, b: 1.5 };
    P.enforceDelayParameterBounds(tmp, ctx.m, ctx.ue, ctx.eps);
    const bnd = P.delayParameterBounds(tmp, ctx.m, ctx.ue, ctx.eps);
    return { kind: "affine", a: 0, b: Math.max(1.2, bnd.b.min) };
  }

  /** Eine Flatten-Stufe: Verzögerung flacher machen, c(f_e) näherungsweise erhalten. */
  function flattenDelayStep(spec, ctx) {
    const fe = Math.max(0, ctx.fe);
    if (spec.kind === "max") {
      flattenDelayStep(spec.left, ctx);
      flattenDelayStep(spec.right, ctx);
      return;
    }
    if (spec.kind === "affine") {
      spec.a *= 0.82;
      const cf = P.ce(spec, fe);
      spec.b = Math.max(0.05, cf - spec.a * fe);
      return;
    }
    if (spec.kind === "poly") {
      if (!spec.coeffs) spec.coeffs = [1, 0, 0];
      spec.coeffs[1] = (spec.coeffs[1] || 0) * 0.82;
      spec.coeffs[2] = (spec.coeffs[2] || 0) * 0.82;
      const cf = P.ce(spec, fe);
      spec.coeffs[0] = Math.max(
        0.05,
        cf - (spec.coeffs[1] || 0) * fe - (spec.coeffs[2] || 0) * fe * fe
      );
      return;
    }
    if (spec.kind === "exp") {
      spec.beta = (spec.beta || 1) * 1.14;
      spec.alpha = (spec.alpha || 0) * 0.86;
      return;
    }
    if (spec.kind === "mm1") {
      spec.mu = Math.max(spec.mu * 1.1, ctx.ue + 4, fe + 8);
    }
  }

  /**
   * Passt eine Verzögerung an, bis Band- und Parameterbedingung (Bachelorarbeit) gelten.
   * Mutiert spec in place.
   */
  function repairEdgeDelayForThesis(spec, ctx) {
    if (ctx.fe <= 1e-9) {
      P.enforceDelayParameterBounds(spec, ctx.m, ctx.ue, ctx.eps);
      return;
    }
    for (let pass = 0; pass < 96; pass++) {
      P.enforceDelayParameterBounds(spec, ctx.m, ctx.ue, ctx.eps);
      if (spec.kind === "max") {
        repairEdgeDelayForThesis(spec.left, ctx);
        repairEdgeDelayForThesis(spec.right, ctx);
        P.enforceDelayParameterBounds(spec, ctx.m, ctx.ue, ctx.eps);
      }
      if (edgeDelayThesisValid(spec, ctx)) return;
      if (spec.kind === "max" && pass >= 8) {
        replaceDelaySpec(spec, constantThesisDelay(ctx));
        P.enforceDelayParameterBounds(spec, ctx.m, ctx.ue, ctx.eps);
        if (edgeDelayThesisValid(spec, ctx)) return;
        continue;
      }
      flattenDelayStep(spec, ctx);
    }
    replaceDelaySpec(spec, constantThesisDelay(ctx));
    P.enforceDelayParameterBounds(spec, ctx.m, ctx.ue, ctx.eps);
  }

  /**
   * Berechnet Wardrop für die aktuelle Instanz neu (Frank-Wolfe, ohne Iterations-Trace).
   * Ergebnis dient $f_e$, $[l_e,u_e]$ und Bandprüfung im Instanz-Editor.
   */
  function refreshWardropValidationPreview() {
    if (!G.edges.length || !G.commodities.length) {
      wardropValidationPreview = null;
      return null;
    }
    wardropValidationPreview = P.computeWardrop(G.nodes, G.edges, G.commodities);
    return wardropValidationPreview;
  }

  /**
   * Stellt sicher, dass im Zufallsnetz jede Kante mit f_e > 0 die Bandbedingung erfüllt.
   * Wardrop wird pro Runde neu berechnet, da sich f_e nach der Anpassung verschieben kann.
   * @returns {{ ok: boolean, rounds: number, edgesRepaired: number, failedEdges: number }}
   */
  function ensureRandomNetworkThesisValidDelays() {
    if (!isRandomNetworkInstance) {
      return { ok: true, rounds: 0, edgesRepaired: 0, failedEdges: 0 };
    }
    const maxRounds = 10;
    const syncPipelineWardrop =
      pipelineWardropCompleted ||
      pipelineAsideStep >= 3 ||
      currentStep >= 3 ||
      !!(pipeline.wardrop && pipeline.wardrop.ok);
    let edgesRepaired = 0;

    for (let round = 0; round < maxRounds; round++) {
      const res = P.computeWardrop(G.nodes, G.edges, G.commodities);
      if (!res.ok) {
        return { ok: false, rounds: round, edgesRepaired, failedEdges: -1 };
      }
      wardropValidationPreview = res;
      if (syncPipelineWardrop) pipeline.wardrop = res;

      let changed = false;
      G.edges.forEach(function (e, ei) {
        const ctx = edgeValidationCtx(ei);
        const before = JSON.stringify(e.delay);
        repairEdgeDelayForThesis(e.delay, ctx);
        if (JSON.stringify(e.delay) !== before) {
          changed = true;
          edgesRepaired++;
        }
      });
      if (!changed) {
        let failedEdges = 0;
        G.edges.forEach(function (e, ei) {
          const ctx = edgeValidationCtx(ei);
          if (ctx.fe > 1e-9 && !edgeDelayThesisValid(e.delay, ctx)) failedEdges++;
        });
        return {
          ok: failedEdges === 0,
          rounds: round + 1,
          edgesRepaired,
          failedEdges,
        };
      }
    }

    let failedEdges = 0;
    G.edges.forEach(function (e, ei) {
      const ctx = edgeValidationCtx(ei);
      if (ctx.fe > 1e-9 && !edgeDelayThesisValid(e.delay, ctx)) failedEdges++;
    });
    return {
      ok: failedEdges === 0,
      rounds: maxRounds,
      edgesRepaired,
      failedEdges,
    };
  }

  function superscriptDigit(i) {
    return i === 2 ? "²" : i === 3 ? "³" : "^" + i;
  }

  function delayLabel(d) {
    if (d.kind === "affine") return d.a.toFixed(2) + "·x+" + d.b.toFixed(2);
    if (d.kind === "poly") {
      const terms = [];
      for (let i = 0; i < d.coeffs.length; i++) {
        const c = d.coeffs[i];
        if (i === 0) terms.push(c.toFixed(2));
        else if (i === 1) terms.push(c.toFixed(2) + "·x");
        else terms.push(c.toFixed(2) + "·x" + superscriptDigit(i));
      }
      return terms.join("+");
    }
    if (d.kind === "exp") {
      const g = d.gamma || 0;
      return (
        d.alpha.toFixed(2) +
        "·e^{x/" +
        d.beta.toFixed(2) +
        "}" +
        (g > 1e-9 ? "+" + g.toFixed(2) : "")
      );
    }
    if (d.kind === "mm1") return "1/(" + d.mu.toFixed(2) + "−x)";
    if (d.kind === "max")
      return "max{" + delayLabel(d.left) + "," + delayLabel(d.right) + "}";
    return "?";
  }

  function generateRandomNetwork(retryDepth) {
    if (pipelineLocked) return;
    const regenDepth = retryDepth == null ? 0 : retryDepth;
    if (regenDepth > 8) {
      logLine(
        "Fehler: Zufallsnetz konnte nicht mit durchgängiger Erreichbarkeit erzeugt werden."
      );
      return;
    }
    resetPipelineInteractiveState();
    randomNetworkEndpointPool = null;
    randomNetworkBlueprints = null;
    randomNetworkDidacticProfile = null;

    const nCount = 11 + Math.floor(Math.random() * 6);
    const layoutW = 780;
    const layoutH = 400;
    const numCom = DEMO_COMMODITY_MAX;
    const xRef = estimateDidacticLoadRef(DEFAULT_PLAYER_COUNT, nCount);
    const didacticProfile = createDidacticSharedProfile(xRef);
    randomNetworkDidacticProfile = didacticProfile;
    /** Kettenkanten außerhalb der OD-Korridore etwas teurer. */
    const BACKBONE_COST_FACTOR = 1.15;
    /** Zusätzliche Verteuerung der Backbone-Kette zwischen Start und Ziel je OD-Paar. */
    const CORRIDOR_BACKBONE_FACTOR = 1.42;
    const WARDROP_SHARE_LIMIT = 0.62;
    const MIN_SPLIT_COMMODITIES = Math.min(2, DEFAULT_PLAYER_COUNT);
    const MAX_ATTEMPTS = 16;
    const estEdgeCount = Math.max(24, nCount - 1 + MAX_DISTINCT_ENDPOINTS * MAX_DISTINCT_ENDPOINTS * 6);

    let nodes;
    let edges;
    let commodities;
    let attempt;

    for (attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      resetIdSequences();
      nodes = placeRandomNonOverlappingNodes(nCount, layoutW, layoutH);
      nodes.sort((a, b) => a.x - b.x);

      edges = [];
      const seen = new Set();
      const hopTemplate = createDidacticParallelHopTemplate(xRef, didacticProfile, estEdgeCount);
      const kindSeq = buildDidacticKindSequence(96);
      let kindSeqIdx = 0;
      const corridorPenalized = new Set();

      function nextEdgeKind() {
        const k = kindSeq[kindSeqIdx % kindSeq.length];
        kindSeqIdx++;
        return k;
      }

      function makeEdgeDelay(role) {
        if (role === "parallel") {
          return cloneDelaySpec(hopTemplate);
        }
        let delay = createDidacticDelayOfKind(nextEdgeKind(), xRef, didacticProfile, estEdgeCount);
        if (role === "backbone") {
          delay = scaleDidacticDelayAtRef(delay, BACKBONE_COST_FACTOR, xRef);
        }
        return delay;
      }

      function addEdge(fromId, toId, role) {
        const key = directEdgeKey(fromId, toId);
        if (fromId === toId || seen.has(key)) return;
        seen.add(key);
        edges.push({
          id: eid(),
          from: fromId,
          to: toId,
          delay: makeEdgeDelay(role),
        });
      }

      for (let i = 0; i < nCount - 1; i++) addEdge(nodes[i].id, nodes[i + 1].id, "backbone");

      const endpointPool = pickEndpointPool(
        nodes,
        nCount,
        seen,
        MAX_DISTINCT_ENDPOINTS
      );
      if (!endpointPool || endpointPool.validPairs < 1) continue;

      commodities = [];
      const poolPairs = [];
      for (let a = 0; a < endpointPool.srcIndices.length; a++) {
        for (let b = 0; b < endpointPool.sinkIndices.length; b++) {
          const si = endpointPool.srcIndices[a];
          const ti = endpointPool.sinkIndices[b];
          if (si >= ti - 2) continue;
          const sId = nodes[si].id;
          const tId = nodes[ti].id;
          if (seen.has(directEdgeKey(sId, tId))) continue;
          poolPairs.push({ sourceId: sId, sinkId: tId });
          addDidacticParallelRoutes(
            nodes,
            edges,
            seen,
            { sourceId: sId, sinkId: tId },
            hopTemplate
          );
          penalizeBackboneCorridor(
            nodes,
            edges,
            si,
            ti,
            CORRIDOR_BACKBONE_FACTOR,
            xRef,
            corridorPenalized
          );
        }
      }

      const allAssignments = assignCommodityEndpointPairs(
        endpointPool.sources,
        endpointPool.sinks,
        numCom
      );
      for (let c = 0; c < allAssignments.length; c++) {
        const pair = allAssignments[c];
        commodities.push({
          id: "c" + (c + 1),
          sourceId: pair.sourceId,
          sinkId: pair.sinkId,
        });
      }

      const strippedEdges = stripDirectSourceSinkEdges(edges, commodities);
      edges = strippedEdges.slice();

      const testAssignments = assignCommodityEndpointPairs(
        endpointPool.sources,
        endpointPool.sinks,
        DEFAULT_PLAYER_COUNT
      );
      const testCom = testAssignments.map(function (p, i) {
        return {
          id: "c" + (i + 1),
          sourceId: p.sourceId,
          sinkId: p.sinkId,
        };
      });
      if (!commoditiesHavePaths(nodes, edges, testCom)) continue;

      balanceWardropPathShares(nodes, edges, testCom, {
        targetMaxShare: WARDROP_SHARE_LIMIT,
        xRef: xRef,
      });
      if (!commoditiesHavePaths(nodes, edges, testCom)) continue;

      const maxShare = wardropMaxPathShare(nodes, edges, testCom);
      const splitCount = countCommoditiesWithPathSplit(nodes, edges, testCom, 2);
      if (
        maxShare <= WARDROP_SHARE_LIMIT &&
        splitCount >= MIN_SPLIT_COMMODITIES
      ) {
        randomNetworkEndpointPool = {
          sources: endpointPool.sources.slice(),
          sinks: endpointPool.sinks.slice(),
        };
        refreshRandomNetworkBlueprintsFromPool(numCom);
        break;
      }
      if (attempt === MAX_ATTEMPTS - 1 && commoditiesHavePaths(nodes, edges, testCom)) {
        randomNetworkEndpointPool = {
          sources: endpointPool.sources.slice(),
          sinks: endpointPool.sinks.slice(),
        };
        refreshRandomNetworkBlueprintsFromPool(numCom);
        break;
      }
    }

    if (!randomNetworkEndpointPool) {
      randomNetworkBlueprints = [];
    }
    G = { nodes, edges, commodities: buildCommoditiesFromBlueprints(DEFAULT_PLAYER_COUNT) };
    isRandomNetworkInstance = true;
    wardropValidationPreview = null;
    if (!commoditiesHavePaths(G.nodes, G.edges, G.commodities)) {
      logLine(
        "Warnung: Keine vollständige Erreichbarkeit nach der Erzeugung. Es wird ein weiterer Versuch gestartet."
      );
      generateRandomNetwork(regenDepth + 1);
      return;
    }
    balanceWardropPathShares(G.nodes, G.edges, G.commodities, {
      targetMaxShare: WARDROP_SHARE_LIMIT,
      xRef: xRef,
    });
    ensureRandomNetworkThesisValidDelays();
    pipeline = {
      wardrop: null,
      decomp: null,
      rounded: null,
      stepDone: [false, false, false, false, false, false],
    };
    pipelineWardropCompleted = false;
    resetPipelineInteractiveState();
    renderAll();
    logLine(
      "Neues Zufallsnetz: " +
        nCount +
        " Knoten, " +
        edges.length +
        " Kanten, " +
        G.commodities.length +
        " Commodities (alle Funktionsklassen mit gemeinsamem Parameterprofil, bis zu drei Parallelpfade je OD-Paar)."
    );
    zoomToGraphContent(1.06);
  }

  function resetPipelineInteractiveState() {
    pipelineInteractive = null;
    pipelineFwIdx = -1;
    pipelineWardropTrace = null;
    pipelineWardropCommodityIdx = -1;
    pipelineDecompReveal = 0;
    pipelineRoundActive = false;
    pipelineRoundSteps = null;
    pipelineRoundChosen = null;
    pipelineRoundRevealed = 0;
    pipelineCheckAttempt = 0;
    pipelineCheckResult = null;
    stopCommodityPulse();
    stopRelaxDemo();
  }

  function resetPipelineComputationForNewRun() {
    pipeline.wardrop = null;
    pipeline.decomp = null;
    pipeline.rounded = null;
    pipeline.stepDone = [false, false, false, false, false, false];
    pipelineWardropCompleted = false;
    resetPipelineInteractiveState();
  }

  function computeGraphTutorialHighlight() {
    const emptyTh = () => ({
      edgeStrong: new Set(),
      edgeSoft: new Set(),
      edgeDiscrete: new Set(),
      edgeRelaxedA: new Set(),
      edgeRelaxedB: new Set(),
      sources: new Set(),
      sinks: new Set(),
      relaxEdgeShares: new Map(),
      relaxDemo: false,
      showCommodityNodes: false,
      dimUnused: false,
      fwPulse: false,
      wardropPaths: [],
      wardropEdgePathIdx: new Map(),
      wardropCommodityFocus: false,
      decompFocus: false,
      decompCommodityIdx: -1,
      decompPickEdge: new Set(),
      decompRem: null,
    });

    if (pipelineLocked) {
      const th = emptyTh();
      if (pipelineAsideStep >= 1) {
        th.showCommodityNodes = true;
        for (let ci = 0; ci < G.commodities.length; ci++) {
          const c = G.commodities[ci];
          if (c.sourceId) th.sources.add(c.sourceId);
          if (c.sinkId) th.sinks.add(c.sinkId);
        }
      }
      if (shouldRunRelaxDemo()) {
        ensureRelaxDemoDataFresh();
        if (pipelineRelaxDemoData) {
          th.relaxDemo = true;
          th.dimUnused = true;
          th.sources.clear();
          th.sinks.clear();
          th.sources.add(pipelineRelaxDemoData.sourceId);
          th.sinks.add(pipelineRelaxDemoData.sinkId);
          if (pipelineRelaxDemoPhase === "discrete") {
            for (let j = 0; j < pipelineRelaxDemoData.pathDiscrete.length; j++) {
              const e = G.edges[pipelineRelaxDemoData.pathDiscrete[j]];
              if (e) th.edgeDiscrete.add(e.id);
            }
          } else {
            const split0 = pipelineRelaxDemoData.relaxedSplit[0];
            const split1 = pipelineRelaxDemoData.relaxedSplit[1];
            for (let j = 0; j < split0.edges.length; j++) {
              const e = G.edges[split0.edges[j]];
              if (e) {
                th.edgeRelaxedA.add(e.id);
                th.relaxEdgeShares.set(e.id, split0.share);
              }
            }
            for (let j = 0; j < split1.edges.length; j++) {
              const e = G.edges[split1.edges[j]];
              if (e) {
                th.edgeRelaxedB.add(e.id);
                if (!th.relaxEdgeShares.has(e.id)) th.relaxEdgeShares.set(e.id, split1.share);
              }
            }
          }
        }
      }
      if (
        pipelineInteractive === "decomp" &&
        pipeline.decomp &&
        pipeline.decomp.ok &&
        pipeline.decomp.steps &&
        pipelineDecompReveal > 0
      ) {
        th.dimUnused = true;
        th.decompFocus = true;
        const steps = pipeline.decomp.steps;
        const idx = Math.min(Math.max(pipelineDecompReveal - 1, 0), steps.length - 1);
        const cur = steps[idx];
        const beforeState = computeDecompRemBeforeStep(pipelineDecompReveal);
        if (cur && beforeState) {
          th.decompCommodityIdx = cur.commodityIndex;
          th.decompRem = beforeState.rem[cur.commodityIndex];
          const com = G.commodities[cur.commodityIndex];
          th.sources.clear();
          th.sinks.clear();
          if (com) {
            if (com.sourceId) th.sources.add(com.sourceId);
            if (com.sinkId) th.sinks.add(com.sinkId);
          }
          for (let i = 0; i < idx; i++) {
            const st = steps[i];
            if (!st || !st.edges || st.commodityIndex !== cur.commodityIndex) continue;
            for (let j = 0; j < st.edges.length; j++) {
              const ei = st.edges[j];
              const e = G.edges[ei];
              if (e) th.edgeSoft.add(e.id);
            }
          }
          if (cur.edges) {
            for (let j = 0; j < cur.edges.length; j++) {
              const ei = cur.edges[j];
              const e = G.edges[ei];
              if (e) th.edgeStrong.add(e.id);
            }
          }
          const pickEi =
            typeof cur.pickEdgeIndex === "number" ? cur.pickEdgeIndex : cur.edges[0];
          if (typeof pickEi === "number") {
            const pe = G.edges[pickEi];
            if (pe) th.decompPickEdge.add(pe.id);
          }
        }
      }
      if (
        pipelineInteractive === "round" &&
        pipelineRoundActive &&
        pipelineRoundSteps &&
        pipelineRoundRevealed > 0
      ) {
        th.dimUnused = true;
        const last = pipelineRoundRevealed - 1;
        for (let i = 0; i < pipelineRoundRevealed; i++) {
          const st = pipelineRoundSteps[i];
          if (!st || !st.pathEdges) continue;
          for (let j = 0; j < st.pathEdges.length; j++) {
            const ei = st.pathEdges[j];
            const e = G.edges[ei];
            if (!e) continue;
            if (i === last) th.edgeStrong.add(e.id);
            else th.edgeSoft.add(e.id);
          }
        }
      }
      if (pipelineInteractive === "interval_check" && pipeline.rounded) {
        th.dimUnused = true;
        for (let pi = 0; pi < pipeline.rounded.length; pi++) {
          const pe = pipeline.rounded[pi];
          for (let j = 0; j < pe.length; j++) {
            const e = G.edges[pe[j]];
            if (e) th.edgeStrong.add(e.id);
          }
        }
        if (pipelineCheckResult && !pipelineCheckResult.ok) {
          for (let i = 0; i < pipelineCheckResult.edges.length; i++) {
            const row = pipelineCheckResult.edges[i];
            if (!row.ok) {
              const e = G.edges[row.ei];
              if (e) th.decompPickEdge.add(e.id);
            }
          }
        }
      }
      if (
        pipelineLocked &&
        pipelineInteractive === null &&
        pipeline.rounded &&
        ((pipelineAsideStep === 5 && pipelineIntroSlide >= PIPELINE_STEP5_SUCCESS_SLIDE) ||
          (pipelineAsideStep === 7 &&
            (pipelineIntroSlide === PIPELINE_STEP7_CHECKER_SLIDE ||
              pipelineIntroSlide === PIPELINE_STEP7_WHY_SUCCESS_SLIDE)))
      ) {
        th.dimUnused = true;
        for (let pi = 0; pi < pipeline.rounded.length; pi++) {
          const pe = pipeline.rounded[pi];
          for (let j = 0; j < pe.length; j++) {
            const e = G.edges[pe[j]];
            if (e) th.edgeStrong.add(e.id);
          }
        }
      }
      if (
        pipelineInteractive === "wardrop_fw" &&
        pipelineWardropTrace &&
        pipelineFwIdx >= 0
      ) {
        th.fwPulse = true;
      }
      if (shouldShowWardropCommodityExplorer() && pipelineWardropCommodityIdx >= 0) {
        th.dimUnused = true;
        th.wardropCommodityFocus = true;
        th.sources.clear();
        th.sinks.clear();
        const c = G.commodities[pipelineWardropCommodityIdx];
        if (c) {
          if (c.sourceId) th.sources.add(c.sourceId);
          if (c.sinkId) th.sinks.add(c.sinkId);
        }
        const paths = wardropPathsForCommodity(pipelineWardropCommodityIdx);
        th.wardropPaths = paths.map(function (p, i) {
          return {
            pathIndex: p.pathIndex,
            weight: p.weight,
            edgeEis: p.edgeEis,
            edgeIds: p.edgeIds,
            colorIdx: i % WARDROP_PATH_COLOR_COUNT,
          };
        });
        const edgeBest = new Map();
        for (let pi = 0; pi < th.wardropPaths.length; pi++) {
          const p = th.wardropPaths[pi];
          for (let j = 0; j < p.edgeIds.length; j++) {
            const eid = p.edgeIds[j];
            const cur = edgeBest.get(eid);
            if (!cur || p.weight > cur.weight) {
              edgeBest.set(eid, { colorIdx: p.colorIdx, weight: p.weight });
            }
          }
        }
        edgeBest.forEach(function (info, eid) {
          th.wardropEdgePathIdx.set(eid, info.colorIdx);
        });
      }
      return th;
    }

    const edgeStrong = new Set();
    const edgeSoft = new Set();
    const sources = new Set();
    const sinks = new Set();
    let dimUnused = false;
    let fwPulse = false;
    const showCommodityNodes = currentStep === 1;
    if (showCommodityNodes) {
      for (let ci = 0; ci < G.commodities.length; ci++) {
        const c = G.commodities[ci];
        if (c.sourceId) sources.add(c.sourceId);
        if (c.sinkId) sinks.add(c.sinkId);
      }
    }
    return {
      edgeStrong,
      edgeSoft,
      edgeDiscrete: new Set(),
      edgeRelaxedA: new Set(),
      edgeRelaxedB: new Set(),
      sources,
      sinks,
      relaxEdgeShares: new Map(),
      relaxDemo: false,
      showCommodityNodes,
      dimUnused,
      fwPulse,
      wardropPaths: [],
      wardropEdgePathIdx: new Map(),
      wardropCommodityFocus: false,
      decompFocus: false,
      decompCommodityIdx: -1,
      decompPickEdge: new Set(),
      decompRem: null,
    };
  }

  function syncPipelineGraphHint() {
    const gh = document.getElementById("graph-hint");
    const plotKind = pipelineLocked ? plotKindForState() : null;
    const graphVisible = pipelineLocked && pipelineGraphZoomEnabled;
    const plotVisible = pipelineLocked && !!plotKind;
    document.body.classList.toggle("pipeline-graph-visible", graphVisible || plotVisible);
    if (!gh) return;
    if (!pipelineLocked) {
      gh.hidden = false;
      gh.innerHTML = DEFAULT_GRAPH_HINT;
      return;
    }
    if (plotVisible || graphVisible) {
      gh.hidden = true;
      return;
    }
    gh.hidden = false;
    gh.textContent = PLOT_STAGE_HINT;
  }

  function applyPipelineChrome() {
    document.body.classList.toggle("app-pipeline-active", pipelineLocked);
    const aside = document.getElementById("pipeline-aside");
    const abort = document.getElementById("btn-pipeline-abort");
    if (pipelineLocked) {
      if (aside) aside.hidden = false;
      if (abort) abort.hidden = false;
    } else {
      if (aside) aside.hidden = true;
      if (abort) abort.hidden = true;
    }
    syncPipelineGraphHint();
    updateGraphPlayerCountControl();
  }

  function pipelineStepLabelText() {
    if (pipelineAsideStep === 1) return "Schritt 1: Diskretes Spiel";
    if (pipelineAsideStep === 2) return "Schritt 2: Relaxierung (MCFP)";
    if (pipelineAsideStep === 3) return "Schritt 3: Wardrop-Gleichgewicht";
    if (pipelineAsideStep === 4) return "Schritt 4: Pfadzerlegung";
    if (pipelineAsideStep === 5) return "Schritt 5: Runden und Chernoff";
    if (pipelineAsideStep === 6) return "Schritt 6: Hinreichende Bedingung";
    return "Schritt 7: Funktionsklassen und Abschluss";
  }

  function updatePipelineExtraNav() {
    const extra = document.getElementById("pipeline-nav-extra");
    const showSkipAll =
      pipelineLocked &&
      (pipelineInteractive === "wardrop_fw" ||
        pipelineInteractive === "decomp" ||
        pipelineInteractive === "round");
    if (extra) extra.hidden = !showSkipAll;
    const onIntervalChecker =
      pipelineInteractive === "interval_check" || isOnIntervalCheckerSlide();
    const reround = document.getElementById("btn-pipeline-reround");
    const stageActions = document.getElementById("graph-stage-actions");
    if (reround) reround.hidden = !onIntervalChecker;
    if (stageActions) stageActions.hidden = !onIntervalChecker;
    const skipAll = document.getElementById("btn-pipeline-skip-all");
    if (skipAll) skipAll.hidden = !showSkipAll;
  }

  function renderPipelineSlidesMode() {
    const slides = currentPipelineSlides();
    const slide = slides[pipelineIntroSlide];
    const tEl = document.getElementById("pipeline-slide-title");
    const bEl = document.getElementById("pipeline-slide-body");
    const pEl = document.getElementById("pipeline-slide-progress");
    const labelEl = document.getElementById("pipeline-step-label");
    const back = document.getElementById("btn-pipeline-back");
    const fwd = document.getElementById("btn-pipeline-fwd");
    if (!slide || !tEl || !bEl || !pEl || !back || !fwd) return;
    if (isOnIntervalCheckerSlide()) syncIntervalCheckerOnCheckerSlide();
    if (labelEl) labelEl.textContent = pipelineStepLabelText();
    tEl.textContent = slide.title;
    setPipelineSlideBody(bEl, enrichPipelineSlideHtml(pipelineAsideStep, pipelineIntroSlide, slide.html));
    pEl.textContent = "Karte " + (pipelineIntroSlide + 1) + " von " + slides.length;
    const atFirstGlobal = pipelineAsideStep === 1 && pipelineIntroSlide <= 0;
    back.disabled = atFirstGlobal;
    const slidesLast = pipelineIntroSlide >= slides.length - 1;
    const checkerOk = !!(pipelineCheckResult && pipelineCheckResult.ok);
    const atPipelineEnd = slidesLast && pipelineAsideStep === PIPELINE_LAST_STEP;
    fwd.disabled = atPipelineEnd || (isOnIntervalCheckerSlide() && !checkerOk);
    updatePipelineExtraNav();
    const pulseState = syncCommodityPulse();
    const relaxState = syncRelaxDemo();
    renderSvg();
    if (pulseState === "started") triggerCommoditySpotlightPulse();
    if (relaxState === "started") scheduleRelaxTokenAnimation();
    updateSvgContextHint();
  }

  function renderPipelineWardropFwMode() {
    const tr = pipelineWardropTrace;
    const tEl = document.getElementById("pipeline-slide-title");
    const bEl = document.getElementById("pipeline-slide-body");
    const pEl = document.getElementById("pipeline-slide-progress");
    const labelEl = document.getElementById("pipeline-step-label");
    const back = document.getElementById("btn-pipeline-back");
    const fwd = document.getElementById("btn-pipeline-fwd");
    if (!tr || !tEl || !bEl || !pEl || !back || !fwd || pipelineFwIdx < 0) return;
    if (labelEl) labelEl.textContent = pipelineStepLabelText();
    tEl.textContent = "Numerische Minimierung (Iteration)";
    const ti = tr[pipelineFwIdx];
    setPipelineSlideBody(
      bEl,
      tex(
        "<p>Zwischenstand der numerischen Minimierung der Zielfunktion. Die Kanten im Graphen zeigen den zugehörigen Gesamtfluss $f$.</p>" +
          "<p><strong>Iteration</strong> $" +
          ti.iteration +
          "$, Zielfunktion $\\approx " +
          ti.objective.toFixed(5) +
          "$.</p>"
      )
    );
    pEl.textContent = "Iteration " + (pipelineFwIdx + 1) + " von " + tr.length;
    back.disabled = false;
    fwd.disabled = false;
    updatePipelineExtraNav();
    updateSvgContextHint();
  }

  function renderPipelineWardropDoneMode() {
    const w = pipeline.wardrop;
    const tEl = document.getElementById("pipeline-slide-title");
    const bEl = document.getElementById("pipeline-slide-body");
    const pEl = document.getElementById("pipeline-slide-progress");
    const labelEl = document.getElementById("pipeline-step-label");
    const back = document.getElementById("btn-pipeline-back");
    const fwd = document.getElementById("btn-pipeline-fwd");
    if (!w || !w.ok || !tEl || !bEl || !pEl || !back || !fwd) return;
    if (labelEl) labelEl.textContent = pipelineStepLabelText();
    tEl.textContent = "Ergebnis Wardrop";
    const breakdownHtml =
      pipelineWardropCommodityIdx >= 0
        ? buildWardropPathBreakdownHtml(pipelineWardropCommodityIdx)
        : "";
    setPipelineSlideBody(
      bEl,
      tex(
        "<p>Die Minimierung ist abgeschlossen. <strong>Zielfunktion</strong> am Optimum: $" +
          w.objective.toFixed(5) +
          "$. Iterationen der numerischen Minimierung: $" +
          w.iterations +
          "$.</p>" +
          "<p>Links neben dem Graph erscheint die Liste der Spielenden. Per Klick auf Spielende $s$ werden die benutzten Pfade im Graphen farbig hervorgehoben. Die zugehörigen Pfadanteile erscheinen im Fließtext.</p>"
      ) + breakdownHtml
    );
    pEl.textContent = "Schritt 3 abgeschlossen";
    back.disabled = false;
    fwd.disabled = false;
    updatePipelineExtraNav();
    updateSvgContextHint();
  }

  function renderPipelineDecompMode() {
    const dec = pipeline.decomp;
    const tEl = document.getElementById("pipeline-slide-title");
    const bEl = document.getElementById("pipeline-slide-body");
    const pEl = document.getElementById("pipeline-slide-progress");
    const labelEl = document.getElementById("pipeline-step-label");
    const back = document.getElementById("btn-pipeline-back");
    const fwd = document.getElementById("btn-pipeline-fwd");
    if (!dec || !dec.ok || !dec.steps || !tEl || !bEl || !pEl || !back || !fwd) return;
    if (labelEl) labelEl.textContent = pipelineStepLabelText();
    tEl.textContent = "Pfadzerlegung im Detail";
    const stepIdx = Math.min(Math.max(pipelineDecompReveal - 1, 0), dec.steps.length - 1);
    const cur = dec.steps[stepIdx];
    const beforeState = computeDecompRemBeforeStep(pipelineDecompReveal);
    setPipelineSlideBody(
      bEl,
      buildDecompStepPanelHtml(cur, stepIdx, dec.steps.length, beforeState) +
        tex(
          "<p class=\"decomp-graph-legend\"><strong>Orange:</strong> gewählte Minimalkante. <strong>Blau:</strong> extrahierter Pfad. <strong>Hellblau:</strong> bereits extrahierte Pfade. Kantenbeschriftung: $f_e^s$ = Restfluss der aktiven Commodity.</p>"
        )
    );
    pEl.textContent = "Extraktionsschritt " + (stepIdx + 1) + " von " + dec.steps.length;
    back.disabled = false;
    fwd.disabled = false;
    updatePipelineExtraNav();
    updateSvgContextHint();
    renderSvg();
  }

  function renderPipelineRoundMode() {
    const tEl = document.getElementById("pipeline-slide-title");
    const bEl = document.getElementById("pipeline-slide-body");
    const pEl = document.getElementById("pipeline-slide-progress");
    const labelEl = document.getElementById("pipeline-step-label");
    const back = document.getElementById("btn-pipeline-back");
    const fwd = document.getElementById("btn-pipeline-fwd");
    if (!pipelineRoundSteps || !tEl || !bEl || !pEl || !back || !fwd) return;
    if (labelEl) labelEl.textContent = pipelineStepLabelText();
    tEl.textContent = "Randomisiertes Runden";
    const K = pipelineRoundSteps.length;
    if (pipelineRoundRevealed === 0) {
      setPipelineSlideBody(
        bEl,
        roundDrawHintHtml(false) +
          tex(
            "<p>Es wird nacheinander je Commodity ein Pfad gemäß $\\mathcal{D}_s$ gezogen. <strong>Weiter</strong> zeigt für jede Commodity alle möglichen Pfade mit Wahrscheinlichkeit, die gezogene Zufallszahl $r$ und die daraus folgende Auswahl.</p>"
          )
      );
      pEl.textContent = "0 von " + K + " Ziehungen";
    } else {
      const step = pipelineRoundSteps[pipelineRoundRevealed - 1];
      setPipelineSlideBody(
        bEl,
        buildRoundStepPanelHtml(step, pipelineRoundRevealed - 1, K)
      );
      pEl.textContent = pipelineRoundRevealed + " von " + K + " Ziehungen";
    }
    back.disabled = false;
    fwd.disabled = false;
    updatePipelineExtraNav();
    updateSvgContextHint();
  }

  function renderPipelineIntervalCheckMode() {
    const tEl = document.getElementById("pipeline-slide-title");
    const bEl = document.getElementById("pipeline-slide-body");
    const pEl = document.getElementById("pipeline-slide-progress");
    const labelEl = document.getElementById("pipeline-step-label");
    const back = document.getElementById("btn-pipeline-back");
    const fwd = document.getElementById("btn-pipeline-fwd");
    if (!tEl || !bEl || !pEl || !back || !fwd) return;
    if (labelEl) labelEl.textContent = pipelineStepLabelText();
    tEl.textContent = "Intervall-Checker";
    setPipelineSlideBody(bEl, buildIntervalCheckerPanelHtml());
    const ok = !!(pipelineCheckResult && pipelineCheckResult.ok);
    pEl.textContent =
      "Versuch " + pipelineCheckAttempt + (ok ? " · Erfolg" : " · Prüfung läuft");
    back.disabled = false;
    fwd.disabled = !ok;
    updatePipelineExtraNav();
    updateSvgContextHint();
    renderSvg();
  }

  function renderPipelinePanel() {
    if (!pipelineLocked) return;
    if (pipelineInteractive === "wardrop_fw") renderPipelineWardropFwMode();
    else if (pipelineInteractive === "wardrop_done") renderPipelineWardropDoneMode();
    else if (pipelineInteractive === "decomp") renderPipelineDecompMode();
    else if (pipelineInteractive === "round") renderPipelineRoundMode();
    else if (pipelineInteractive === "interval_check") renderPipelineIntervalCheckMode();
    else renderPipelineSlidesMode();
    updateGraphPlayerCountControl();
  }

  function finalizePipelineRound() {
    if (!pipelineRoundChosen) return;
    pipeline.rounded = pipelineRoundChosen;
    pipelineRoundActive = false;
    pipelineRoundRevealed = pipelineRoundSteps ? pipelineRoundSteps.length : 0;
    pipeline.stepDone[4] = true;
    pipeline.stepDone[5] = true;
    pipelineCheckAttempt = 0;
    pipelineCheckResult = null;
    pipelineInteractive = null;
    pipelineAsideStep = 5;
    pipelineIntroSlide = PIPELINE_STEP5_CHERNOFF_SLIDE;
    currentStep = 5;
    logLine("Randomisiertes Runden vollständig. Schritt 5 fortgesetzt mit Chernoff-Einordnung.");
    renderPipelinePanel();
    renderStepPanel();
    renderSvg();
  }

  function restorePipelineRoundWalk() {
    if (!pipelineRoundSteps || !pipelineRoundSteps.length) return false;
    pipelineInteractive = "round";
    pipelineRoundActive = true;
    pipelineRoundRevealed = pipelineRoundSteps.length;
    renderPipelinePanel();
    renderSvg();
    renderStepPanel();
    return true;
  }

  function restorePipelineDecompWalk() {
    const dec = pipeline.decomp;
    if (!dec || !dec.ok || !dec.steps || !dec.steps.length) return false;
    pipelineAsideStep = 4;
    pipelineInteractive = "decomp";
    pipelineDecompReveal = dec.steps.length;
    currentStep = 4;
    renderPipelinePanel();
    renderSvg();
    renderStepPanel();
    return true;
  }

  function pipelineSkipAllInteractive() {
    if (!pipelineLocked) return;
    if (pipelineInteractive === "wardrop_fw") {
      pipelineInteractive = "wardrop_done";
      pipelineFwIdx = -1;
      pipelineWardropTrace = null;
      ensureWardropCommoditySelected();
      renderPipelinePanel();
      renderSvg();
      renderStepPanel();
      return;
    }
    if (pipelineInteractive === "decomp" && pipeline.decomp && pipeline.decomp.steps) {
      pipelineDecompReveal = pipeline.decomp.steps.length;
      pipelineInteractive = null;
      pipelineAsideStep = 5;
      pipelineIntroSlide = 0;
      currentStep = 5;
      renderPipelinePanel();
      renderSvg();
      renderStepPanel();
      return;
    }
    if (pipelineInteractive === "round") {
      finalizePipelineRound();
    }
  }

  function pipelineBeginWardropCompute() {
    sanitizeCommodities();
    if (G.commodities.length === 0) {
      alert("Mindestens eine spielende Person mit gültigem Startknoten und Zielknoten wird benötigt.");
      return false;
    }
    const res = P.computeWardrop(G.nodes, G.edges, G.commodities, {
      recordIterationTrace: true,
    });
    if (!res.ok) {
      logLine("Wardrop-Fehler: " + res.msg);
      alert(res.msg);
      return false;
    }
    pipeline.wardrop = res;
    wardropValidationPreview = res;
    pipeline.stepDone[1] = true;
    pipeline.stepDone[2] = true;
    pipelineWardropCompleted = true;
    logLine("Wardrop berechnet. Zielwert " + res.objective.toFixed(5));
    currentStep = 3;
    if (res.iterationTrace && res.iterationTrace.length > 1) {
      pipelineInteractive = "wardrop_fw";
      pipelineWardropTrace = res.iterationTrace;
      pipelineFwIdx = 0;
      pipelineWardropCommodityIdx = -1;
    } else {
      pipelineInteractive = "wardrop_done";
      pipelineWardropTrace = null;
      pipelineFwIdx = -1;
      ensureWardropCommoditySelected();
    }
    renderStepPanel();
    renderSvg();
    return true;
  }

  function pipelineExecuteDecomp() {
    const w = pipeline.wardrop;
    if (!w || !w.ok) {
      alert("Kein Wardrop-Fluss vorhanden.");
      return false;
    }
    try {
      let dec = P.pathDecomposition(w.fCommEdge, G.nodes, G.edges, G.commodities);
      if (!dec.ok) {
        logLine(
          "Hinweis: iterative Kanten-Pfadzerlegung ist fehlgeschlagen (" +
            dec.msg +
            "). Es wird die gleichwertige Verteilung aus den Pfadanteilen des Wardrop-Flusses verwendet."
        );
        dec = P.pathDecompositionFromWardrop(w.pathLists, w.h, G.edges);
      } else {
        logLine(
          "Iterative Pfadzerlegung erfolgreich (" + dec.steps.length + " Schritte)."
        );
      }
      if (!dec.ok) {
        logLine("Pfadzerlegung: " + dec.msg);
        alert(dec.msg);
        return false;
      }
      pipeline.decomp = dec;
      pipeline.stepDone[3] = true;
      currentStep = 4;
      logLine(
        "Pfadzerlegung fertig: " +
          dec.steps.length +
          " Einträge, Methode: " +
          (dec.method === "wardrop-path-flows"
            ? "Wardrop-Pfadanteile"
            : "iterativ (Kantenminimum)")
      );
      if (dec.steps && dec.steps.length > 1) {
        pipelineInteractive = "decomp";
        pipelineDecompReveal = 1;
      } else {
        pipelineInteractive = null;
        pipelineAsideStep = 5;
        pipelineIntroSlide = 0;
        currentStep = 5;
      }
      renderStepPanel();
      renderSvg();
      return true;
    } catch (err) {
      console.error(err);
      logLine("Pfadzerlegung: Ausnahme, " + (err && err.message));
      alert("Pfadzerlegung fehlgeschlagen: " + (err && err.message ? err.message : String(err)));
      return false;
    }
  }

  function ensurePipelineRoundedProfile() {
    if (pipeline.rounded) return true;
    if (pipelineRoundChosen) {
      pipeline.rounded = pipelineRoundChosen;
      return true;
    }
    if (pipeline.decomp && pipeline.decomp.ok) {
      const chosen = P.randomizedRound(pipeline.decomp.distributions, undefined);
      pipeline.rounded = chosen;
      pipelineRoundChosen = chosen;
      return true;
    }
    return false;
  }

  function syncIntervalCheckerOnCheckerSlide() {
    if (!ensurePipelineRoundedProfile()) return false;
    if (pipelineCheckAttempt <= 0) pipelineCheckAttempt = 1;
    refreshIntervalCheckResult();
    return true;
  }

  function isOnIntervalCheckerSlide() {
    return (
      pipelineAsideStep === 7 &&
      pipelineIntroSlide === PIPELINE_STEP7_CHECKER_SLIDE &&
      pipelineInteractive === null
    );
  }

  function pipelineBeginIntervalCheck() {
    if (!syncIntervalCheckerOnCheckerSlide()) {
      alert("Zuerst muss randomisiert gerundet werden.");
      return false;
    }
    pipelineInteractive = "interval_check";
    logLine(
      "Intervall-Checker: Versuch " +
        pipelineCheckAttempt +
        ", " +
        (pipelineCheckResult && pipelineCheckResult.ok ? "Erfolg" : "noch kein Erfolg") +
        "."
    );
    renderPipelinePanel();
    renderStepPanel();
    renderSvg();
    return true;
  }

  function pipelineReroundForCheck() {
    if (!pipeline.decomp || !pipeline.decomp.ok) {
      alert("Keine Pfadzerlegung vorhanden.");
      return;
    }
    const chosen = P.randomizedRound(pipeline.decomp.distributions, undefined);
    pipeline.rounded = chosen;
    pipelineRoundChosen = chosen;
    if (pipelineCheckAttempt <= 0) pipelineCheckAttempt = 1;
    else pipelineCheckAttempt += 1;
    pipelineInteractive = null;
    refreshIntervalCheckResult();
    logLine(
      "Intervall-Checker: Versuch " +
        pipelineCheckAttempt +
        ", neu gewürfelt, " +
        (pipelineCheckResult && pipelineCheckResult.ok ? "Erfolg" : "noch kein Erfolg") +
        "."
    );
    renderPipelinePanel();
    renderStepPanel();
    renderSvg();
  }

  function pipelinePrepareRoundWalk() {
    if (!pipeline.decomp || !pipeline.decomp.ok) {
      alert("Keine Pfadzerlegung vorhanden.");
      return false;
    }
    const sr = P.randomizedRoundSteps(pipeline.decomp.distributions, undefined, G.edges);
    pipelineRoundActive = true;
    pipelineRoundSteps = sr.steps;
    pipelineRoundChosen = sr.chosen;
    pipelineRoundRevealed = 0;
    pipeline.rounded = null;
    pipelineInteractive = "round";
    currentStep = 5;
    logLine("Randomisiertes Runden vorbereitet (" + sr.steps.length + " Ziehungen).");
    renderStepPanel();
    renderSvg();
    return true;
  }

  function pipelineForward() {
    if (!pipelineLocked) return;
    if (pipelineInteractive === "wardrop_fw" && pipelineWardropTrace) {
      if (pipelineFwIdx < pipelineWardropTrace.length - 1) {
        pipelineFwIdx++;
      } else {
        pipelineInteractive = "wardrop_done";
        pipelineWardropTrace = null;
        pipelineFwIdx = -1;
        ensureWardropCommoditySelected();
      }
      renderPipelinePanel();
      renderSvg();
      renderStepPanel();
      return;
    }
    if (pipelineInteractive === "wardrop_done") {
      pipelineInteractive = null;
      pipelineWardropCommodityIdx = -1;
      pipelineAsideStep = 4;
      pipelineIntroSlide = 0;
      currentStep = 4;
      renderPipelinePanel();
      renderSvg();
      renderStepPanel();
      logLine("Pipeline: Schritt 4, Pfadzerlegung (Einordnung).");
      return;
    }
    if (pipelineInteractive === "decomp" && pipeline.decomp && pipeline.decomp.steps) {
      const steps = pipeline.decomp.steps;
      if (pipelineDecompReveal < steps.length) {
        pipelineDecompReveal++;
        if (pipelineDecompReveal >= steps.length) {
          pipelineInteractive = null;
          pipelineAsideStep = 5;
          pipelineIntroSlide = 0;
          currentStep = 5;
          logLine("Pipeline: Schritt 5, Randomisiertes Runden (Einordnung).");
        }
      } else {
        pipelineInteractive = null;
        pipelineAsideStep = 5;
        pipelineIntroSlide = 0;
        currentStep = 5;
        logLine("Pipeline: Schritt 5, Randomisiertes Runden (Einordnung).");
      }
      renderPipelinePanel();
      renderSvg();
      renderStepPanel();
      return;
    }
    if (pipelineInteractive === "interval_check") {
      if (pipelineCheckResult && pipelineCheckResult.ok) {
        pipelineInteractive = null;
        pipelineAsideStep = 7;
        pipelineIntroSlide = PIPELINE_STEP7_WHY_SUCCESS_SLIDE;
        currentStep = 7;
        logLine("Intervall-Checker erfolgreich. Erläuterung zur hohen Erfolgswahrscheinlichkeit.");
        renderPipelinePanel();
        renderSvg();
        renderStepPanel();
      }
      return;
    }
    if (pipelineInteractive === "round" && pipelineRoundSteps) {
      const K = pipelineRoundSteps.length;
      if (pipelineRoundRevealed < K) {
        pipelineRoundRevealed++;
        if (pipelineRoundRevealed >= K) finalizePipelineRound();
        else {
          renderPipelinePanel();
          renderSvg();
          renderStepPanel();
        }
        return;
      }
      if (pipeline.rounded) {
        pipelineInteractive = null;
        pipelineRoundActive = false;
        pipelineAsideStep = 5;
        pipelineIntroSlide = PIPELINE_STEP5_CHERNOFF_SLIDE;
        renderPipelinePanel();
        renderSvg();
        renderStepPanel();
      }
      return;
    }

    const slides = currentPipelineSlides();
    if (
      pipelineAsideStep === 5 &&
      pipelineIntroSlide === PIPELINE_STEP5_ROUND_SLIDE &&
      !pipeline.rounded &&
      pipelineInteractive === null
    ) {
      if (pipelinePrepareRoundWalk()) renderPipelinePanel();
      return;
    }
    if (
      pipelineAsideStep === 7 &&
      pipelineIntroSlide === PIPELINE_STEP7_CHECKER_SLIDE &&
      pipelineInteractive === null
    ) {
      if (!syncIntervalCheckerOnCheckerSlide()) {
        alert("Zuerst muss randomisiert gerundet werden.");
        return;
      }
      if (pipelineCheckResult && pipelineCheckResult.ok) {
        pipelineIntroSlide = PIPELINE_STEP7_WHY_SUCCESS_SLIDE;
        renderPipelinePanel();
        renderSvg();
        return;
      }
      renderPipelinePanel();
      return;
    }
    if (pipelineIntroSlide < slides.length - 1) {
      pipelineIntroSlide++;
      renderPipelinePanel();
      if (pipelineAsideStep === 5) renderSvg();
      return;
    }

    if (pipelineAsideStep === 5) {
      pipelineAsideStep = 6;
      pipelineIntroSlide = 0;
      currentStep = 6;
      logLine("Pipeline: Schritt 6, hinreichende Bedingung.");
      renderPipelinePanel();
      renderSvg();
      return;
    }

    if (pipelineAsideStep === 1) {
      pipelineAsideStep = 2;
      pipelineIntroSlide = 0;
      currentStep = 2;
      logLine("Pipeline: Schritt 2, Relaxierung als Multi-Commodity-Flow-Problem (Einordnung).");
      renderPipelinePanel();
      return;
    }
    if (pipelineAsideStep === 2) {
      pipelineAsideStep = 3;
      pipelineIntroSlide = 0;
      currentStep = 3;
      logLine("Pipeline: Schritt 3, Wardrop-Gleichgewicht und numerische Minimierung (Einordnung).");
      renderPipelinePanel();
      return;
    }
    if (pipelineAsideStep === 6) {
      pipelineAsideStep = 7;
      pipelineIntroSlide = 0;
      currentStep = 7;
      logLine("Pipeline: Schritt 7, Funktionsklassen.");
      renderPipelinePanel();
      renderSvg();
      return;
    }

    if (pipelineAsideStep === 3) {
      if (pipelineWardropCompleted && pipeline.wardrop && pipeline.wardrop.ok) {
        pipelineInteractive = "wardrop_done";
        ensureWardropCommoditySelected();
        renderPipelinePanel();
        renderSvg();
        renderStepPanel();
        return;
      }
      if (pipelineBeginWardropCompute()) renderPipelinePanel();
      return;
    }
    if (pipelineAsideStep === 4) {
      if (pipelineExecuteDecomp()) renderPipelinePanel();
      return;
    }
  }

  function pipelineBack() {
    if (!pipelineLocked) return;
    if (pipelineInteractive === "wardrop_fw" && pipelineWardropTrace) {
      if (pipelineFwIdx > 0) {
        pipelineFwIdx--;
        renderPipelinePanel();
        renderSvg();
        renderStepPanel();
        return;
      }
      pipelineInteractive = null;
      pipelineWardropTrace = null;
      pipelineFwIdx = -1;
      pipelineIntroSlide = PIPELINE_STEP3_SLIDES.length - 1;
      renderPipelinePanel();
      renderSvg();
      renderStepPanel();
      return;
    }
    if (pipelineInteractive === "wardrop_done") {
      if (pipeline.wardrop && pipeline.wardrop.iterationTrace && pipeline.wardrop.iterationTrace.length > 1) {
        pipelineInteractive = "wardrop_fw";
        pipelineWardropTrace = pipeline.wardrop.iterationTrace;
        pipelineFwIdx = pipelineWardropTrace.length - 1;
        pipelineWardropCommodityIdx = -1;
        renderPipelinePanel();
        renderSvg();
        renderStepPanel();
        return;
      }
      pipelineInteractive = null;
      pipelineIntroSlide = PIPELINE_STEP3_SLIDES.length - 1;
      pipelineWardropCompleted = false;
      pipeline.wardrop = null;
      pipeline.stepDone[1] = false;
      pipeline.stepDone[2] = false;
      renderPipelinePanel();
      renderSvg();
      renderStepPanel();
      return;
    }
    if (pipelineInteractive === "decomp" && pipeline.decomp && pipeline.decomp.steps) {
      if (pipelineDecompReveal > 1) {
        pipelineDecompReveal--;
        renderPipelinePanel();
        renderSvg();
        renderStepPanel();
        return;
      }
      pipelineInteractive = null;
      const pastDecomp = currentStep >= 5 || !!pipeline.rounded;
      if (!pastDecomp) {
        pipeline.decomp = null;
        pipeline.stepDone[3] = false;
      }
      pipelineIntroSlide = PIPELINE_STEP4_SLIDES.length - 1;
      renderPipelinePanel();
      renderSvg();
      renderStepPanel();
      return;
    }
    if (pipelineInteractive === "interval_check") {
      pipelineInteractive = null;
      pipelineAsideStep = 7;
      pipelineIntroSlide = PIPELINE_STEP7_CHECKER_SLIDE;
      renderPipelinePanel();
      renderSvg();
      renderStepPanel();
      return;
    }
    if (pipelineInteractive === "round") {
      if (pipelineRoundRevealed > 0) {
        pipelineRoundRevealed--;
        renderPipelinePanel();
        renderSvg();
        renderStepPanel();
        return;
      }
      pipelineRoundActive = false;
      pipelineInteractive = null;
      if (!pipeline.rounded) {
        pipelineRoundSteps = null;
        pipelineRoundChosen = null;
        pipelineRoundRevealed = 0;
      }
      pipelineIntroSlide = PIPELINE_STEP5_ROUND_SLIDE;
      renderPipelinePanel();
      renderSvg();
      renderStepPanel();
      return;
    }

    if (
      pipelineAsideStep === 5 &&
      pipelineIntroSlide === PIPELINE_STEP5_CHERNOFF_SLIDE &&
      pipeline.rounded &&
      pipelineRoundSteps
    ) {
      restorePipelineRoundWalk();
      return;
    }
    if (
      pipelineAsideStep === 5 &&
      pipelineIntroSlide === 0 &&
      pipeline.decomp &&
      pipeline.decomp.ok &&
      pipeline.decomp.steps &&
      pipeline.decomp.steps.length > 0
    ) {
      restorePipelineDecompWalk();
      return;
    }

    if (pipelineIntroSlide > 0) {
      pipelineIntroSlide--;
      renderPipelinePanel();
      if (pipelineAsideStep === 5) renderSvg();
      return;
    }
    if (pipelineAsideStep === 7) {
      pipelineAsideStep = 6;
      pipelineIntroSlide = PIPELINE_STEP6_SLIDES.length - 1;
      currentStep = 6;
      renderPipelinePanel();
      renderSvg();
      return;
    }
    if (pipelineAsideStep === 6) {
      pipelineAsideStep = 5;
      pipelineIntroSlide = PIPELINE_STEP5_SLIDES.length - 1;
      currentStep = 5;
      renderPipelinePanel();
      renderSvg();
      return;
    }
    if (pipelineAsideStep === 5) {
      pipelineAsideStep = 4;
      pipelineIntroSlide = PIPELINE_STEP4_SLIDES.length - 1;
      currentStep = 4;
      pipelineInteractive = null;
      renderPipelinePanel();
      renderSvg();
      renderStepPanel();
      return;
    }
    if (pipelineAsideStep === 4) {
      if (pipelineInteractive === null && pipelineWardropCompleted) {
        pipelineAsideStep = 3;
        pipelineInteractive = "wardrop_done";
        pipelineIntroSlide = 0;
        currentStep = 3;
        ensureWardropCommoditySelected();
        renderPipelinePanel();
        renderSvg();
        renderStepPanel();
        return;
      }
      pipelineAsideStep = 3;
      pipelineIntroSlide = PIPELINE_STEP3_SLIDES.length - 1;
      pipelineInteractive = null;
      currentStep = 3;
      renderPipelinePanel();
      return;
    }
    if (pipelineAsideStep === 3) {
      pipelineAsideStep = 2;
      pipelineIntroSlide = PIPELINE_STEP2_SLIDES.length - 1;
      currentStep = 2;
      renderPipelinePanel();
      return;
    }
    if (pipelineAsideStep === 2) {
      pipelineAsideStep = 1;
      pipelineIntroSlide = PIPELINE_STEP1_SLIDES.length - 1;
      currentStep = 1;
      renderPipelinePanel();
    }
  }

  function startPipeline() {
    pipelineLocked = true;
    resetPipelineComputationForNewRun();
    invalidateRelaxDemoData();
    pipelineAsideStep = 1;
    pipelineIntroSlide = 0;
    pipelineInteractive = null;
    currentStep = 1;
    if (isRandomNetworkInstance) syncRandomNetworkBlueprintsFromInstance();
    refreshWardropValidationPreview();
    sanitizeCommodities();
    applyPipelineChrome();
    updateGraphPlayerCountControl();
    renderPipelinePanel();
    renderSvg();
    updateSvgContextHint();
    logLine(
      "Pipeline gestartet, Schritt 1: Einordnung (" +
        G.commodities.length +
        " Spielende, Instanz aus „Instanz bearbeiten“)."
    );
  }

  function abortPipeline() {
    pipelineLocked = false;
    pipelineAsideStep = 1;
    pipelineIntroSlide = 0;
    pipelineInteractive = null;
    resetPipelineInteractiveState();
    currentStep = 1;
    applyPipelineChrome();
    updateGraphPlayerCountControl();
    renderSvg();
    updateSvgContextHint();
    logLine("Pipeline abgebrochen, Standardansicht.");
  }

  function getWardropFEForDisplay() {
    if (!pipeline.wardrop || !pipeline.wardrop.ok) return null;
    if (
      pipelineLocked &&
      pipelineInteractive === "wardrop_fw" &&
      pipelineWardropTrace &&
      pipelineFwIdx >= 0 &&
      pipelineFwIdx < pipelineWardropTrace.length
    ) {
      return pipelineWardropTrace[pipelineFwIdx].fEdge;
    }
    return pipeline.wardrop.fEdge;
  }

  function updateEdgeCostToggleButton() {
    const btn = document.getElementById("btn-toggle-edge-costs");
    if (!btn) return;
    btn.textContent = showEdgeDelayLabels
      ? "Verzögerung auf Kanten ausblenden"
      : "Verzögerung auf Kanten einblenden";
    btn.classList.toggle("on", showEdgeDelayLabels);
  }

  // ===================== Plot-Bühne (Schritte 6 bis 8) =====================

  /** ε für die Bandbedingung in den Plots (identisch zum Editor-ε, siehe THESIS_EPS). */
  const PLOT_EPS = THESIS_EPS;

  /** Hinweis unter Veranschaulichungsplots (keine Instanzkante). */
  const ILLUSTRATIVE_PLOT_NOTE =
    "Nur Veranschaulichung (keine Kante aus der aktuellen Instanz).";

  /** Festes Szenario f_e = 100, m = 1000 (Thesis-Beispiel, proportioniertes Intervall). */
  const ILLUSTRATIVE_M = 1000;
  const ILLUSTRATIVE_FE = 100;

  function illustrativeBandInterval() {
    const L = Math.log(4 * ILLUSTRATIVE_M);
    const fe = ILLUSTRATIVE_FE;
    const le = fe - Math.sqrt(3 * L * fe);
    const ue = Math.max(6 * L, fe + Math.sqrt(3 * L * fe));
    return { fe, le, ue, L, m: ILLUSTRATIVE_M };
  }

  function illustrativeBandFn(x) {
    return 200 + 0.45 * x;
  }

  function illustrativeCounterexampleFn(fe, ue) {
    const c0 = illustrativeBandFn(fe);
    const span = Math.max(0.8, ue - fe);
    // Parabel um f_e: verlässt das Band an den Intervallrändern, ohne extremen y-Ausschlag.
    return (x) => c0 * (1 + 0.55 * Math.pow((x - fe) / span, 2));
  }

  /** Sichtbarer Plot-Ausschnitt (Zoom/Pan); wird bei Kontextwechsel neu gesetzt. */
  let plotView = null;
  let plotInstantRender = false;
  let plotPanActive = false;
  let plotPanLast = null;

  function invalidatePlotView() {
    plotView = null;
  }

  function bumpPipelinePlotRevision() {
    pipelinePlotRevision += 1;
    invalidatePlotView();
  }

  function plotDomainSnapshot(def) {
    return {
      xmin: def.xmin,
      xmax: def.xmax,
      ymin: def.ymin,
      ymax: def.ymax,
    };
  }

  function plotDomainsDiffer(a, b) {
    if (!a || !b) return true;
    return (
      Math.abs(a.xmin - b.xmin) > 1e-9 ||
      Math.abs(a.xmax - b.xmax) > 1e-9 ||
      Math.abs(a.ymin - b.ymin) > 1e-9 ||
      Math.abs(a.ymax - b.ymax) > 1e-9
    );
  }

  function plotContextKey(kind) {
    let extra = "";
    if (kind === "chernoff") {
      const cp = chernoffParams();
      if (cp) {
        extra =
          "|e" +
          cp.ei +
          "|fe" +
          cp.fe.toFixed(6) +
          "|p" +
          cp.probs.length +
          "|v" +
          bernoulliSumVariance(cp.probs).toFixed(6);
      }
    }
    return (
      kind +
      "|" +
      pipelineAsideStep +
      "|" +
      pipelineIntroSlide +
      "|n" +
      G.commodities.length +
      "|r" +
      pipelinePlotRevision +
      extra
    );
  }

  function resolvePlotDomain(kind, def) {
    const key = plotContextKey(kind);
    const nextBase = plotDomainSnapshot(def);
    if (
      !plotView ||
      plotView.key !== key ||
      plotDomainsDiffer(plotView.base, nextBase)
    ) {
      plotView = {
        key,
        xmin: def.xmin,
        xmax: def.xmax,
        ymin: def.ymin,
        ymax: def.ymax,
        base: nextBase,
      };
    }
    return plotView;
  }

  function resetPlotViewToBase() {
    if (!plotView || !plotView.base) return;
    plotView.xmin = plotView.base.xmin;
    plotView.xmax = plotView.base.xmax;
    plotView.ymin = plotView.base.ymin;
    plotView.ymax = plotView.base.ymax;
  }

  function constrainPlotView() {
    if (!plotView || !plotView.base) return;
    const b = plotView.base;
    const maxXSpan = (b.xmax - b.xmin) * 1.02;
    const maxYSpan = (b.ymax - b.ymin) * 1.02;
    const minXSpan = Math.max(1e-9, maxXSpan / 80);
    const minYSpan = Math.max(1e-9, maxYSpan / 80);
    let xSpan = Math.max(minXSpan, Math.min(plotView.xmax - plotView.xmin, maxXSpan));
    let ySpan = Math.max(minYSpan, Math.min(plotView.ymax - plotView.ymin, maxYSpan));
    if (xSpan >= maxXSpan - 1e-12) {
      plotView.xmin = b.xmin;
      plotView.xmax = b.xmax;
    } else {
      const cx = (plotView.xmin + plotView.xmax) / 2;
      plotView.xmin = cx - xSpan / 2;
      plotView.xmax = cx + xSpan / 2;
    }
    if (ySpan >= maxYSpan - 1e-12) {
      plotView.ymin = b.ymin;
      plotView.ymax = b.ymax;
    } else {
      const cy = (plotView.ymin + plotView.ymax) / 2;
      plotView.ymin = cy - ySpan / 2;
      plotView.ymax = cy + ySpan / 2;
    }
    if (plotView.xmax - plotView.xmin < maxXSpan - 1e-12) {
      if (plotView.xmin < b.xmin) {
        plotView.xmax += b.xmin - plotView.xmin;
        plotView.xmin = b.xmin;
      }
      if (plotView.xmax > b.xmax) {
        plotView.xmin -= plotView.xmax - b.xmax;
        plotView.xmax = b.xmax;
      }
    }
    if (plotView.ymax - plotView.ymin < maxYSpan - 1e-12) {
      if (plotView.ymin < b.ymin) {
        plotView.ymax += b.ymin - plotView.ymin;
        plotView.ymin = b.ymin;
      }
      if (plotView.ymax > b.ymax) {
        plotView.ymin -= plotView.ymax - b.ymax;
        plotView.ymax = b.ymax;
      }
    }
  }

  function zoomPlotDomainAt(deltaY, px, py) {
    if (!plotView) return;
    const factor = Math.pow(1.002, -deltaY);
    const w = PLOT_BOX.x1 - PLOT_BOX.x0;
    const h = PLOT_BOX.y1 - PLOT_BOX.y0;
    const rx = Math.max(0, Math.min(1, (px - PLOT_BOX.x0) / w));
    const ry = Math.max(0, Math.min(1, (PLOT_BOX.y1 - py) / h));
    const xAt = plotView.xmin + rx * (plotView.xmax - plotView.xmin);
    const yAt = plotView.ymin + ry * (plotView.ymax - plotView.ymin);
    const xSpan = (plotView.xmax - plotView.xmin) / factor;
    const ySpan = (plotView.ymax - plotView.ymin) / factor;
    plotView.xmin = xAt - rx * xSpan;
    plotView.xmax = xAt + (1 - rx) * xSpan;
    plotView.ymin = yAt - ry * ySpan;
    plotView.ymax = yAt + (1 - ry) * ySpan;
    constrainPlotView();
  }

  function panPlotDomain(dxPx, dyPx) {
    if (!plotView) return;
    const w = PLOT_BOX.x1 - PLOT_BOX.x0;
    const h = PLOT_BOX.y1 - PLOT_BOX.y0;
    const xSpan = plotView.xmax - plotView.xmin;
    const ySpan = plotView.ymax - plotView.ymin;
    plotView.xmin -= (dxPx / w) * xSpan;
    plotView.xmax -= (dxPx / w) * xSpan;
    plotView.ymin += (dyPx / h) * ySpan;
    plotView.ymax += (dyPx / h) * ySpan;
    constrainPlotView();
  }

  function pointerInPlotBox(event) {
    const p = d3.pointer(event, svg.node());
    if (
      p[0] < PLOT_BOX.x0 ||
      p[0] > PLOT_BOX.x1 ||
      p[1] < PLOT_BOX.y0 ||
      p[1] > PLOT_BOX.y1
    ) {
      return null;
    }
    return p;
  }

  function setupPlotInteraction() {
    gPlotInteraction
      .select(".plot-zoom-surface")
      .on("mousedown", function (event) {
        if (!plotKindForState() || event.button !== 0) return;
        event.preventDefault();
        plotPanActive = true;
        plotPanLast = d3.pointer(event, svg.node());
        d3.select(this).style("cursor", "grabbing");
      })
      .on("dblclick", function (event) {
        if (!plotKindForState()) return;
        event.preventDefault();
        resetPlotViewToBase();
        plotInstantRender = true;
        renderPlotStage(plotKindForState());
        plotInstantRender = false;
      });

    svg.on("wheel.plotzoom", function (event) {
      if (!plotKindForState()) return;
      const p = pointerInPlotBox(event);
      if (!p) return;
      event.preventDefault();
      zoomPlotDomainAt(event.deltaY, p[0], p[1]);
      plotInstantRender = true;
      renderPlotStage(plotKindForState());
      plotInstantRender = false;
    });

    svg.on("mousemove.plotpan", function (event) {
      if (!plotPanActive || !plotView || !plotKindForState()) return;
      const p = d3.pointer(event, svg.node());
      const dx = p[0] - plotPanLast[0];
      const dy = p[1] - plotPanLast[1];
      plotPanLast = p;
      panPlotDomain(dx, dy);
      plotInstantRender = true;
      renderPlotStage(plotKindForState());
      plotInstantRender = false;
    });

    svg.on("mouseup.plotpan mouseleave.plotpan", function () {
      if (!plotPanActive) return;
      plotPanActive = false;
      plotPanLast = null;
      gPlotInteraction.select(".plot-zoom-surface").style("cursor", "grab");
    });
  }
  setupPlotInteraction();

  function plotKindForState() {
    if (!pipelineLocked || pipelineInteractive !== null) return null;
    if (
      pipelineAsideStep === 5 &&
      pipelineIntroSlide >= PIPELINE_STEP5_CHERNOFF_SLIDE &&
      pipelineIntroSlide < PIPELINE_STEP5_SUCCESS_SLIDE &&
      pipelineInteractive === null
    )
      return "chernoff";
    if (pipelineAsideStep === 6) return "condition";
    if (pipelineAsideStep === 7) {
      if (pipelineIntroSlide === PIPELINE_STEP7_CHECKER_SLIDE && pipelineInteractive === null) {
        return null;
      }
      if (pipelineIntroSlide === PIPELINE_STEP7_WHY_SUCCESS_SLIDE && pipelineInteractive === null) {
        return null;
      }
      return "classes";
    }
    return null;
  }

  /** Pfadverteilung nur, wenn sie zur aktuellen Spielerzahl und zum Wardrop-Fluss passt. */
  function decompDistributionsForChernoff() {
    const w = pipeline.wardrop;
    if (!w || !w.ok || !w.fCommEdge) return null;
    if (w.fCommEdge.length !== G.commodities.length) return null;
    const dec = pipeline.decomp;
    if (!dec || !dec.ok || !dec.distributions) return null;
    if (dec.distributions.length !== G.commodities.length) return null;
    return dec.distributions;
  }

  /** Bernoulli-Wahrscheinlichkeit, dass Commodity k Kante ei im gerundeten Profil nutzt. */
  function commodityEdgeUseProb(w, distributions, k, ei) {
    if (distributions && distributions[k] && distributions[k].paths) {
      let p = 0;
      const paths = distributions[k].paths;
      for (let i = 0; i < paths.length; i++) {
        if (paths[i].edges.indexOf(ei) >= 0) p += paths[i].weight;
      }
      return Math.max(0, Math.min(1, p));
    }
    if (w.fCommEdge && w.fCommEdge[k]) {
      return Math.max(0, Math.min(1, w.fCommEdge[k][ei] || 0));
    }
    return 0;
  }

  /** Bernoulli-Parameter je Commodity für Kante ei (nur positive Anteile). */
  function edgeBernoulliProbs(w, ei, distributions) {
    const kCount = G.commodities.length;
    const probs = [];
    for (let k = 0; k < kCount; k++) {
      const p = commodityEdgeUseProb(w, distributions, k, ei);
      if (p > 1e-9) probs.push(p);
    }
    return probs;
  }

  /** Varianz der Summe unabhängiger Bernoulli-Variablen mit gegebenen Erfolgswahrscheinlichkeiten. */
  function bernoulliSumVariance(probs) {
    let v = 0;
    for (let i = 0; i < probs.length; i++) {
      const p = probs[i];
      v += p * (1 - p);
    }
    return v;
  }

  function chernoffParams() {
    const w = pipeline.wardrop;
    if (!w || !w.ok || !w.fEdge || G.edges.length === 0) return null;
    const distributions = decompDistributionsForChernoff();

    let bestEi = -1;
    let bestVar = -1;
    let bestF = -1e-9;
    let bestProbs = [];
    let maxFeEi = -1;
    let maxFe = -1e-9;
    let maxFeProbs = [];

    for (let ei = 0; ei < G.edges.length; ei++) {
      const fe = w.fEdge[ei] || 0;
      if (fe <= 1e-9) continue;
      const probs = edgeBernoulliProbs(w, ei, distributions);
      const varSum = bernoulliSumVariance(probs);
      if (fe > maxFe) {
        maxFe = fe;
        maxFeEi = ei;
        maxFeProbs = probs;
      }
      if (varSum > bestVar + 1e-12) {
        bestVar = varSum;
        bestF = fe;
        bestEi = ei;
        bestProbs = probs;
      }
    }

    if (maxFeEi < 0 || maxFe <= 1e-9) return null;
    if (bestEi < 0 || bestVar <= 1e-12) {
      bestEi = maxFeEi;
      bestF = maxFe;
      bestProbs = maxFeProbs;
    }

    const fe = w.fEdge[bestEi];
    const m = G.edges.length;
    const L = Math.log(4 * Math.max(1, m));
    const le = fe - Math.sqrt(3 * L * fe);
    const ue = Math.max(6 * L, fe + Math.sqrt(3 * L * fe));
    return {
      ei: bestEi,
      edgeIdx: parseEdgeIndex(G.edges[bestEi].name, bestEi),
      edgeName: edgeName(G.edges[bestEi], bestEi),
      spec: G.edges[bestEi].delay,
      fe,
      m,
      L,
      le,
      ue,
      probs: bestProbs,
    };
  }

  function formatInstanzNumber(v) {
    if (!isFinite(v)) return "?";
    const av = Math.abs(v);
    if (av === 0) return "0";
    if (av >= 100) return String(Math.round(v));
    if (av >= 10) return v.toFixed(1);
    if (av >= 1) return v.toFixed(2);
    if (av >= 0.01) return v.toFixed(3);
    return v.toExponential(2);
  }

  /** Dynamischer „Konkret“-Absatz für Schritt 5, Karte 4 (Instanzwerte). */
  function chernoffConcretePhrase() {
    const cp = chernoffParams();
    if (!cp) {
      return tex(
        "<p><strong>Konkret:</strong> Sobald ein Wardrop-Fluss mit belasteten Kanten vorliegt, werden hier die Chernoff-Schranken für eine stark belastete Beispielkante dieser Instanz eingesetzt.</p>"
      );
    }
    const delta = Math.sqrt(3 * cp.L * cp.fe);
    const leShow = Math.max(0, cp.le);
    const pSingle = 1 - 1 / (2 * cp.m);
    return tex(
      "<p><strong>Konkret</strong> für Kante $c_{" +
        cp.edgeIdx +
        "}$ in dieser Instanz ($m = " +
        cp.m +
        "$ Kanten): Bei $f_e = " +
        formatInstanzNumber(cp.fe) +
        "$ gilt $\\sqrt{3 \\ln(4m) \\cdot f_e} \\approx " +
        formatInstanzNumber(delta) +
        "$, das Intervall ist also etwa $[" +
        formatInstanzNumber(leShow) +
        ",\\," +
        formatInstanzNumber(cp.ue) +
        "]$. Für diese Kante allein liegt $N_e$ mit Wahrscheinlichkeit mindestens $" +
        formatInstanzNumber(pSingle) +
        "$ in dem Intervall (Schrankenwert $1 - 1/(2m)$).</p>"
    );
  }

  /** „Konkret“-Absatz für Schritt 5, Karte Erfolgswahrscheinlichkeit (Union über m Kanten). */
  function checkerSuccessConcretePhrase() {
    const w = pipeline.wardrop;
    if (!w || !w.ok) {
      return tex(
        "<p><strong>Konkret:</strong> Sobald ein Wardrop-Fluss vorliegt, gilt für diese Instanz mit $m$ Kanten die untere Erfolgswahrscheinlichkeit $\\tfrac{1}{2}$ pro unabhängigem Runden-Versuch (Union-Schranke aus dem Beweis).</p>"
      );
    }
    const m = G.edges.length;
    const pAll = 0.5;
    return tex(
      "<p><strong>Konkret</strong> für diese Instanz ($m = " +
        m +
        "$ Kanten): Ein Runden-Versuch erfüllt $N_e \\in [l_e, u_e]$ für alle Kanten mit Wahrscheinlichkeit <strong>mindestens</strong> $" +
        formatInstanzNumber(pAll) +
        "$. Die tatsächliche Wahrscheinlichkeit kann größer sein.</p>"
    );
  }

  /** Dynamischer „Konkret“-Absatz für Schritt 7, Karte zur hohen Erfolgswahrscheinlichkeit. */
  function whyAlmostAlwaysSuccessConcretePhrase() {
    const w = pipeline.wardrop;
    if (!w || !w.ok || !w.fEdge) {
      return tex(
        "<p><strong>An dieser Instanz:</strong> Sobald ein Wardrop-Fluss vorliegt, zeigt sich hier, wie viele Kanten wenig Last tragen und ob die Spielendenzahl unter der festen Obergrenze liegt.</p>"
      );
    }
    const m = G.edges.length;
    const n = G.commodities.length;
    const L = Math.log(4 * Math.max(1, m));
    const thresh = 3 * L;
    const sixLn = 6 * L;
    let smallCount = 0;
    let zeroCount = 0;
    let bestLargeEi = -1;
    let bestLargeF = thresh;
    for (let ei = 0; ei < G.edges.length; ei++) {
      const fe = w.fEdge[ei] || 0;
      if (fe <= 1e-9) {
        zeroCount++;
        smallCount++;
      } else if (fe < thresh) {
        smallCount++;
      } else if (fe > bestLargeF) {
        bestLargeF = fe;
        bestLargeEi = ei;
      }
    }
    let html =
      "<p><strong>An dieser Instanz</strong> ($m = " +
      m +
      "$ Kanten, $n = " +
      n +
      "$ Spielende): ";
    if (smallCount > 0) {
      html += smallCount + " Kante(n) tragen wenig oder keinen Wardrop-Fluss";
      if (zeroCount > 0) {
        html += " (" + zeroCount + " davon ohne Fluss)";
      }
      html += ". Dort greifen die großzügigen Intervalle für schwach belastete Kanten. ";
    }
    if (sixLn > n) {
      html +=
        "Die feste Obergrenze $6\\ln(4m) \\approx " +
        formatInstanzNumber(sixLn) +
        "$ liegt über der Spielendenzahl. Eine Verletzung der Obergrenze ist damit unmöglich. ";
    } else {
      html +=
        "Hier liegt $n$ nicht unter $6\\ln(4m) \\approx " +
        formatInstanzNumber(sixLn) +
        "$; die Obergrenze ist nicht automatisch durch $N_e \\leq n$ abgesichert. ";
    }
    if (bestLargeEi >= 0) {
      html +=
        "Auf einer stark belasteten Kante liegt $f_e \\approx " +
        formatInstanzNumber(bestLargeF) +
        "$. Das zugehörige Intervall lässt deutlich mehr Spielraum als die übliche Schwankung um diesen Erwartungswert.";
    }
    html += "</p>";
    return tex(html);
  }

  function refreshIntervalCheckResult() {
    const w = pipeline.wardrop;
    if (!w || !w.ok || !pipeline.rounded) {
      pipelineCheckResult = null;
      return null;
    }
    pipelineCheckResult = P.checkRoundedLoadsInIntervals(
      pipeline.rounded,
      G.edges,
      w.fEdge
    );
    return pipelineCheckResult;
  }

  function buildIntervalCheckerPanelHtml() {
    const result = pipelineCheckResult || refreshIntervalCheckResult();
    const attempt = pipelineCheckAttempt;
    let html =
      '<div class="interval-checker-panel decomp-step-panel">' +
      '<p class="decomp-step-lead">' +
      tex(
        "<strong>Intervall-Checker</strong> (Versuch $" +
          attempt +
          "$): Für jede Kante wird geprüft, ob $N_e \\in [l_e, u_e]$ gilt."
      ) +
      "</p>";

    if (!result) {
      html +=
        '<div class="def-box">' +
        tex("<p>Kein gerundetes Profil vorhanden. Zuerst muss randomisiert gerundet werden.</p>") +
        "</div></div>";
      return html;
    }

    const verdictClass = result.ok ? "interval-checker-verdict-ok" : "interval-checker-verdict-bad";
    const verdictText = result.ok
      ? "Erfolg: Alle Lasten liegen in den Intervallen. Unter der Bandbedingung aus Schritt 6 und den Parameteranforderungen aus Schritt 7 ist $\\sigma$ ein $\\varepsilon$-approximiertes Nash-Gleichgewicht."
      : "Noch kein Erfolg: Mindestens eine Kante liegt außerhalb ihres Intervalls. Mit Neu runden einen weiteren unabhängigen Versuch ziehen.";

    html +=
      '<div class="def-box ' +
      verdictClass +
      '">' +
      tex("<p><strong>" + verdictText + "</strong></p>") +
      "</div>" +
      '<table class="interval-checker-table"><thead><tr>' +
      "<th>" +
      tex("Kante") +
      "</th><th>" +
      tex("$f_e$") +
      "</th><th>" +
      tex("$N_e$") +
      "</th><th>" +
      tex("$[l_e, u_e]$") +
      "</th><th>" +
      tex("Status") +
      "</th></tr></thead><tbody>";

    for (let i = 0; i < result.edges.length; i++) {
      const row = result.edges[i];
      const leShow = row.le < 0 ? 0 : row.le;
      const statusClass = row.ok ? "interval-ok" : "interval-bad";
      const statusLabel = row.ok ? "im Intervall" : "außerhalb";
      html +=
        '<tr class="' +
        (row.ok ? "interval-checker-row-ok" : "interval-checker-row-bad") +
        '"><td>' +
        math(edgeNameLatex(G.edges[row.ei], row.ei)) +
        "</td><td>" +
        math(formatInstanzNumber(row.fe)) +
        "</td><td><strong>" +
        row.Ne +
        "</strong></td><td>" +
        math("[" + formatInstanzNumber(leShow) + ",\\," + formatInstanzNumber(row.ue) + "]") +
        "</td><td class=\"" +
        statusClass +
        "\">" +
        statusLabel +
        "</td></tr>";
    }

    html +=
      "</tbody></table>" +
      tex(
        "<p class=\"interval-checker-foot\">Die Prüfung entspricht der hinreichenden Erfolgsbedingung aus dem Beweis zu Satz 3.2. Sie ersetzt nicht die volle Nash-Bedingung, sondern die Intervalle $[l_e, u_e]$ aus den Chernoff-Schranken.</p>"
      ) +
      "</div>";
    return html;
  }

  /** Verteilung der Summe unabhängiger Bernoulli-Variablen (Poisson-Binomial) per DP. */
  function poissonBinomialPmf(probs) {
    let dp = [1];
    for (let i = 0; i < probs.length; i++) {
      const p = probs[i];
      const next = new Array(dp.length + 1).fill(0);
      for (let j = 0; j < dp.length; j++) {
        next[j] += dp[j] * (1 - p);
        next[j + 1] += dp[j] * p;
      }
      dp = next;
    }
    return dp;
  }

  function plotFormatTick(v) {
    if (!isFinite(v)) return "";
    const av = Math.abs(v);
    if (av >= 1000) return v.toFixed(0);
    if (av >= 100) return v.toFixed(0);
    if (av >= 10) return Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
    if (av >= 1) return v.toFixed(1);
    if (av >= 0.01) return v.toFixed(2);
    if (av === 0) return "0";
    return v.toExponential(1);
  }

  function plotTickValues(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) return [0];
    if (max <= min) return [min];
    const rough = (max - min) / Math.max(2, count - 1);
    if (rough <= 0) return [min, max];
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const steps = [1, 2, 2.5, 5, 10];
    let step = steps[steps.length - 1] * pow;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i] * pow >= rough) {
        step = steps[i] * pow;
        break;
      }
    }
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 0.001; v += step) ticks.push(v);
    if (ticks.length === 0) ticks.push(min, max);
    return ticks;
  }

  function plotNumericTicks(xmin, xmax, ymin, ymax, sx, sy) {
    const xTicks = plotTickValues(xmin, xmax, 8);
    for (let i = 0; i < xTicks.length; i++) {
      const x = xTicks[i];
      const px = sx(x);
      if (px < PLOT_BOX.x0 - 0.5 || px > PLOT_BOX.x1 + 0.5) continue;
      gPlotContent
        .append("line")
        .attr("class", "plot-grid")
        .attr("x1", px)
        .attr("x2", px)
        .attr("y1", PLOT_BOX.y0)
        .attr("y2", PLOT_BOX.y1);
      gPlotChrome
        .append("text")
        .attr("class", "plot-tick")
        .attr("x", px)
        .attr("y", PLOT_BOX.y1 + 16)
        .attr("text-anchor", "middle")
        .text(plotFormatTick(x));
    }
    const yTicks = plotTickValues(ymin, ymax, 7);
    for (let i = 0; i < yTicks.length; i++) {
      const y = yTicks[i];
      const py = sy(y);
      if (py < PLOT_BOX.y0 - 0.5 || py > PLOT_BOX.y1 + 0.5) continue;
      gPlotContent
        .append("line")
        .attr("class", "plot-grid")
        .attr("x1", PLOT_BOX.x0)
        .attr("x2", PLOT_BOX.x1)
        .attr("y1", py)
        .attr("y2", py);
      gPlotChrome
        .append("text")
        .attr("class", "plot-tick")
        .attr("x", PLOT_BOX.x0 - 6)
        .attr("y", py + 3.5)
        .attr("text-anchor", "end")
        .text(plotFormatTick(y));
    }
  }

  function plotScales(xmin, xmax, ymin, ymax) {
    const w = PLOT_BOX.x1 - PLOT_BOX.x0;
    const h = PLOT_BOX.y1 - PLOT_BOX.y0;
    const sx = (x) => PLOT_BOX.x0 + (xmax <= xmin ? 0 : (x - xmin) / (xmax - xmin)) * w;
    const sy = (y) => PLOT_BOX.y1 - (ymax <= ymin ? 0 : (y - ymin) / (ymax - ymin)) * h;
    return { sx, sy };
  }

  function plotAxes(xlabel, ylabel, title, domain) {
    gPlotChrome
      .append("line")
      .attr("class", "plot-axis")
      .attr("x1", PLOT_BOX.x0)
      .attr("y1", PLOT_BOX.y1)
      .attr("x2", PLOT_BOX.x1)
      .attr("y2", PLOT_BOX.y1);
    gPlotChrome
      .append("line")
      .attr("class", "plot-axis")
      .attr("x1", PLOT_BOX.x0)
      .attr("y1", PLOT_BOX.y1)
      .attr("x2", PLOT_BOX.x0)
      .attr("y2", PLOT_BOX.y0);
    if (domain) {
      const { sx, sy } = plotScales(domain.xmin, domain.xmax, domain.ymin, domain.ymax);
      plotNumericTicks(domain.xmin, domain.xmax, domain.ymin, domain.ymax, sx, sy);
    }
    if (xlabel) {
      const xEl = gPlotChrome
        .append("text")
        .attr("class", "plot-axis-label")
        .attr("x", (PLOT_BOX.x0 + PLOT_BOX.x1) / 2)
        .attr("y", PLOT_BOX.y1 + 38)
        .attr("text-anchor", "middle");
      if (typeof xlabel === "string") xEl.text(xlabel);
      else setSvgMathLabel(xEl.node(), xlabel);
    }
    if (ylabel) {
      const yMid = (PLOT_BOX.y0 + PLOT_BOX.y1) / 2;
      const yEl = gPlotChrome
        .append("text")
        .attr("class", "plot-axis-label plot-axis-label-y")
        .attr("transform", "rotate(-90)")
        .attr("x", -yMid)
        .attr("y", 18)
        .attr("text-anchor", "middle");
      if (typeof ylabel === "string") yEl.text(ylabel);
      else setSvgMathLabel(yEl.node(), ylabel);
    }
    if (title) {
      const titleSel = gPlotChrome
        .append("text")
        .attr("class", "plot-title")
        .attr("x", (PLOT_BOX.x0 + PLOT_BOX.x1) / 2)
        .attr("y", 16)
        .attr("text-anchor", "middle");
      if (typeof title === "object" && (title.edgeIdx != null || title.segmentsBefore)) {
        setSvgPlotTitle(titleSel.node(), title);
      } else if (Array.isArray(title)) {
        setSvgMathLabel(titleSel.node(), title);
      } else {
        titleSel.text(title);
      }
    }
  }

  function plotCurvePath(fn, xmin, xmax, sx, sy, ymax) {
    const N = 220;
    let d = "";
    let started = false;
    for (let i = 0; i <= N; i++) {
      const x = xmin + ((xmax - xmin) * i) / N;
      let y = fn(x);
      if (!isFinite(y)) {
        started = false;
        continue;
      }
      y = Math.min(y, ymax * 1.4);
      const px = sx(x);
      const py = sy(y);
      d += (started ? "L" : "M") + px.toFixed(2) + " " + py.toFixed(2) + " ";
      started = true;
    }
    return d;
  }

  function plotVerticalMarker(xVal, sx, label, color, dashed) {
    const px = sx(xVal);
    if (px < PLOT_BOX.x0 - 0.5 || px > PLOT_BOX.x1 + 0.5) return;
    gPlotContent
      .append("line")
      .attr("x1", px)
      .attr("y1", PLOT_BOX.y0)
      .attr("x2", px)
      .attr("y2", PLOT_BOX.y1)
      .attr("stroke", color)
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", dashed ? "4 4" : null);
    if (label) {
      const labelEl = gPlotContent
        .append("text")
        .attr("class", "plot-marker-label")
        .attr("x", px)
        .attr("y", PLOT_BOX.y0 + 11)
        .attr("text-anchor", "middle")
        .attr("fill", color);
      if (typeof label === "string") labelEl.text(label);
      else setSvgMathLabel(labelEl.node(), label);
    }
  }

  function plotMessage(msg) {
    gPlotChrome
      .append("text")
      .attr("class", "plot-message")
      .attr("x", (PLOT_BOX.x0 + PLOT_BOX.x1) / 2)
      .attr("y", (PLOT_BOX.y0 + PLOT_BOX.y1) / 2)
      .attr("text-anchor", "middle")
      .text(msg);
  }

  function renderChernoffPlot() {
    const cp = chernoffParams();
    if (!cp || cp.probs.length === 0) {
      plotMessage("Für ein Histogramm wird ein Wardrop-Fluss mit belasteten Kanten benötigt.");
      return;
    }
    const pmf = poissonBinomialPmf(cp.probs);
    const K = cp.probs.length;
    let dataYmax = 0;
    for (let i = 0; i < pmf.length; i++) dataYmax = Math.max(dataYmax, pmf[i]);
    dataYmax = Math.max(dataYmax, 0.05) * 1.18;
    const defXmax = Math.max(K, cp.ue) * 1.05 + 0.5;
    const domain = resolvePlotDomain("chernoff", {
      xmin: 0,
      xmax: defXmax,
      ymin: 0,
      ymax: dataYmax,
    });
    const { sx, sy } = plotScales(domain.xmin, domain.xmax, domain.ymin, domain.ymax);

    const relChernoffSlide =
      pipelineIntroSlide - PIPELINE_STEP5_CHERNOFF_SLIDE;
    const showInterval = relChernoffSlide >= 2;
    if (showInterval) {
      const lo = Math.max(0, cp.le);
      const hi = Math.min(domain.xmax, cp.ue);
      gPlotContent
        .append("rect")
        .attr("class", "plot-interval-rect")
        .attr("x", sx(lo))
        .attr("y", PLOT_BOX.y0)
        .attr("width", Math.max(0, sx(hi) - sx(lo)))
        .attr("height", PLOT_BOX.y1 - PLOT_BOX.y0)
        .attr("fill", PLOT_COL.interval)
        .attr("stroke", PLOT_COL.intervalStroke)
        .attr("stroke-dasharray", "4 4");
    }

    plotAxes(["Last ", mvar("N", "e")], "Wahrscheinlichkeit", {
      segmentsBefore: ["Verteilung der Kantenlast ", mvar("N", "e"), " ("],
      edgeIdx: cp.edgeIdx,
      after: ")",
    }, domain);

    const barW = Math.max(1.5, (sx(1) - sx(0)) * 0.72);
    const barData = pmf
      .map((p, v) => ({ v, p }))
      .filter((d) => d.v >= domain.xmin - 1 && d.v <= domain.xmax + 1);
    const bars = gPlotContent
      .selectAll("rect.plot-bar")
      .data(barData)
      .join("rect")
      .attr("class", "plot-bar")
      .attr("x", (d) => sx(d.v) - barW / 2)
      .attr("width", barW)
      .attr("fill", PLOT_COL.bar)
      .attr("stroke", PLOT_COL.barStroke)
      .attr("stroke-width", 0.75)
      .attr("y", PLOT_BOX.y1)
      .attr("height", 0);
    if (plotInstantRender) {
      bars
        .attr("y", (d) => sy(d.p))
        .attr("height", (d) => PLOT_BOX.y1 - sy(d.p));
    } else {
      bars
        .transition()
        .duration(620)
        .ease(d3.easeCubicOut)
        .attr("y", (d) => sy(d.p))
        .attr("height", (d) => PLOT_BOX.y1 - sy(d.p));
    }

    plotVerticalMarker(cp.fe, sx, [mvar("f", "e"), " ≈ ", cp.fe.toFixed(1)], PLOT_COL.mean, false);
    if (showInterval) {
      const noteEl = gPlotContent
        .append("text")
        .attr("class", "plot-note")
        .attr("x", PLOT_BOX.x1)
        .attr("y", PLOT_BOX.y0 + 6)
        .attr("text-anchor", "end");
      setSvgMathLabel(noteEl.node(), [
        "Intervall [",
        mvar("l", "e"),
        ", ",
        mvar("u", "e"),
        "] (blau)",
      ]);
    }
    const footEl = gPlotContent
      .append("text")
      .attr("class", "plot-note")
      .attr("x", PLOT_BOX.x0 + 4)
      .attr("y", PLOT_BOX.y0 + 6)
      .attr("text-anchor", "start");
    setSvgMathLabel(footEl.node(), [
      String(K) + " Spielende auf der Kante, ",
      mvar("E", null),
      "[",
      mvar("N", "e"),
      "] = ",
      mvar("f", "e"),
    ]);
  }

  /** Zeichnet eine Verzögerungsfunktion cfn(x) mit Toleranzband und Konzentrationsintervall. */
  function drawConditionPlot(cfn, fe, le, ue, opts) {
    opts = opts || {};
    const cf = cfn(fe);
    const band = Math.sqrt(1 + PLOT_EPS);
    const bandLow = cf / band;
    const bandHigh = cf * band;
    const intervalSpan = Math.max(0.8, ue - le);
    const xMargin = intervalSpan * 0.12;
    const defXmin = opts.bad ? Math.max(0, le - xMargin) : 0;
    const defXmax = opts.bad
      ? ue + xMargin
      : Math.max(ue * 1.18, fe * 1.6, 1);
    let dataYmax = bandHigh;
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const x = defXmin + ((defXmax - defXmin) * i) / N;
      const y = cfn(x);
      if (isFinite(y)) dataYmax = Math.max(dataYmax, y);
    }
    dataYmax = dataYmax * 1.12;
    const kind = plotKindForState() || "condition";
    const domain = resolvePlotDomain(kind, {
      xmin: defXmin,
      xmax: defXmax,
      ymin: 0,
      ymax: dataYmax,
    });
    const xmax = domain.xmax;
    let ymax = domain.ymax;
    const { sx, sy } = plotScales(domain.xmin, domain.xmax, domain.ymin, domain.ymax);

    const lo = Math.max(domain.xmin, le);
    gPlotContent
      .append("rect")
      .attr("x", sx(lo))
      .attr("y", PLOT_BOX.y0)
      .attr("width", Math.max(0, sx(Math.min(xmax, ue)) - sx(lo)))
      .attr("height", PLOT_BOX.y1 - PLOT_BOX.y0)
      .attr("fill", PLOT_COL.interval)
      .attr("stroke", PLOT_COL.intervalStroke)
      .attr("stroke-dasharray", "4 4");

    gPlotContent
      .append("rect")
      .attr("x", PLOT_BOX.x0)
      .attr("y", sy(bandHigh))
      .attr("width", PLOT_BOX.x1 - PLOT_BOX.x0)
      .attr("height", Math.max(0, sy(bandLow) - sy(bandHigh)))
      .attr("fill", PLOT_COL.band)
      .attr("stroke", PLOT_COL.bandStroke)
      .attr("stroke-dasharray", "4 4");

    plotAxes(["Last ", "x"], ["Verzögerung ", mvar("c", "e"), "(", "x", ")"], opts.title || "", domain);

    gPlotContent
      .append("path")
      .attr("d", plotCurvePath(cfn, domain.xmin, xmax, sx, sy, ymax))
      .attr("fill", "none")
      .attr("stroke", opts.bad ? PLOT_COL.bad : PLOT_COL.curve)
      .attr("stroke-width", 2.4);

    plotVerticalMarker(fe, sx, mvar("f", "e"), PLOT_COL.mean, false);
    if (le > 0) plotVerticalMarker(le, sx, mvar("l", "e"), PLOT_COL.intervalStroke, true);
    plotVerticalMarker(ue, sx, mvar("u", "e"), PLOT_COL.intervalStroke, true);

    gPlotContent
      .append("circle")
      .attr("cx", sx(fe))
      .attr("cy", sy(cf))
      .attr("r", 4)
      .attr("fill", PLOT_COL.mean);

    if (opts.showVerdict !== false) {
      const cLo = cfn(lo);
      const cHi = cfn(ue);
      const ok = cHi <= bandHigh + 1e-9 && cLo >= bandLow - 1e-9;
      const verdict = opts.forceVerdict !== undefined ? opts.forceVerdict : ok;
      gPlotContent
        .append("text")
        .attr("class", "plot-verdict")
        .attr("x", PLOT_BOX.x1)
        .attr("y", PLOT_BOX.y0 + 8)
        .attr("text-anchor", "end")
        .attr("fill", verdict ? PLOT_COL.good : PLOT_COL.bad)
        .text(verdict ? "Band eingehalten ✓" : "Band verlassen ✗");
    }
    const bandEl = gPlotContent
      .append("text")
      .attr("class", "plot-note")
      .attr("x", PLOT_BOX.x0 + 4)
      .attr("y", PLOT_BOX.y0 + 8)
      .attr("text-anchor", "start");
    setSvgMathLabel(bandEl.node(), [
      "Band: ",
      mvar("c", "e"),
      "(",
      mvar("f", "e"),
      ")/√(1+ε) … √(1+ε)·",
      mvar("c", "e"),
      "(",
      mvar("f", "e"),
      "), ε = ",
      String(PLOT_EPS),
    ]);
    if (opts.note) {
      const noteEl = gPlotContent
        .append("text")
        .attr("class", "plot-note")
        .attr("x", PLOT_BOX.x0 + 4)
        .attr("y", PLOT_BOX.y0 + 22)
        .attr("text-anchor", "start");
      if (typeof opts.note === "string") noteEl.text(opts.note);
      else setSvgMathLabel(noteEl.node(), opts.note);
    }
    if (opts.illustrative) {
      const illY = PLOT_BOX.y0 + (opts.note ? 36 : 22);
      gPlotContent
        .append("text")
        .attr("class", "plot-note")
        .attr("x", PLOT_BOX.x0 + 4)
        .attr("y", illY)
        .attr("text-anchor", "start")
        .text(ILLUSTRATIVE_PLOT_NOTE);
    }
  }

  function renderConditionPlot() {
    const { fe, le, ue } = illustrativeBandInterval();
    if (pipelineIntroSlide >= 3) {
      drawConditionPlot(illustrativeCounterexampleFn(fe, ue), fe, le, ue, {
        title: "Gegenbeispiel: zu steile Verzögerung",
        bad: true,
        forceVerdict: false,
        illustrative: true,
      });
      return;
    }
    drawConditionPlot(illustrativeBandFn, fe, le, ue, {
      title: ["Verzögerung ", mvar("c", "e"), " und Toleranzband"],
      showVerdict: false,
      illustrative: true,
    });
  }

  function renderClassesPlot() {
    const { fe, le, ue } = illustrativeBandInterval();
    const slide = pipelineIntroSlide;

    if (slide >= 4) {
      renderMaxPlot({ illustrative: true });
      return;
    }

    const classTitles = [
      [
        "Zur Erinnerung: das Toleranzband (Beispiel ",
        mvar("f", "e"),
        " = 100, m = 1000)",
      ],
      ["Polynome: Bandbedingung"],
      ["Exponentialfunktionen: Bandbedingung"],
      ["M/M/1: Bandbedingung"],
    ];
    drawConditionPlot(illustrativeBandFn, fe, le, ue, {
      title: classTitles[slide] || classTitles[0],
      showVerdict: false,
      illustrative: true,
    });
  }

  /** Idealisierte Skizze c = max{p, q} (analog Abbildung in der Arbeit). */
  function renderMaxPlot(opts) {
    opts = opts || {};
    // p startet höher und wächst langsam; q startet tiefer, überholt p deutlich sichtbar.
    // defXmax endet kurz nach x*, damit die y-Skala nicht vom Exponentialtail dominiert wird.
    const poly = (x) => 1.5 + 0.2 * x;
    const expo = (x) => 0.8 + 0.4 * Math.exp(x / 3.5);
    const cfn = (x) => Math.max(poly(x), expo(x));
    const defXmax = 7.5;
    let dataYmax = 0;
    for (let i = 0; i <= 60; i++) dataYmax = Math.max(dataYmax, cfn((defXmax * i) / 60));
    dataYmax *= 1.12;
    const domain = resolvePlotDomain("classes", {
      xmin: 0,
      xmax: defXmax,
      ymin: 0,
      ymax: dataYmax,
    });
    const xmax = domain.xmax;
    const ymax = domain.ymax;
    const { sx, sy } = plotScales(domain.xmin, domain.xmax, domain.ymin, domain.ymax);

    plotAxes(
      ["Last ", "x"],
      "Verzögerung",
      ["Punktweises Maximum ", mvar("c"), " = max{", "p", ", ", "q", "}"],
      domain
    );

    gPlotContent
      .append("path")
      .attr("d", plotCurvePath(poly, domain.xmin, xmax, sx, sy, ymax))
      .attr("fill", "none")
      .attr("stroke", PLOT_COL.poly)
      .attr("stroke-width", 1.6)
      .attr("stroke-dasharray", "6 4");
    gPlotContent
      .append("path")
      .attr("d", plotCurvePath(expo, domain.xmin, xmax, sx, sy, ymax))
      .attr("fill", "none")
      .attr("stroke", PLOT_COL.expo)
      .attr("stroke-width", 1.6)
      .attr("stroke-dasharray", "6 4");
    gPlotContent
      .append("path")
      .attr("d", plotCurvePath(cfn, domain.xmin, xmax, sx, sy, ymax))
      .attr("fill", "none")
      .attr("stroke", PLOT_COL.curve)
      .attr("stroke-width", 2.8);

    const noteEl = gPlotContent
      .append("text")
      .attr("class", "plot-note")
      .attr("x", PLOT_BOX.x0 + 4)
      .attr("y", PLOT_BOX.y0 + 8)
      .attr("text-anchor", "start");
    setSvgMathLabel(noteEl.node(), [
      "Links von ",
      mvar("x", null, "*"),
      ": ",
      mvar("c"),
      " = p (blau); rechts davon: ",
      mvar("c"),
      " = q (violett)",
    ]);
    if (opts.illustrative) {
      gPlotContent
        .append("text")
        .attr("class", "plot-note")
        .attr("x", PLOT_BOX.x0 + 4)
        .attr("y", PLOT_BOX.y0 + 22)
        .attr("text-anchor", "start")
        .text(ILLUSTRATIVE_PLOT_NOTE);
    }
  }

  function syncStageViewBox(plotKind) {
    const h = plotKind ? viewHPlot : viewHGraph;
    svg.attr("viewBox", "0 0 " + viewW + " " + h);
    gZoom.select(".pan-bg").attr("height", h);
    svg
      .select("#plot-clip rect")
      .attr("x", PLOT_BOX.x0)
      .attr("y", PLOT_BOX.y0)
      .attr("width", PLOT_BOX.x1 - PLOT_BOX.x0)
      .attr("height", PLOT_BOX.y1 - PLOT_BOX.y0);
    gPlotInteraction
      .select(".plot-zoom-surface")
      .attr("x", PLOT_BOX.x0)
      .attr("y", PLOT_BOX.y0)
      .attr("width", PLOT_BOX.x1 - PLOT_BOX.x0)
      .attr("height", PLOT_BOX.y1 - PLOT_BOX.y0);
  }

  function renderPlotStage(kind) {
    gPlotContent.selectAll("*").remove();
    gPlotChrome.selectAll("*").remove();
    if (kind === "chernoff") renderChernoffPlot();
    else if (kind === "condition") renderConditionPlot();
    else if (kind === "classes") renderClassesPlot();
    gPlotInteraction
      .select(".plot-zoom-surface")
      .style("cursor", kind ? "grab" : "default");
  }

  function renderSvg() {
    const plotKind = plotKindForState();
    pipelineGraphZoomEnabled = !plotKind;
    syncStageViewBox(plotKind);
    syncPipelineGraphHint();
    updateGraphPlayerCountControl();
    if (plotKind) {
      gZoom.node().style.display = "none";
      gPlot.style("display", null);
      renderPlotStage(plotKind);
      return;
    }
    gPlot.style("display", "none");
    gZoom.node().style.display = null;

    const nodes = G.nodes;
    const edges = G.edges;
    const fW = getWardropFEForDisplay();
    const th = computeGraphTutorialHighlight();
    const displayEdges = graphEdgesForRender(edges, fW, th);

    function dragStarted(evt, d) {
      d3.select(this).raise();
      gMain
        .selectAll("text.node-label")
        .filter((nd) => nd.id === d.id)
        .raise();
    }

    function dragged(evt, d) {
      const pt = pointerInGraph(evt);
      d.x = snap(pt[0]);
      d.y = snap(pt[1]);
      renderSvg();
    }

    function dragEnded() {
      invalidateRelaxDemoData();
      renderSvg();
      renderEdgeTable();
    }

    function nodeClicked(evt) {
      evt.stopPropagation();
      if (pipelineLocked) renderSvg();
    }

    const link = gMain.selectAll("path.edge-line").data(displayEdges, (d) => d.id);

    link.join(
      (enter) =>
        enter
          .append("path")
          .attr("class", "edge-line")
          .attr("marker-end", "url(#arr-idle)"),
      (update) => update,
      (exit) => exit.remove()
    ).each(function (d) {
      const su = nodes.find((x) => x.id === d.from);
      const sv = nodes.find((x) => x.id === d.to);
      if (!su || !sv) return;
      const path = trimmedEdgePath(su, sv, NODE_BASE_R + 2);
      d3.select(this).attr("d", path);
      const ei = edges.indexOf(d);
      const fe = fW ? fW[ei] : 0;
      const hasFlow = fe > 1e-6;
      d3.select(this).classed("has-flow", hasFlow);
      d3.select(this).attr("marker-end", hasFlow ? "url(#arr-flow)" : "url(#arr-idle)");
      d3.select(this).attr("stroke", null);
      const onPath =
        th.edgeStrong.has(d.id) ||
        th.edgeSoft.has(d.id) ||
        th.edgeDiscrete.has(d.id) ||
        th.edgeRelaxedA.has(d.id) ||
        th.edgeRelaxedB.has(d.id) ||
        th.wardropEdgePathIdx.has(d.id) ||
        (th.decompPickEdge && th.decompPickEdge.has(d.id)) ||
        (th.decompFocus && th.decompRem && th.decompRem[ei] > 1e-6);
      const wardropColorIdx = th.wardropEdgePathIdx.get(d.id);
      const isDecompPick = th.decompPickEdge && th.decompPickEdge.has(d.id);
      const linkSel = d3.select(this);
      for (let ci = 0; ci < WARDROP_PATH_COLOR_COUNT; ci++) {
        linkSel.classed("wardrop-path-" + ci, wardropColorIdx === ci);
      }
      linkSel
        .classed("tutorial-edge-decomp-pick", isDecompPick)
        .classed("tutorial-edge-path-strong", th.edgeStrong.has(d.id) && !isDecompPick)
        .classed("tutorial-edge-path-soft", th.edgeSoft.has(d.id) && !th.edgeStrong.has(d.id) && !isDecompPick)
        .classed("tutorial-edge-discrete", th.edgeDiscrete.has(d.id))
        .classed("tutorial-edge-relaxed-a", th.edgeRelaxedA.has(d.id))
        .classed("tutorial-edge-relaxed-b", th.edgeRelaxedB.has(d.id))
        .classed(
          "tutorial-edge-dim",
          th.dimUnused && !onPath
        )
        .classed("tutorial-edge-fw-pulse", th.fwPulse && hasFlow && !th.wardropCommodityFocus);
    });

    gMain
      .selectAll("text.edge-flow-label")
      .data(displayEdges, (d) => d.id)
      .join(
        (enter) => enter.append("text").attr("class", "edge-flow-label"),
        (update) => update,
        (exit) => exit.remove()
      )
      .each(function (d) {
        const su = nodes.find((x) => x.id === d.from);
        const sv = nodes.find((x) => x.id === d.to);
        if (!su || !sv) return;
        const ei = edges.indexOf(d);
        const fe = fW ? fW[ei] : 0;
        const edgeIdx = parseEdgeIndex(d.name, ei);
        const dl = delayLabel(d.delay);
        let flowSub = null;
        let flowSup = null;
        let flowVal = null;
        if (th.relaxDemo && pipelineRelaxDemoPhase === "discrete" && th.edgeDiscrete.has(d.id)) {
          flowSub = "e";
          flowSup = "s";
          flowVal = "1";
        } else if (
          th.relaxDemo &&
          pipelineRelaxDemoPhase === "relaxed" &&
          th.relaxEdgeShares.has(d.id)
        ) {
          flowSub = "e";
          flowSup = "s";
          flowVal = "½";
        } else if (th.decompFocus && th.decompCommodityIdx >= 0 && th.decompRem) {
          const rs = th.decompRem[ei] || 0;
          if (rs > 1e-6 || th.decompPickEdge.has(d.id)) {
            flowSub = "e";
            flowSup = "s";
            flowVal = rs.toFixed(2);
          }
        } else if (th.wardropCommodityFocus && pipelineWardropCommodityIdx >= 0 && pipeline.wardrop) {
          const fs =
            pipeline.wardrop.fCommEdge &&
            pipeline.wardrop.fCommEdge[pipelineWardropCommodityIdx]
              ? pipeline.wardrop.fCommEdge[pipelineWardropCommodityIdx][ei] || 0
              : 0;
          if (fs > 1e-6) {
            flowSub = "e";
            flowSup = "s";
            flowVal = fs.toFixed(2);
          }
        } else if (fW) {
          flowSub = "e";
          flowVal = fe.toFixed(2);
        }
        const labelSel = d3.select(this)
          .attr("x", (su.x + sv.x) / 2)
          .attr("y", (su.y + sv.y) / 2 - 22)
          .attr("visibility", showEdgeDelayLabels ? "visible" : "hidden");
        labelSel.selectAll("tspan").remove();
        labelSel.text(null);
        appendSvgEdgeIndexTspans(labelSel, edgeIdx);
        if (showEdgeDelayLabels) labelSel.append("tspan").text(" = " + dl);
        if (flowVal != null) appendSvgFlowSuffix(labelSel, flowSub, flowSup, flowVal);
      });

    gMain.selectAll("g.wardrop-path-label").remove();
    gMain.selectAll("text.edge-flow-label").raise();

    const node = gMain.selectAll("circle.node-disk").data(nodes, (d) => d.id);

    const nodeDrag = d3
      .drag()
      .on("start", dragStarted)
      .on("drag", dragged)
      .on("end", dragEnded);

    node
      .join(
        (enter) =>
          enter
            .append("circle")
            .attr("class", "node-disk")
            .attr("r", 14)
            .on("click", nodeClicked),
        (update) => update.on("click", nodeClicked),
        (exit) => exit.remove()
      )
      .call(nodeDrag)
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .classed("tutorial-node-source", (d) => th.showCommodityNodes && th.sources.has(d.id))
      .classed("tutorial-node-sink", (d) => th.showCommodityNodes && th.sinks.has(d.id));

    gMain
      .selectAll("text.node-label")
      .data(nodes, (d) => d.id)
      .join(
        (enter) =>
          enter.append("text").attr("class", "node-label").attr("font-size", NODE_LABEL_FONT),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("x", (d) => d.x)
      .attr("y", (d) => d.y + 4)
      .each(function (d) {
        setSvgNodeIdLabel(this, d.id);
      });

    gMain.selectAll("text.node-label").raise();
  }

  function invalidatePipeline(options) {
    options = options || {};
    resetPipelineInteractiveState();
    invalidateRelaxDemoData();
    syncEdgeNames();
    pipeline.wardrop = null;
    pipeline.decomp = null;
    pipeline.rounded = null;
    pipeline.stepDone = pipeline.stepDone.map(() => false);
    pipelineWardropCompleted = false;
    if (!options.skipWardropRefresh) refreshWardropValidationPreview();
    renderSvg();
    renderEdgeTable();
    renderStepPanel();
    logLine("Graph geändert: Pipeline zurückgesetzt.");
  }

  /** Nach Parameteränderung: Wardrop neu, Grenzen mit aktuellem f_e, dann Pipeline zurücksetzen. */
  function applyEdgeDelayParameterChange(ei, delaySpec) {
    refreshWardropValidationPreview();
    enforceEdgeDelay(delaySpec, edgeValidationCtx(ei));
    invalidatePipeline({ skipWardropRefresh: true });
  }

  function svgBackgroundClick(evt) {
    if (pipelineLocked) return;
    renderSvg();
  }

  svg.on("click", function (evt) {
    if (isPanBackgroundTarget(evt.target)) svgBackgroundClick(evt);
  });

  function formatBoundRange(name, bound, value, labelLatex) {
    if (!bound || bound.min == null) return "";
    const min = P.effectiveBoundMin(bound.min);
    const minStr =
      min >= 100 ? min.toFixed(1) : min >= 10 ? min.toFixed(2) : min.toFixed(3);
    const interval =
      bound.max != null
        ? "[" + minStr + ", " + bound.max.toFixed(2) + "]"
        : "[" + minStr + ", ∞)";
    if (labelLatex) return math(labelLatex) + " ∈ " + interval;
    return name + " ∈ " + interval;
  }

  function appendParamRow(parent, opts) {
    const row = parent.append("div").attr("class", "param-row");
    const labelEl = row.append("span").attr("class", "param-label");
    if (opts.labelLatex) {
      labelEl.html(math(opts.labelLatex));
    } else {
      labelEl.text(opts.label);
    }
    appendBoundedNumberInput(row, {
      value: opts.value,
      step: opts.step,
      bound: opts.bound,
      wide: opts.wide,
      onApply: opts.onApply,
    });
    if (opts.bound && opts.bound.min != null) {
      const ok = opts.value >= P.effectiveBoundMin(opts.bound.min) - 1e-9;
      const boundEl = row
        .append("span")
        .attr("class", "param-bound " + (ok ? "is-ok" : "is-tight"));
      const boundText = formatBoundRange(
        opts.label,
        opts.bound,
        opts.value,
        opts.labelLatex
      );
      if (opts.labelLatex) boundEl.html(boundText);
      else boundEl.text(boundText);
    }
  }

  function appendParamBoundsIntro(parent) {
    parent
      .append("div")
      .attr("class", "param-bounds-intro")
      .html(
        "Untergrenzen (Kap. 4, bezogen auf u<sub>e</sub>): zu kleine Grundverzögerung / β / μ ⇒ zu steile c<sub>e</sub> auf [l<sub>e</sub>, u<sub>e</sub>]."
      );
  }

  function appendBoundedNumberInput(parent, opts) {
    const effMin =
      opts.bound?.min != null ? P.effectiveBoundMin(opts.bound.min) : null;
    const inp = parent
      .append("input")
      .attr("type", "number")
      .attr("step", opts.step || "0.05")
      .attr(
        "class",
        "param-num-input" + (opts.wide ? " param-num-wide" : "")
      );
    const apply = (raw) => {
      let v = +raw;
      if (!Number.isFinite(v)) v = effMin ?? 0;
      v = P.clampToBounds(v, opts.bound);
      inp.property("value", v);
      inp.classed("param-invalid", false);
      opts.onApply(v);
    };
    inp.property("value", opts.value);
    inp.classed(
      "param-invalid",
      effMin != null && opts.value < effMin - 1e-9
    );
    inp.on("change", function () {
      apply(this.value);
    });
    inp.on("blur", function () {
      apply(this.value);
    });
    inp.on("input", function () {
      const v = +this.value;
      if (!Number.isFinite(v)) {
        inp.classed("param-invalid", this.value !== "" && this.value !== "-");
        return;
      }
      const invalid =
        (effMin != null && v < effMin - 1e-9) ||
        (opts.bound?.max != null && v > opts.bound.max + 1e-9);
      inp.classed("param-invalid", invalid);
    });
  }

  function renderEdgeIntervalCell(tr, ctx, spec) {
    const td = tr.append("td").attr("class", "interval-cell");
    const leShow = ctx.le < 0 ? 0 : ctx.le;
    td.append("div")
      .attr("class", "interval-caption")
      .html("Last-Intervall " + math("N_e"));
    const feEl = td.append("div").attr("class", "interval-fe");
    if (ctx.feEstimated) {
      feEl.html(math("\\hat{f}_e") + "≈ " + ctx.fe.toFixed(2));
    } else {
      feEl.html(math("f_e") + " = " + ctx.fe.toFixed(2));
    }
    td.append("div")
      .attr("class", "interval-range")
      .html(
        math("[") +
          leShow.toFixed(2) +
          ", " +
          ctx.ue.toFixed(2) +
          math("]")
      );
    const status = td.append("div").attr("class", "interval-status");
    if (ctx.fe <= 1e-9) {
      const paramsOk = delayParamsWithinBounds(spec, ctx);
      status
        .attr("class", "interval-status " + (paramsOk ? "interval-ok" : "interval-bad"))
        .text(
          "Kein Fluss · Band entfällt · " +
            (paramsOk ? "Parameter ✓" : "Parameter ✗")
        );
      td.append("div")
        .attr("class", "interval-hint")
        .html(
          "Diese Kante trägt im Wardrop-Fluss keine Last (" +
            math("f_e") +
            "=0). Die Bandbedingung bezieht sich auf " +
            math("c_e(f_e)") +
            " und entfällt hier. Die Parameterbedingung wird trotzdem geprüft."
        );
      renderPipelineMath(td.node());
      return;
    }
    const band = P.checkBandOnInterval(spec, ctx.fe, ctx.le, ctx.ue, ctx.eps);
    const paramsOk = delayParamsWithinBounds(spec, ctx);
    const ok = band.ok && paramsOk;
    status
      .attr("class", "interval-status " + (ok ? "interval-ok" : "interval-bad"))
      .text(
        (band.ok ? "Band ✓" : "Band ✗") +
          " · " +
          (paramsOk ? "Parameter ✓" : "Parameter ✗")
      );
    if (!paramsOk)
      td.append("div")
        .attr("class", "interval-hint")
        .html(math("\\varepsilon") + " = " + ctx.eps + ", Untergrenzen aus " + math("u_e"));
    renderPipelineMath(td.node());
  }

  function renderEdgeTable() {
    if (!pipeline.wardrop?.ok && !wardropValidationPreview?.ok) {
      refreshWardropValidationPreview();
    }
    const tbody = d3.select("#edge-table-body");
    tbody.html("");
    const rows = tbody
      .selectAll("tr")
      .data(G.edges)
      .join("tr");

    rows.each(function (d, ei) {
      const tr = d3.select(this);
      const ctx = edgeValidationCtx(ei);
      tr.append("td").html(edgeNameHtml(d, ei) + " (" + nodePairHtml(d.from, d.to) + ")");
      const tdKind = tr.append("td");
      const sel = tdKind.append("select");
      sel
        .selectAll("option")
        .data(EDGE_DELAY_KINDS)
        .join("option")
        .attr("value", (o) => o.v)
        .text((o) => o.l);
      sel.property("value", d.delay.kind).on("change", function () {
        d.delay = defaultDelaySpec(this.value);
        applyEdgeDelayParameterChange(ei, d.delay);
      });
      renderEdgeIntervalCell(tr, ctx, d.delay);
      renderEdgeParamsRow(tr, d, ctx);
    });
    renderPipelineMath(tbody.node());
  }

  function renderAtomicDelayParams(td, spec, ctx, onChange, opts) {
    opts = opts || {};
    const b = P.delayParameterBounds(spec, ctx.m, ctx.ue, ctx.eps);
    if (!opts.skipIntro) appendParamBoundsIntro(td);
    if (spec.kind === "affine") {
      appendParamRow(td, {
        label: "a",
        value: spec.a,
        step: "0.05",
        bound: b.a,
        onApply: (v) => {
          spec.a = v;
          const b2 = P.delayParameterBounds(spec, ctx.m, ctx.ue, ctx.eps);
          const minB = P.effectiveBoundMin(b2.b.min);
          if (spec.b < minB - 1e-9) spec.b = minB;
          onChange(true);
        },
      });
      appendParamRow(td, {
        label: "b",
        value: spec.b,
        step: "0.05",
        bound: b.b,
        wide: true,
        onApply: (v) => {
          spec.b = v;
          onChange(true);
        },
      });
    } else if (spec.kind === "poly") {
      [0, 1, 2].forEach((i) => {
        appendParamRow(td, {
          labelLatex: "a_" + i,
          value: spec.coeffs[i] || 0,
          step: "0.05",
          bound: b["a" + i],
          wide: i === 0,
          onApply: (v) => {
            spec.coeffs[i] = v;
            if (i > 0) {
              const b2 = P.delayParameterBounds(spec, ctx.m, ctx.ue, ctx.eps);
              const minA0 = P.effectiveBoundMin(b2.a0.min);
              if (spec.coeffs[0] < minA0 - 1e-9) spec.coeffs[0] = minA0;
            }
            onChange(true);
          },
        });
      });
    } else if (spec.kind === "exp") {
      appendParamRow(td, {
        label: "α",
        value: spec.alpha,
        step: "0.05",
        bound: b.alpha,
        onApply: (v) => {
          spec.alpha = v;
          onChange(true);
        },
      });
      appendParamRow(td, {
        label: "β",
        value: spec.beta,
        step: "0.5",
        bound: b.beta,
        wide: true,
        onApply: (v) => {
          spec.beta = v;
          onChange(true);
        },
      });
      appendParamRow(td, {
        label: "γ",
        value: spec.gamma != null ? spec.gamma : 0,
        step: "0.05",
        bound: b.gamma,
        onApply: (v) => {
          spec.gamma = v;
          onChange(true);
        },
      });
    } else if (spec.kind === "mm1") {
      appendParamRow(td, {
        label: "μ",
        value: spec.mu,
        step: "0.5",
        bound: b.mu,
        wide: true,
        onApply: (v) => {
          spec.mu = v;
          onChange(true);
        },
      });
    }
  }

  function renderMaxComponentRow(td, label, spec, ctx, onChange) {
    const row = td.append("div").style("margin-bottom", "0.35rem");
    row.append("span").attr("class", "param-max-label").text(label + " ");
    const sel = row.append("select").style("margin-right", "0.35rem");
    sel
      .selectAll("option")
      .data(ATOMIC_DELAY_KINDS)
      .join("option")
      .attr("value", (o) => o.v)
      .text((o) => o.l);
    sel.property("value", spec.kind).on("change", function () {
      const fresh = defaultDelaySpec(this.value);
      Object.keys(spec).forEach((k) => delete spec[k]);
      Object.assign(spec, fresh);
      onChange(true);
    });
    const params = row.append("div").attr("class", "param-max-block");
    renderAtomicDelayParams(params, spec, ctx, onChange, { skipIntro: true });
  }

  function renderEdgeParamsRow(tr, d, ctx) {
    tr.selectAll("td.param-cell").remove();
    const td = tr.append("td").attr("class", "param-cell");
    const onParamChange = () => {
      applyEdgeDelayParameterChange(ei, d.delay);
    };
    if (d.delay.kind === "max") {
      appendParamBoundsIntro(td);
      renderMaxComponentRow(td, "p:", d.delay.left, ctx, onParamChange);
      renderMaxComponentRow(td, "q:", d.delay.right, ctx, onParamChange);
      return;
    }
    renderAtomicDelayParams(td, d.delay, ctx, onParamChange);
  }

  function renderCommodityPanel() {
    const div = d3.select("#commodity-list");
    div.html("");
    updateInstancePlayerCountControl();
    G.commodities.forEach(function (com, i) {
      const k = i + 1;
      const row = div.append("div").attr("class", "instance-player-row");
      row.append("span").attr("class", "instance-player-label").html(playerIndexHtml(k) + ": ");

      const srcField = row.append("span").attr("class", "instance-player-field");
      srcField.append("span").attr("class", "instance-player-role").html(playerSourceLabelHtml(k));
      const s1 = srcField.append("select");
      G.nodes.forEach(function (n) {
        s1.append("option").attr("value", n.id).text(nodeOptionLabel(n.id));
      });
      s1.property("value", com.sourceId).on("change", function () {
        com.sourceId = this.value;
        invalidatePipeline();
      });

      const snkField = row.append("span").attr("class", "instance-player-field");
      snkField.append("span").attr("class", "instance-player-role").html(playerSinkLabelHtml(k));
      const s2 = snkField.append("select");
      G.nodes.forEach(function (n) {
        s2.append("option").attr("value", n.id).text(nodeOptionLabel(n.id));
      });
      s2.property("value", com.sinkId).on("change", function () {
        com.sinkId = this.value;
        invalidatePipeline();
      });

      if (!shouldShowInstancePlayerCountControl()) {
        row
          .append("button")
          .attr("type", "button")
          .attr("class", "btn-inline-secondary")
          .text("Entfernen")
          .on("click", function () {
            G.commodities = G.commodities.filter(function (x) {
              return x.id !== com.id;
            });
            invalidatePipeline();
            renderCommodityPanel();
          });
      }
    });
    const listNode = document.getElementById("commodity-list");
    if (listNode) renderPipelineMath(listNode);
  }

  function logLine(t) {
    const el = document.getElementById("main-log");
    if (!el) return;
    el.textContent =
      new Date().toLocaleTimeString() + " " + t + "\n" + el.textContent;
  }

  function renderStepPanel() {
    d3.selectAll(".step-btn").each(function () {
      const step = +d3.select(this).attr("data-step");
      d3.select(this).classed("active", currentStep === step);
      let done = !!pipeline.stepDone[step - 1];
      if (step === 1)
        done =
          G.nodes.length > 0 &&
          G.edges.length > 0 &&
          G.commodities.length > 0;
      d3.select(this).classed("done", done);
    });

    const bodies = [
      "",
      document.getElementById("step-1-body"),
      document.getElementById("step-2-body"),
      document.getElementById("step-3-body"),
      document.getElementById("step-4-body"),
      document.getElementById("step-5-body"),
      document.getElementById("step-6-body"),
    ];
    for (let s = 1; s <= 6; s++) {
      const el = bodies[s];
      if (el) el.style.display = currentStep === s ? "block" : "none";
    }

    const w = pipeline.wardrop;
    const box = d3.select("#wardrop-summary");
    if (w && w.ok) {
      if (
        pipelineLocked &&
        pipelineInteractive === "wardrop_fw" &&
        pipelineWardropTrace &&
        pipelineFwIdx >= 0
      ) {
        const t = pipelineWardropTrace[pipelineFwIdx];
        box.text(
          "Pipeline, Zwischenstand nach Iteration " +
            t.iteration +
            ": Zielfunktion ≈ " +
            t.objective.toFixed(5) +
            "\n(Gesamtabbruch des Verfahrens nach " +
            w.iterations +
            " Iterationen, Optimum ≈ " +
            w.objective.toFixed(5) +
            ".)"
        );
      } else {
        box.text(
          "Zielfunktion am Optimum: " +
            w.objective.toFixed(5) +
            "\nIterationen der numerischen Minimierung: " +
            w.iterations
        );
      }
    } else box.text("");

    const db = d3.select("#decomp-log");
    if (pipeline.decomp && pipeline.decomp.ok) {
      const steps = pipeline.decomp.steps;
      const nShow =
        pipelineLocked && pipelineInteractive === "decomp"
          ? Math.min(pipelineDecompReveal, steps.length)
          : steps.length;
      db.text(
        steps.slice(0, nShow).map((s, i) => i + 1 + ". " + s.stepNote).join("\n")
      );
    } else db.text("");

    const rb = d3.select("#round-summary");
    if (pipeline.rounded) {
      const eps = P.minEpsilonApproxNashDiscrete(pipeline.rounded, G.edges);
      const ok = P.isEpsilonApproxDiscrete(pipeline.rounded, G.edges, THESIS_EPS);
      rb.text(
        "Gerundete Kantenlasten (diskret):\n" +
          Array.from(P.edgeLoadsFromDiscrete(pipeline.rounded, G.edges.length))
            .map((v, ei) => edgeName(G.edges[ei], ei) + ":" + v)
            .join(", ") +
          "\n\nHeuristisch geschätztes min. ε (diskretes Spiel): " +
          eps.toFixed(4) +
          "\nBeispiel: erfüllt ε≤" + THESIS_EPS + "? " +
          (ok ? "ja" : "nein") +
          " (nur Illustration, keine Garantie aus den Chernoff-Schritten)."
      );
    } else if (
      pipelineLocked &&
      pipelineRoundActive &&
      pipelineRoundChosen &&
      pipelineRoundRevealed > 0
    ) {
      const partial = pipelineRoundChosen.slice(0, pipelineRoundRevealed);
      rb.text(
        "Teilprofil nach " +
          pipelineRoundRevealed +
          " Ziehung(en) von " +
          pipelineRoundChosen.length +
          ":\n" +
          Array.from(P.edgeLoadsFromDiscrete(partial, G.edges.length))
            .map((v, ei) => edgeName(G.edges[ei], ei) + ":" + v)
            .join(", ") +
          "\n\nDas heuristische ε wird erst nach allen Ziehungen ausgewertet."
      );
    } else if (pipelineLocked && pipelineRoundActive) {
      rb.text(
        "Pipeline: Es liegen noch keine Ziehungen vor. „Weiter“ startet die erste Commodity-Ziehung."
      );
    } else rb.text("");

    const ch = d3.select("#chernoff-box");
    if (w && w.ok) {
      const m = G.edges.length;
      const lines = [];
      lines.push("m = " + m + " Kanten.");
      for (let ei = 0; ei < G.edges.length; ei++) {
        const fe = w.fEdge[ei];
        const ill = P.chernoffIllustration(m, fe);
        if (ill)
          lines.push(
            edgeName(G.edges[ei], ei) +
              ": " +
              "f_e = " +
              fe.toFixed(3) +
              ", δ ≈ " +
              ill.delta.toFixed(3) +
              ", illustrierte obere Tail-Schranke ≈ " +
              ill.upperTailOneSided.toExponential(2)
          );
      }
      lines.push(
        "Vollständige ε-Garantie nach der Arbeit verknüpft zusätzliche Bedingungen an c_e und die Intervalle [l_e, u_e] (Lemma Approximationsgarantie, Satz 3.2)."
      );
      ch.text(lines.join("\n"));
    } else ch.text("");

    updateSvgContextHint();
    updatePipelineExtraNav();
  }

  function updateSvgContextHint() {
    updateGraphPlayerList();
    const el = document.getElementById("svg-context-hint");
    if (!el) return;
    const relaxHint = relaxDemoPhaseHint();
    if (relaxHint) {
      el.textContent = relaxHint;
      el.hidden = false;
      return;
    }
    if (shouldShowWardropCommodityExplorer() && pipelineWardropCommodityIdx >= 0) {
      el.innerHTML =
        playerIndexHtml(pipelineWardropCommodityIdx + 1) +
        ": farbige Pfade im Graphen, Pfadanteile im Fließtext der Karte.";
      el.hidden = false;
      renderPipelineMath(el);
      return;
    }
    if (pipelineInteractive === "interval_check" && pipelineCheckResult) {
      const failed = pipelineCheckResult.edges.filter(function (r) {
        return !r.ok;
      }).length;
      el.innerHTML = pipelineCheckResult.ok
        ? "Intervall-Checker: alle Kanten erfüllen " + math("N_e \\in [l_e, u_e]") + "."
        : "Intervall-Checker: " +
          failed +
          " Kante(n) außerhalb von " +
          math("[l_e, u_e]") +
          " (orange markiert).";
      el.hidden = false;
      renderPipelineMath(el);
      return;
    }
    if (shouldShowDecompDetail() && pipeline.decomp && pipeline.decomp.steps) {
      const stepIdx = Math.min(
        Math.max(pipelineDecompReveal - 1, 0),
        pipeline.decomp.steps.length - 1
      );
      const cur = pipeline.decomp.steps[stepIdx];
      if (cur) {
        el.innerHTML =
          playerIndexHtml(cur.commodityIndex + 1) +
          ": orange = Minimalkante, blau = aktueller Pfad, " +
          math("f_e^s") +
          " = Restfluss vor der Subtraktion.";
        el.hidden = false;
        renderPipelineMath(el);
        return;
      }
    }
    el.textContent = "";
    el.hidden = true;
  }

  function wireInstanceModal() {
    const root = document.getElementById("instance-modal");
    if (!root) return;
    const panel = root.querySelector(".modal-panel");
    function closeInstance() {
      if (isRandomNetworkInstance) syncRandomNetworkBlueprintsFromInstance();
      refreshWardropValidationPreview();
      root.classList.remove("open");
      root.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }
    function openInstance() {
      if (pipelineLocked) return;
      renderEdgeTable();
      renderCommodityPanel();
      updateInstancePlayerCountControl();
      if (!playerCountControlWired) wirePlayerCountControl();
      root.classList.add("open");
      root.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }
    d3.select("#btn-open-instance").on("click", openInstance);
    d3.select(root).select(".modal-close").on("click", closeInstance);
    d3.select(root).select(".modal-backdrop").on("click", closeInstance);
    if (panel) panel.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.classList.contains("open")) closeInstance();
    });
  }

  function sanitizeCommodities() {
    const ids = new Set(G.nodes.map((n) => n.id));
    const before = G.commodities.length;
    G.commodities = G.commodities.filter(
      (c) => ids.has(c.sourceId) && ids.has(c.sinkId)
    );
    if (G.commodities.length !== before) {
      logLine(
        "Spielende bereinigt: " +
          (before - G.commodities.length) +
          " Eintrag/Einträge verwies auf nicht vorhandene Knoten."
      );
      renderCommodityPanel();
    }
  }

  function renderAll() {
    syncEdgeNames();
    renderSvg();
    renderEdgeTable();
    renderCommodityPanel();
    renderStepPanel();
  }

  function wireUi() {
    d3.select("#btn-random").on("click", generateRandomNetwork);

    d3.select("#btn-toggle-edge-costs").on("click", () => {
      showEdgeDelayLabels = !showEdgeDelayLabels;
      updateEdgeCostToggleButton();
      renderSvg();
    });
    updateEdgeCostToggleButton();

    d3.select("#btn-add-commodity").on("click", () => {
      if (G.nodes.length < 2) return;
      G.commodities.push({
        id: "c" + Date.now() + "_" + Math.floor(Math.random() * 9999),
        sourceId: G.nodes[0].id,
        sinkId: G.nodes[G.nodes.length - 1].id,
      });
      invalidatePipeline();
      renderCommodityPanel();
    });

    d3.select("#btn-pipeline-start").on("click", startPipeline);
    d3.select("#btn-pipeline-abort").on("click", abortPipeline);
    d3.select("#btn-pipeline-back").on("click", pipelineBack);
    d3.select("#btn-pipeline-fwd").on("click", pipelineForward);
    const skipAll = document.getElementById("btn-pipeline-skip-all");
    if (skipAll) d3.select(skipAll).on("click", pipelineSkipAllInteractive);
    const reround = document.getElementById("btn-pipeline-reround");
    if (reround) d3.select(reround).on("click", pipelineReroundForCheck);

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !pipelineLocked) return;
      const ins = document.getElementById("instance-modal");
      if (ins && ins.classList.contains("open")) return;
      abortPipeline();
    });

    wireInstanceModal();
  }

  wireUi();
  generateRandomNetwork();
})();
