import { describe, test, expect } from 'bun:test';
import {
  generateFileDependencyGraph,
  generateFileTextReport,
  generateStructuredJson,
  generateTreeOnlyOutput,
  generateDirectoryDependencyGraph,
  generateDirectoryTextReport,
  generateDirectoryJson,
  generateDirectoryTreeOutput,
  generateDirectorySymbolTree,
  treeToString,
} from '../output/file-graph.js';
import type { DependencyGraph } from '../types.js';

function createMockGraph(
  modules: Array<{ path: string; shortPath: string; layer?: string; imports?: Array<{ path: string; names: string[] }> }> = [],
  edges: Array<{ from: string; to: string }> = []
): DependencyGraph {
  const moduleMap = new Map();
  for (const mod of modules) {
    moduleMap.set(mod.path, {
      path: mod.path,
      shortPath: mod.shortPath,
      relativePath: mod.shortPath,
      exports: [{ name: 'exported', type: 'function' }],
      imports: mod.imports || [],
      importedBy: new Set(),
      layer: mod.layer,
      symbols: [{ name: 'exported', type: 'function' }],
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

describe('generateFileDependencyGraph', () => {
  test('generates mermaid graph', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/file.ts', shortPath: 'src/file.ts' }],
      []
    );
    const result = generateFileDependencyGraph(graph, 'src/file.ts');

    expect(result).toContain('```mermaid');
    expect(result).toContain('```');
  });

  test('returns error for non-existent file', () => {
    const graph = createMockGraph();
    const result = generateFileDependencyGraph(graph, 'nonexistent.ts');

    expect(result).toContain('not found');
  });

  test('shows target file', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/target.ts', shortPath: 'src/target.ts' }],
      []
    );
    const result = generateFileDependencyGraph(graph, 'src/target.ts');

    expect(result).toContain('target.ts');
  });

  test('shows dependencies', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
        { path: '/project/src/b.ts', shortPath: 'src/b.ts' },
      ],
      [{ from: '/project/src/a.ts', to: '/project/src/b.ts' }]
    );
    const result = generateFileDependencyGraph(graph, 'src/a.ts');

    expect(result).toContain('b.ts');
  });
});

describe('generateFileTextReport', () => {
  test('generates report with header', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/file.ts', shortPath: 'src/file.ts' }],
      []
    );
    const result = generateFileTextReport(graph, 'src/file.ts');

    expect(result).toContain('文件依赖分析');
    expect(result).toContain('src/file.ts');
  });

  test('returns error for non-existent file', () => {
    const graph = createMockGraph();
    const result = generateFileTextReport(graph, 'nonexistent.ts');

    expect(result).toContain('not found');
  });

  test('shows direct dependencies', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
        { path: '/project/src/b.ts', shortPath: 'src/b.ts' },
      ],
      [{ from: '/project/src/a.ts', to: '/project/src/b.ts' }]
    );
    const result = generateFileTextReport(graph, 'src/a.ts');

    expect(result).toContain('直接依赖');
    expect(result).toContain('b.ts');
  });

  test('shows dependents', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
        { path: '/project/src/b.ts', shortPath: 'src/b.ts' },
      ],
      [{ from: '/project/src/a.ts', to: '/project/src/b.ts' }]
    );
    const result = generateFileTextReport(graph, 'src/b.ts');

    expect(result).toContain('被依赖');
    expect(result).toContain('a.ts');
  });
});

describe('generateStructuredJson', () => {
  test('returns JSON object', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/file.ts', shortPath: 'src/file.ts' }],
      []
    );
    const result = generateStructuredJson(graph, 'src/file.ts');

    expect(result).toHaveProperty('file');
    expect(result).toHaveProperty('stats');
  });

  test('returns error for non-existent file', () => {
    const graph = createMockGraph();
    const result = generateStructuredJson(graph, 'nonexistent.ts');

    expect(result).toHaveProperty('error');
  });

  test('includes dependency statistics', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
        { path: '/project/src/b.ts', shortPath: 'src/b.ts' },
      ],
      [{ from: '/project/src/a.ts', to: '/project/src/b.ts' }]
    );
    const result = generateStructuredJson(graph, 'src/a.ts') as { stats: { totalDirectDependencies: number } };

    expect(result.stats.totalDirectDependencies).toBe(1);
  });
});

