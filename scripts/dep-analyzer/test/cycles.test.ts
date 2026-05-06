import { describe, test, expect } from 'bun:test';
import { detectCycles, getCyclicModules } from '../graph/cycles.js';
import type { DependencyGraph } from '../types.js';

function createMockGraph(
  modules: string[],
  edges: Array<{ from: string; to: string }>
): DependencyGraph {
  const moduleMap = new Map();
  for (const path of modules) {
    moduleMap.set(path, {
      path,
      shortPath: path.split('/').pop() || path,
      relativePath: path,
      exports: [],
      imports: [],
      importedBy: new Set(),
    });
  }

  const graphEdges = edges.map(e => ({
    from: e.from,
    to: e.to,
    type: 'import' as const,
    isCircular: false,
  }));

  for (const edge of graphEdges) {
    const target = moduleMap.get(edge.to);
    if (target) {
      target.importedBy.add(edge.from);
    }
  }

  return {
    modules: moduleMap,
    edges: graphEdges,
    layers: [],
    cycles: [],
    crossLayerDeps: [],
  };
}

describe('detectCycles', () => {
  test('detects no cycles in acyclic graph', () => {
    const graph = createMockGraph(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        { from: 'a.ts', to: 'b.ts' },
        { from: 'b.ts', to: 'c.ts' },
      ]
    );

    const cycles = detectCycles(graph);

    expect(cycles).toHaveLength(0);
    expect(graph.edges.every(e => !e.isCircular)).toBe(true);
  });

  test('detects simple two-node cycle', () => {
    const graph = createMockGraph(
      ['a.ts', 'b.ts'],
      [
        { from: 'a.ts', to: 'b.ts' },
        { from: 'b.ts', to: 'a.ts' },
      ]
    );

    const cycles = detectCycles(graph);

    expect(cycles.length).toBeGreaterThan(0);
    const cycle = cycles[0];
    expect(cycle.nodes).toContain('a.ts');
    expect(cycle.nodes).toContain('b.ts');
    expect(cycle.length).toBe(2);
  });

  test('detects three-node cycle', () => {
    const graph = createMockGraph(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        { from: 'a.ts', to: 'b.ts' },
        { from: 'b.ts', to: 'c.ts' },
        { from: 'c.ts', to: 'a.ts' },
      ]
    );

    const cycles = detectCycles(graph);

    expect(cycles.length).toBeGreaterThan(0);
    const cycle = cycles[0];
    expect(cycle.nodes).toHaveLength(3);
    expect(cycle.length).toBe(3);
  });

  test('detects self-referencing cycle', () => {
    const graph = createMockGraph(
      ['a.ts'],
      [{ from: 'a.ts', to: 'a.ts' }]
    );

    const cycles = detectCycles(graph);

    expect(cycles.length).toBeGreaterThan(0);
  });

  test('marks circular edges', () => {
    const graph = createMockGraph(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        { from: 'a.ts', to: 'b.ts' },
        { from: 'b.ts', to: 'c.ts' },
        { from: 'c.ts', to: 'a.ts' },
      ]
    );

    detectCycles(graph);

    const circularEdges = graph.edges.filter(e => e.isCircular);
    expect(circularEdges.length).toBe(3);
  });

  test('handles graph with multiple cycles', () => {
    const graph = createMockGraph(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      [
        { from: 'a.ts', to: 'b.ts' },
        { from: 'b.ts', to: 'a.ts' },
        { from: 'c.ts', to: 'd.ts' },
        { from: 'd.ts', to: 'c.ts' },
      ]
    );

    const cycles = detectCycles(graph);

    expect(cycles.length).toBeGreaterThanOrEqual(2);
  });

  test('handles empty graph', () => {
    const graph = createMockGraph([], []);

    const cycles = detectCycles(graph);

    expect(cycles).toHaveLength(0);
  });

  test('handles graph with no edges', () => {
    const graph = createMockGraph(['a.ts', 'b.ts', 'c.ts'], []);

    const cycles = detectCycles(graph);

    expect(cycles).toHaveLength(0);
  });

  test('handles complex cycle with branches', () => {
    const graph = createMockGraph(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      [
        { from: 'a.ts', to: 'b.ts' },
        { from: 'a.ts', to: 'c.ts' },
        { from: 'b.ts', to: 'd.ts' },
        { from: 'c.ts', to: 'd.ts' },
        { from: 'd.ts', to: 'a.ts' },
        { from: 'd.ts', to: 'e.ts' },
      ]
    );

    const cycles = detectCycles(graph);

    expect(cycles.length).toBeGreaterThan(0);
    const cycleNodes = cycles.flatMap(c => c.nodes);
    expect(cycleNodes).toContain('a.ts');
    expect(cycleNodes).toContain('d.ts');
  });

  test('does not detect cycle in diamond pattern', () => {
    const graph = createMockGraph(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      [
        { from: 'a.ts', to: 'b.ts' },
        { from: 'a.ts', to: 'c.ts' },
        { from: 'b.ts', to: 'd.ts' },
        { from: 'c.ts', to: 'd.ts' },
      ]
    );

    const cycles = detectCycles(graph);

    expect(cycles).toHaveLength(0);
  });
});

describe('getCyclicModules', () => {
  test('returns empty set for no cycles', () => {
    const cycles: Array<{ nodes: string[]; length: number }> = [];
    const result = getCyclicModules(cycles);
    expect(result.size).toBe(0);
  });

  test('returns all nodes from single cycle', () => {
    const cycles = [{ nodes: ['a.ts', 'b.ts', 'c.ts'], length: 3 }];
    const result = getCyclicModules(cycles);

    expect(result.size).toBe(3);
    expect(result.has('a.ts')).toBe(true);
    expect(result.has('b.ts')).toBe(true);
    expect(result.has('c.ts')).toBe(true);
  });

  test('deduplicates nodes from multiple cycles', () => {
    const cycles = [
      { nodes: ['a.ts', 'b.ts'], length: 2 },
      { nodes: ['b.ts', 'c.ts'], length: 2 },
    ];
    const result = getCyclicModules(cycles);

    expect(result.size).toBe(3);
    expect(result.has('a.ts')).toBe(true);
    expect(result.has('b.ts')).toBe(true);
    expect(result.has('c.ts')).toBe(true);
  });

  test('handles self-referencing cycle', () => {
    const cycles = [{ nodes: ['a.ts'], length: 1 }];
    const result = getCyclicModules(cycles);

    expect(result.size).toBe(1);
    expect(result.has('a.ts')).toBe(true);
  });

  test('handles large cycle', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => `module${i}.ts`);
    const cycles = [{ nodes, length: nodes.length }];
    const result = getCyclicModules(cycles);

    expect(result.size).toBe(10);
    for (const node of nodes) {
      expect(result.has(node)).toBe(true);
    }
  });
});
