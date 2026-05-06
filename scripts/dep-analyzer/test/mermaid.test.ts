import { describe, test, expect } from 'bun:test';
import { generateMermaidGraph, generateLayerDiagram } from '../output/mermaid.js';
import type { DependencyGraph, Layer } from '../types.js';

function createMockGraph(
  modules: Array<{ path: string; shortPath: string; layer?: string }> = [],
  edges: Array<{ from: string; to: string; isCircular?: boolean }> = [],
  cycles: Array<{ nodes: string[] }> = []
): DependencyGraph {
  const moduleMap = new Map();
  for (const mod of modules) {
    moduleMap.set(mod.path, {
      path: mod.path,
      shortPath: mod.shortPath,
      relativePath: mod.shortPath,
      exports: [],
      imports: [],
      importedBy: new Set(),
      layer: mod.layer,
    });
  }

  const graphEdges = edges.map(e => ({
    from: e.from,
    to: e.to,
    type: 'import' as const,
    isCircular: e.isCircular || false,
  }));

  return {
    modules: moduleMap,
    edges: graphEdges,
    layers: [],
    cycles,
    crossLayerDeps: [],
  };
}

describe('generateMermaidGraph', () => {
  test('generates mermaid code block', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/a.ts', shortPath: 'src/a.ts' }],
      []
    );
    const result = generateMermaidGraph(graph);

    expect(result).toContain('```mermaid');
    expect(result).toContain('```');
    expect(result).toContain('flowchart');
  });

  test('shows layers by default', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/a.ts', shortPath: 'src/a.ts', layer: 'types' },
        { path: '/project/src/b.ts', shortPath: 'src/b.ts', layer: 'utils' },
      ],
      []
    );
    const result = generateMermaidGraph(graph);

    expect(result).toContain('subgraph');
    expect(result).toContain('types');
    expect(result).toContain('utils');
  });

  test('hides layers when disabled', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/a.ts', shortPath: 'src/a.ts' }],
      []
    );
    const result = generateMermaidGraph(graph, { showLayers: false });

    expect(result).not.toContain('subgraph');
  });

  test('limits nodes when maxNodes specified', () => {
    const modules = Array.from({ length: 20 }, (_, i) => ({
      path: `/project/src/file${i}.ts`,
      shortPath: `src/file${i}.ts`,
      layer: 'other',
    }));
    const graph = createMockGraph(modules, []);
    const result = generateMermaidGraph(graph, { maxNodes: 5 });

    expect(result).toContain('more');
  });

  test('shows edges between nodes', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
        { path: '/project/src/b.ts', shortPath: 'src/b.ts' },
      ],
      [{ from: '/project/src/a.ts', to: '/project/src/b.ts' }]
    );
    const result = generateMermaidGraph(graph, { showLayers: false });

    expect(result).toContain('-->');
  });

  test('marks circular edges', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
        { path: '/project/src/b.ts', shortPath: 'src/b.ts' },
      ],
      [
        { from: '/project/src/a.ts', to: '/project/src/b.ts', isCircular: true },
        { from: '/project/src/b.ts', to: '/project/src/a.ts', isCircular: true },
      ],
      [{ nodes: ['/project/src/a.ts', '/project/src/b.ts', '/project/src/a.ts'] }]
    );
    const result = generateMermaidGraph(graph, { showLayers: false });

    expect(result).toContain('classDef cycle');
  });

  test('handles empty graph', () => {
    const graph = createMockGraph();
    const result = generateMermaidGraph(graph);

    expect(result).toContain('```mermaid');
    expect(result).toContain('```');
  });

  test('uses short path labels', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/deep/nested/file.ts', shortPath: 'src/deep/nested/file.ts' }],
      []
    );
    const result = generateMermaidGraph(graph, { showLayers: false });

    expect(result).toContain('file.ts');
    expect(result).not.toContain('/project');
  });
});

describe('generateLayerDiagram', () => {
  test('generates mermaid code block', () => {
    const layers: Layer[] = [
      {
        name: 'types',
        description: '类型定义',
        modules: ['src/types/global.ts'],
        dependsOn: [],
        dependedBy: ['utils'],
      },
    ];
    const result = generateLayerDiagram(layers);

    expect(result).toContain('```mermaid');
    expect(result).toContain('```');
    expect(result).toContain('flowchart');
  });

  test('shows layer nodes with module counts', () => {
    const layers: Layer[] = [
      {
        name: 'types',
        modules: ['a.ts', 'b.ts'],
        dependsOn: [],
        dependedBy: [],
      },
    ];
    const result = generateLayerDiagram(layers);

    expect(result).toContain('types (2)');
  });

  test('shows dependencies between layers', () => {
    const layers: Layer[] = [
      {
        name: 'types',
        modules: ['a.ts'],
        dependsOn: [],
        dependedBy: ['utils'],
      },
      {
        name: 'utils',
        modules: ['b.ts'],
        dependsOn: ['types'],
        dependedBy: [],
      },
    ];
    const result = generateLayerDiagram(layers);

    expect(result).toContain('utils --> types');
  });

  test('sorts layers by predefined order', () => {
    const layers: Layer[] = [
      { name: 'components', modules: [], dependsOn: [], dependedBy: [] },
      { name: 'types', modules: [], dependsOn: [], dependedBy: [] },
      { name: 'utils', modules: [], dependsOn: [], dependedBy: [] },
    ];
    const result = generateLayerDiagram(layers);

    const typesIndex = result.indexOf('types');
    const utilsIndex = result.indexOf('utils');
    const componentsIndex = result.indexOf('components');
    expect(typesIndex).toBeLessThan(utilsIndex);
    expect(utilsIndex).toBeLessThan(componentsIndex);
  });

  test('handles empty layers array', () => {
    const result = generateLayerDiagram([]);

    expect(result).toContain('```mermaid');
    expect(result).toContain('```');
  });

  test('handles layers with no dependencies', () => {
    const layers: Layer[] = [
      { name: 'types', modules: [], dependsOn: [], dependedBy: [] },
      { name: 'constants', modules: [], dependsOn: [], dependedBy: [] },
    ];
    const result = generateLayerDiagram(layers);

    expect(result).toContain('types');
    expect(result).toContain('constants');
  });
});
