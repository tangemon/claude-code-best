import { describe, test, expect } from 'bun:test';
import { exportToJson, exportGraphToJson } from '../output/json.js';
import type { AnalysisResult, DependencyGraph } from '../types.js';

function createMockResult(): AnalysisResult {
  return {
    generated: '2024-01-01T00:00:00.000Z',
    stats: {
      totalModules: 3,
      totalEdges: 2,
      circularDeps: 0,
      crossLayerDeps: 1,
      maxDependencies: 2,
      maxDependents: 1,
    },
    mostIndependent: [],
    mostDependent: [],
    layers: [
      {
        name: 'types',
        description: '类型定义',
        modules: ['src/types/global.ts'],
        dependsOn: [],
        dependedBy: ['utils'],
      },
    ],
    cycles: [],
    crossLayerDeps: [
      {
        from: 'src/utils/helper.ts',
        to: 'src/types/global.ts',
        fromLayer: 'utils',
        toLayer: 'types',
      },
    ],
  };
}

function createMockGraph(): DependencyGraph {
  const moduleMap = new Map();
  moduleMap.set('/project/src/types/global.ts', {
    path: '/project/src/types/global.ts',
    shortPath: 'src/types/global.ts',
    relativePath: 'src/types/global.ts',
    exports: [{ name: 'SomeType', type: 'type' }],
    imports: [],
    importedBy: new Set(['/project/src/utils/helper.ts']),
    layer: 'types',
  });
  moduleMap.set('/project/src/utils/helper.ts', {
    path: '/project/src/utils/helper.ts',
    shortPath: 'src/utils/helper.ts',
    relativePath: 'src/utils/helper.ts',
    exports: [],
    imports: [{ path: './types/global', names: ['SomeType'], isDynamic: false, isReExport: false }],
    importedBy: new Set(),
    layer: 'utils',
  });

  return {
    modules: moduleMap,
    edges: [
      {
        from: '/project/src/utils/helper.ts',
        to: '/project/src/types/global.ts',
        type: 'import',
        isCircular: false,
      },
    ],
    layers: [],
    cycles: [],
    crossLayerDeps: [],
  };
}

describe('exportToJson', () => {
  test('exports result to JSON string', () => {
    const result = createMockResult();
    const json = exportToJson(result);

    expect(json).toBeTruthy();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  test('includes all required fields', () => {
    const result = createMockResult();
    const json = exportToJson(result);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty('generated');
    expect(parsed).toHaveProperty('stats');
    expect(parsed).toHaveProperty('layers');
    expect(parsed).toHaveProperty('cycles');
    expect(parsed).toHaveProperty('crossLayerDeps');
  });

  test('exports statistics correctly', () => {
    const result = createMockResult();
    const json = exportToJson(result);
    const parsed = JSON.parse(json);

    expect(parsed.stats.totalModules).toBe(3);
    expect(parsed.stats.totalEdges).toBe(2);
    expect(parsed.stats.circularDeps).toBe(0);
  });

  test('exports layers correctly', () => {
    const result = createMockResult();
    const json = exportToJson(result);
    const parsed = JSON.parse(json);

    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0].name).toBe('types');
  });

  test('exports cross-layer dependencies', () => {
    const result = createMockResult();
    const json = exportToJson(result);
    const parsed = JSON.parse(json);

    expect(parsed.crossLayerDeps).toHaveLength(1);
    expect(parsed.crossLayerDeps[0].fromLayer).toBe('utils');
    expect(parsed.crossLayerDeps[0].toLayer).toBe('types');
  });

  test('formats JSON with indentation', () => {
    const result = createMockResult();
    const json = exportToJson(result);

    expect(json).toContain('\n');
    expect(json).toContain('  ');
  });
});

describe('exportGraphToJson', () => {
  test('exports graph to JSON string', () => {
    const graph = createMockGraph();
    const json = exportGraphToJson(graph);

    expect(json).toBeTruthy();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  test('includes modules array', () => {
    const graph = createMockGraph();
    const json = exportGraphToJson(graph);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty('modules');
    expect(Array.isArray(parsed.modules)).toBe(true);
  });

  test('includes edges array', () => {
    const graph = createMockGraph();
    const json = exportGraphToJson(graph);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty('edges');
    expect(Array.isArray(parsed.edges)).toBe(true);
    expect(parsed.edges).toHaveLength(1);
  });

  test('includes cycles array', () => {
    const graph = createMockGraph();
    const json = exportGraphToJson(graph);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty('cycles');
    expect(Array.isArray(parsed.cycles)).toBe(true);
  });

  test('converts module paths to short paths', () => {
    const graph = createMockGraph();
    const json = exportGraphToJson(graph);
    const parsed = JSON.parse(json);

    for (const module of parsed.modules) {
      expect(module.path).not.toContain('/project');
    }
  });

  test('exports edge types correctly', () => {
    const graph = createMockGraph();
    const json = exportGraphToJson(graph);
    const parsed = JSON.parse(json);

    expect(parsed.edges[0].type).toBe('import');
    expect(parsed.edges[0].isCircular).toBe(false);
  });

  test('exports importedBy as array', () => {
    const graph = createMockGraph();
    const json = exportGraphToJson(graph);
    const parsed = JSON.parse(json);

    const typesModule = parsed.modules.find((m: { path: string }) => m.path === 'src/types/global.ts');
    expect(typesModule.importedBy).toContain('src/utils/helper.ts');
  });
});
