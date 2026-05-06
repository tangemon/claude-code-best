import { writeFileSync } from 'fs';
import type { AnalysisResult, DependencyGraph } from '../types.js';

export function exportToJson(result: AnalysisResult, outputPath?: string): string {
  const json = JSON.stringify(result, null, 2);
  if (outputPath) {
    writeFileSync(outputPath, json, 'utf-8');
  }
  return json;
}

export function exportGraphToJson(graph: DependencyGraph, outputPath?: string): string {
  const data = {
    modules: Array.from(graph.modules.entries()).map(([path, info]) => ({
      path: info.shortPath,
      layer: info.layer,
      exports: info.exports.map(e => e.name),
      imports: info.imports.map(i => i.path),
      importedBy: Array.from(info.importedBy).map(p => {
        const m = graph.modules.get(p);
        return m?.shortPath || p;
      }),
    })),
    edges: graph.edges.map(e => ({
      from: graph.modules.get(e.from)?.shortPath || e.from,
      to: graph.modules.get(e.to)?.shortPath || e.to,
      type: e.type,
      isCircular: e.isCircular,
    })),
    cycles: graph.cycles.map(c => ({
      nodes: c.nodes.map(n => {
        const m = graph.modules.get(n);
        return m?.shortPath || n;
      }),
      length: c.length,
    })),
  };
  
  const json = JSON.stringify(data, null, 2);
  if (outputPath) {
    writeFileSync(outputPath, json, 'utf-8');
  }
  return json;
}
