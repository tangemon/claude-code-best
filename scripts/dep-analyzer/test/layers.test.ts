import { describe, test, expect } from 'bun:test';
import { assignLayers, computeLayers, detectCrossLayerDependencies } from '../graph/layers.js';
import type { DependencyGraph, LayerDefinition } from '../types.js';

function matchPattern(path: string, patterns: string[]): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  for (const pattern of patterns) {
    const patternParts = pattern.split('/');
    const pathParts = normalizedPath.split('/');
    
    let matches = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '**') {
        continue;
      }
      if (patternParts[i] === '*') {
        if (i >= pathParts.length) {
          matches = false;
          break;
        }
        continue;
      }
      if (patternParts[i] !== pathParts[i]) {
        matches = false;
        break;
      }
    }
    
    if (matches && patternParts.length <= pathParts.length) {
      return true;
    }
  }
  return false;
}

function createMockGraph(
  modules: Array<{ path: string; shortPath: string; layer?: string }>,
  edges: Array<{ from: string; to: string }>
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

describe('matchPattern', () => {
  test('matches simple path', () => {
    expect(matchPattern('src/types/global.ts', ['src/types/global.ts'])).toBe(true);
  });

  test('matches wildcard pattern', () => {
    expect(matchPattern('src/types/global.ts', ['src/types/*'])).toBe(true);
    expect(matchPattern('src/types/utils/helper.ts', ['src/types/*'])).toBe(true);
  });

  test('matches double wildcard pattern', () => {
    expect(matchPattern('src/types/global.ts', ['src/types/**'])).toBe(true);
    expect(matchPattern('src/types/utils/helper.ts', ['src/types/**'])).toBe(true);
  });

  test('matches nested wildcard pattern', () => {
    expect(matchPattern('src/utils/helper.ts', ['src/utils/**'])).toBe(true);
    expect(matchPattern('src/utils/nested/deep.ts', ['src/utils/**'])).toBe(true);
  });

  test('does not match non-matching path', () => {
    expect(matchPattern('src/components/Button.tsx', ['src/types/*'])).toBe(false);
  });

  test('handles backslash normalization', () => {
    expect(matchPattern('src\\types\\global.ts', ['src/types/*'])).toBe(true);
  });

  test('matches exact file pattern', () => {
    expect(matchPattern('src/main.tsx', ['src/main.tsx'])).toBe(true);
    expect(matchPattern('src/main.ts', ['src/main.tsx'])).toBe(false);
  });

  test('matches multiple patterns', () => {
    expect(matchPattern('src/types/global.ts', ['src/types/*', 'src/constants/*'])).toBe(true);
  });
});

describe('assignLayers', () => {
  test('assigns types layer', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/types/global.ts', shortPath: 'src/types/global.ts' }],
      []
    );

    assignLayers(graph);

    const module = graph.modules.get('/project/src/types/global.ts');
    expect(module?.layer).toBe('types');
  });

  test('assigns utils layer', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' }],
      []
    );

    assignLayers(graph);

    const module = graph.modules.get('/project/src/utils/helper.ts');
    expect(module?.layer).toBe('utils');
  });

  test('assigns components layer', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/components/Button.tsx', shortPath: 'src/components/Button.tsx' }],
      []
    );

    assignLayers(graph);

    const module = graph.modules.get('/project/src/components/Button.tsx');
    expect(module?.layer).toBe('components');
  });

  test('assigns other layer for unmatched paths', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/unknown/file.ts', shortPath: 'src/unknown/file.ts' }],
      []
    );

    assignLayers(graph);

    const module = graph.modules.get('/project/src/unknown/file.ts');
    expect(module?.layer).toBe('other');
  });

  test('uses custom layer definitions', () => {
    const customDefs: LayerDefinition[] = [
      { name: 'custom', patterns: ['custom/**'] },
    ];
    const graph = createMockGraph(
      [{ path: '/project/custom/module.ts', shortPath: 'custom/module.ts' }],
      []
    );

    assignLayers(graph, customDefs);

    const module = graph.modules.get('/project/custom/module.ts');
    expect(module?.layer).toBe('custom');
  });

  test('assigns multiple modules to correct layers', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/types/global.ts', shortPath: 'src/types/global.ts' },
        { path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' },
        { path: '/project/src/components/Button.tsx', shortPath: 'src/components/Button.tsx' },
      ],
      []
    );

    assignLayers(graph);

    expect(graph.modules.get('/project/src/types/global.ts')?.layer).toBe('types');
    expect(graph.modules.get('/project/src/utils/helper.ts')?.layer).toBe('utils');
    expect(graph.modules.get('/project/src/components/Button.tsx')?.layer).toBe('components');
  });
});