describe('generateTreeOnlyOutput', () => {
  test('generates tree output', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/file.ts', shortPath: 'src/file.ts' }],
      []
    );
    const result = generateTreeOnlyOutput(graph, 'src/file.ts');

    expect(result).toContain('依赖分析');
    expect(result).toContain('src/file.ts');
  });

  test('returns error for non-existent file', () => {
    const graph = createMockGraph();
    const result = generateTreeOnlyOutput(graph, 'nonexistent.ts');

    expect(result).toContain('not found');
  });
});

describe('generateDirectoryDependencyGraph', () => {
  test('generates mermaid graph', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' }],
      []
    );
    const result = generateDirectoryDependencyGraph(graph, 'src/utils');

    expect(result).toContain('```mermaid');
  });

  test('returns error for non-existent directory', () => {
    const graph = createMockGraph();
    const result = generateDirectoryDependencyGraph(graph, 'nonexistent');

    expect(result).toContain('not found');
  });

  test('shows directory modules', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' }],
      []
    );
    const result = generateDirectoryDependencyGraph(graph, 'src/utils');

    expect(result).toContain('helper.ts');
  });
});

describe('generateDirectoryTextReport', () => {
  test('generates report with header', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' }],
      []
    );
    const result = generateDirectoryTextReport(graph, 'src/utils');

    expect(result).toContain('目录依赖分析');
    expect(result).toContain('src/utils');
  });

  test('returns error for non-existent directory', () => {
    const graph = createMockGraph();
    const result = generateDirectoryTextReport(graph, 'nonexistent');

    expect(result).toContain('not found');
  });

  test('shows directory files', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' }],
      []
    );
    const result = generateDirectoryTextReport(graph, 'src/utils');

    expect(result).toContain('helper.ts');
  });
});

describe('generateDirectoryJson', () => {
  test('returns JSON object', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' }],
      []
    );
    const result = generateDirectoryJson(graph, 'src/utils');

    expect(result).toHaveProperty('directory');
    expect(result).toHaveProperty('stats');
  });

  test('returns error for non-existent directory', () => {
    const graph = createMockGraph();
    const result = generateDirectoryJson(graph, 'nonexistent');

    expect(result).toHaveProperty('error');
  });
});

describe('generateDirectoryTreeOutput', () => {
  test('generates tree output', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' }],
      []
    );
    const result = generateDirectoryTreeOutput(graph, 'src/utils');

    expect(result).toContain('目录依赖分析');
    expect(result).toContain('src/utils');
  });
});

describe('generateDirectorySymbolTree', () => {
  test('generates symbol tree output', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' }],
      []
    );
    const result = generateDirectorySymbolTree(graph, 'src/utils');

    expect(result).toContain('Symbol Dependency Analysis');
  });

  test('generates plain text output without colors and emojis', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' }],
      []
    );
    const result = generateDirectorySymbolTree(graph, 'src/utils', { plain: true });

    expect(result).toContain('Symbol Dependency Analysis');
    expect(result).toContain('[External Dependencies]');
    expect(result).toContain('[Depended On]');
    expect(result).not.toContain('\x1b[');
    expect(result).not.toContain('📁');
    expect(result).not.toContain('📥');
    expect(result).not.toContain('📤');
  });

  test('plain output uses ASCII characters for tree structure', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' }],
      []
    );
    const result = generateDirectorySymbolTree(graph, 'src/utils', { plain: true });

    expect(result).toContain('Legend:');
    expect(result).toContain('No external dependencies');
  });
});

describe('treeToString', () => {
  test('converts tree to string', () => {
    const tree = {
      name: 'root',
      children: [
        {
          name: 'src',
          children: [
            { name: 'file.ts', isFile: true },
          ],
        },
      ],
    };

    const result = treeToString(tree);

    expect(result).toContain('src');
    expect(result).toContain('file.ts');
  });

  test('handles empty tree', () => {
    const tree = { name: 'root', children: [] };

    const result = treeToString(tree);

    expect(result).toBe('');
  });
});
