# Interaktive Visualisierung: Approximierte Nash-Gleichgewichte in Netzwerk-Auslastungsspielen

Browserbasierte Demo zur geführten Pipeline für die Berechnung approximierter Nash-Gleichgewichte in Netzwerk-Auslastungsspielen. Die Anwendung illustriert Schritt für Schritt den Weg von der diskreten Spielinstanz über Relaxierung, Wardrop-Gleichgewicht, Pfadzerlegung und randomisiertes Runden bis zur Chernoff-Konzentration und den hinreichenden Bedingungen an die Verzögerungsfunktionen.

## Voraussetzungen

- [Node.js](https://nodejs.org/) (Version 18 oder neuer empfohlen)
- npm (wird mit Node.js mitgeliefert)

## Installation und Start

```bash
cd d3-demo
npm install
npm start
```

Die Anwendung ist anschließend unter [http://localhost:5173](http://localhost:5173) erreichbar.

## Bedienung

1. Über **Zufallsnetz (komplex)** oder **Instanz bearbeiten** eine Netzwerkinstanz anlegen.
2. Mit **Pipeline starten** die geführte Tour durch die acht Programmschritte beginnen.
3. Rechenphasen schrittweise oder gesammelt durchlaufen; die Graphdarstellung aktualisiert sich entsprechend.

Eine ausführliche Referenz ist in der Oberfläche über den entsprechenden Schalter erreichbar.

## Projektstruktur

```
d3-demo/
  index.html          # Einstiegspunkt
  js/
    app-pipeline.js   # Oberfläche, Pipeline-Steuerung, D3-Visualisierung
    math-pipeline.js  # Numerik (Frank-Wolfe, Pfadzerlegung, Runden, …)
  css/
    pipeline.css      # Layout und Stile
  package.json
```

## Technologie

- [D3.js](https://d3js.org/) für die Netzwerkvisualisierung
- [KaTeX](https://katex.org/) für mathematische Formeln in der Pipeline
- Frank-Wolfe-Verfahren (clientseitig) zur numerischen Annäherung an Wardrop-Gleichgewichte

## Statisches Hosting

Die Demo ist eine reine Client-Anwendung ohne Backend. Sie kann auf GitHub Pages oder einem vergleichbaren statischen Hosting-Dienst bereitgestellt werden. Der Document Root muss auf das Verzeichnis `d3-demo` zeigen (oder der Inhalt von `d3-demo` liegt im Repository-Root des Hosting-Projekts).