describe('computeLayers', () => {
  test('computes layers with dependencies', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/types/global.ts', shortPath: 'src/types/global.ts' },
        { path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' },
      ],
      [
        { from: '/project/src/utils/helper.ts', to: '/project/src/types/global.ts' },
      ]
    );
    assignLayers(graph);

    const layers = computeLayers(graph);

    const typesLayer = layers.find(l => l.name === 'types');
    const utilsLayer = layers.find(l => l.name === 'utils');

    expect(typesLayer).toBeDefined();
    expect(utilsLayer).toBeDefined();
    expect(utilsLayer?.dependsOn).toContain('types');
    expect(typesLayer?.dependedBy).toContain('utils');
  });

  test('excludes empty layers', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' }],
      []
    );
    assignLayers(graph);

    const layers = computeLayers(graph);

    const emptyLayers = layers.filter(l => l.modules.length === 0);
    expect(emptyLayers).toHaveLength(0);
  });

  test('sorts layers by definition order', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/components/Button.tsx', shortPath: 'src/components/Button.tsx' },
        { path: '/project/src/types/global.ts', shortPath: 'src/types/global.ts' },
      ],
      []
    );
    assignLayers(graph);

    const layers = computeLayers(graph);

    const typesIndex = layers.findIndex(l => l.name === 'types');
    const componentsIndex = layers.findIndex(l => l.name === 'components');
    expect(typesIndex).toBeLessThan(componentsIndex);
  });

  test('computes bidirectional dependencies', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
        { path: '/project/src/b.ts', shortPath: 'src/b.ts' },
      ],
      [
        { from: '/project/src/a.ts', to: '/project/src/b.ts' },
        { from: '/project/src/b.ts', to: '/project/src/a.ts' },
      ]
    );
    assignLayers(graph);

    const layers = computeLayers(graph);

    expect(layers.length).toBeGreaterThan(0);
  });
});

describe('detectCrossLayerDependencies', () => {
  test('detects cross-layer dependencies', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/types/global.ts', shortPath: 'src/types/global.ts' },
        { path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' },
      ],
      [
        { from: '/project/src/utils/helper.ts', to: '/project/src/types/global.ts' },
      ]
    );
    assignLayers(graph);

    const crossLayerDeps = detectCrossLayerDependencies(graph);

    expect(crossLayerDeps.length).toBe(1);
    expect(crossLayerDeps[0].fromLayer).toBe('utils');
    expect(crossLayerDeps[0].toLayer).toBe('types');
  });

  test('returns empty for same-layer dependencies', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/types/a.ts', shortPath: 'src/types/a.ts' },
        { path: '/project/src/types/b.ts', shortPath: 'src/types/b.ts' },
      ],
      [
        { from: '/project/src/types/a.ts', to: '/project/src/types/b.ts' },
      ]
    );
    assignLayers(graph);

    const crossLayerDeps = detectCrossLayerDependencies(graph);

    expect(crossLayerDeps).toHaveLength(0);
  });

  test('detects multiple cross-layer dependencies', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/types/global.ts', shortPath: 'src/types/global.ts' },
        { path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' },
        { path: '/project/src/components/Button.tsx', shortPath: 'src/components/Button.tsx' },
      ],
      [
        { from: '/project/src/utils/helper.ts', to: '/project/src/types/global.ts' },
        { from: '/project/src/components/Button.tsx', to: '/project/src/utils/helper.ts' },
      ]
    );
    assignLayers(graph);

    const crossLayerDeps = detectCrossLayerDependencies(graph);

    expect(crossLayerDeps.length).toBe(2);
  });

  test('returns empty for empty graph', () => {
    const graph = createMockGraph([], []);

    const crossLayerDeps = detectCrossLayerDependencies(graph);

    expect(crossLayerDeps).toHaveLength(0);
  });

  test('includes module paths in result', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/types/global.ts', shortPath: 'src/types/global.ts' },
        { path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' },
      ],
      [
        { from: '/project/src/utils/helper.ts', to: '/project/src/types/global.ts' },
      ]
    );
    assignLayers(graph);

    const crossLayerDeps = detectCrossLayerDependencies(graph);

    expect(crossLayerDeps[0].from).toBe('src/utils/helper.ts');
    expect(crossLayerDeps[0].to).toBe('src/types/global.ts');
  });
});
