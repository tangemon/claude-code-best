import type { DependencyGraph, Cycle, DependencyEdge } from '../types.js';

export function detectCycles(graph: DependencyGraph): Cycle[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: Cycle[] = [];
  const cycleEdges = new Set<string>();
  
  const adjacencyList = new Map<string, string[]>();
  for (const [module] of graph.modules) {
    adjacencyList.set(module, []);
  }
  for (const edge of graph.edges) {
    adjacencyList.get(edge.from)?.push(edge.to);
  }
  
  function dfs(node: string, path: string[]): void {
    visited.add(node);
    recursionStack.add(node);
    
    const neighbors = adjacencyList.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path, neighbor]);
      } else if (recursionStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1) {
          const cycleNodes = path.slice(cycleStart);
          if (!cycles.some(c => 
            c.nodes.length === cycleNodes.length && 
            c.nodes[0] === cycleNodes[0]
          )) {
            cycles.push({
              nodes: cycleNodes,
              length: cycleNodes.length,
            });
            
            for (let i = 0; i < cycleNodes.length; i++) {
              const from = cycleNodes[i];
              const to = cycleNodes[(i + 1) % cycleNodes.length];
              cycleEdges.add(`${from}|${to}`);
            }
          }
        }
      }
    }
    
    recursionStack.delete(node);
  }
  
  for (const module of graph.modules.keys()) {
    if (!visited.has(module)) {
      dfs(module, [module]);
    }
  }
  
  for (const edge of graph.edges) {
    if (cycleEdges.has(`${edge.from}|${edge.to}`)) {
      edge.isCircular = true;
    }
  }
  
  return cycles;
}

export function getCyclicModules(cycles: Cycle[]): Set<string> {
  const modules = new Set<string>();
  for (const cycle of cycles) {
    for (const node of cycle.nodes) {
      modules.add(node);
    }
  }
  return modules;
}
