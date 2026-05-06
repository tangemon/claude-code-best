import type { DependencyGraph, Layer } from '../types.js';

export function generateMermaidGraph(graph: DependencyGraph, options: {
  showLayers?: boolean;
  maxNodes?: number;
  showCycles?: boolean;
} = {}): string {
  const { showLayers = true, maxNodes = 100, showCycles = true } = options;
  
  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('flowchart LR');
  
  if (showLayers) {
    const layers = new Map<string, string[]>();
    for (const [path, info] of graph.modules) {
      const layer = info.layer || 'other';
      if (!layers.has(layer)) layers.set(layer, []);
      layers.get(layer)!.push(info.shortPath);
    }
    
    for (const [layer, modules] of layers) {
      if (modules.length === 0) continue;
      const subgraphId = layer.replace(/[^a-zA-Z0-9]/g, '_');
      lines.push(`    subgraph ${subgraphId} ["${layer}"]`);
      
      const displayModules = modules.slice(0, Math.ceil(maxNodes / layers.size));
      for (const mod of displayModules) {
        const nodeId = mod.replace(/[^a-zA-Z0-9]/g, '_').replace(/\//g, '_');
        const label = mod.split('/').pop()!;
        lines.push(`        ${nodeId}["${label}"]`);
      }
      
      if (modules.length > displayModules.length) {
        lines.push(`        more_${subgraphId}["... +${modules.length - displayModules.length} more"]`);
      }
      
      lines.push('    end');
    }
  } else {
    let count = 0;
    for (const [path, info] of graph.modules) {
      if (count >= maxNodes) break;
      const nodeId = info.shortPath.replace(/[^a-zA-Z0-9]/g, '_').replace(/\//g, '_');
      const label = info.shortPath.split('/').pop()!;
      lines.push(`    ${nodeId}["${label}"]`);
      count++;
    }
  }
  
  lines.push('');
  
  if (showCycles) {
    const cycleEdges = new Set<string>();
    for (const cycle of graph.cycles) {
      for (let i = 0; i < cycle.nodes.length; i++) {
        const from = cycle.nodes[i];
        const to = cycle.nodes[(i + 1) % cycle.nodes.length];
        cycleEdges.add(`${from}|${to}`);
      }
    }
    
    for (const edge of graph.edges) {
      const fromId = graph.modules.get(edge.from)?.shortPath.replace(/[^a-zA-Z0-9]/g, '_').replace(/\//g, '_') || 'unknown';
      const toId = graph.modules.get(edge.to)?.shortPath.replace(/[^a-zA-Z0-9]/g, '_').replace(/\//g, '_') || 'unknown';
      
      if (showLayers) {
        lines.push(`    ${fromId} --> ${toId}${edge.isCircular ? ':::cycle' : ''}`);
      } else {
        lines.push(`    ${fromId} --> ${toId}`);
      }
    }
    
    if (cycleEdges.size > 0) {
      lines.push('');
      lines.push('    classDef cycle stroke:#f00,stroke-width:2px');
    }
  } else {
    for (const edge of graph.edges) {
      const fromId = graph.modules.get(edge.from)?.shortPath.replace(/[^a-zA-Z0-9]/g, '_').replace(/\//g, '_') || 'unknown';
      const toId = graph.modules.get(edge.to)?.shortPath.replace(/[^a-zA-Z0-9]/g, '_').replace(/\//g, '_') || 'unknown';
      lines.push(`    ${fromId} --> ${toId}`);
    }
  }
  
  lines.push('```');
  
  return lines.join('\n');
}

export function generateLayerDiagram(layers: Layer[]): string {
  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('flowchart TB');
  
  const layerOrder = [
    'types', 'constants', 'utils', 'state', 'services', 'query', 'tools',
    'bridge', 'buddy', 'components', 'commands', 'screens', 'context', 'entrypoints', 'packages'
  ];
  
  const sortedLayers = [...layers].sort((a, b) => {
    const aIdx = layerOrder.indexOf(a.name);
    const bIdx = layerOrder.indexOf(b.name);
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });
  
  for (const layer of sortedLayers) {
    const nodeId = layer.name.replace(/[^a-zA-Z0-9]/g, '_');
    lines.push(`    ${nodeId}["${layer.name} (${layer.modules.length})"]`);
  }
  
  lines.push('');
  
  for (const layer of sortedLayers) {
    const fromId = layer.name.replace(/[^a-zA-Z0-9]/g, '_');
    for (const dep of layer.dependsOn) {
      const toId = dep.replace(/[^a-zA-Z0-9]/g, '_');
      lines.push(`    ${fromId} --> ${toId}`);
    }
  }
  
  lines.push('```');
  
  return lines.join('\n');
}
