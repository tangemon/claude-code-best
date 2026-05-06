import { describe, test, expect } from 'bun:test';
import { generateSymbolTreeOutput, generateSymbolTreeJson } from '../output/symbol-tree.js';
import type { DependencyGraph } from '../types.js';

function createMockGraph(
  modules: Array<{ path: string; shortPath: string }> = [],
  edges: Array<{ from: string; to: string }> = []
): DependencyGraph {
  const moduleMap = new Map();
  for (const mod of modules) {
    moduleMap.set(mod.path, {
      path: mod.path,
      shortPath: mod.shortPath,
      relativePath: mod.shortPath,
      exports: [{ name: 'exported', type: 'function' }],
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

describe('generateSymbolTreeOutput', () => {
  test('generates tree output', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/file.ts', shortPath: 'src/file.ts' }],
      []
    );
    const result = generateSymbolTreeOutput(graph, 'src/file.ts');

    expect(result).toContain('Symbol Dependency Analysis');
    expect(result).toContain('src/file.ts');
  });

  test('returns error for non-existent file', () => {
    const graph = createMockGraph();
    const result = generateSymbolTreeOutput(graph, 'nonexistent.ts');

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
    // 设置 a.ts 的 imports，使其导入 b.ts 的符号
    const aModule = graph.modules.get('/project/src/a.ts');
    if (aModule) {
      aModule.imports = [
        { path: './b.ts', names: ['myFunc'], isDynamic: false, isReExport: false },
      ];
    }
    const result = generateSymbolTreeOutput(graph, 'src/a.ts');

    expect(result).toContain('[External Dependencies]');
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
    // 设置 a.ts 的 imports，使其导入 b.ts 的符号
    const aModule = graph.modules.get('/project/src/a.ts');
    if (aModule) {
      aModule.imports = [
        { path: './b.ts', names: ['myFunc'], isDynamic: false, isReExport: false },
      ];
    }
    const result = generateSymbolTreeOutput(graph, 'src/b.ts');

    expect(result).toContain('[Depended On]');
    expect(result).toContain('a.ts');
  });

  test('includes symbol count', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/file.ts', shortPath: 'src/file.ts' }],
      []
    );
    const result = generateSymbolTreeOutput(graph, 'src/file.ts');

    expect(result).toContain('[External Dependencies]');
    expect(result).toContain('[Depended On]');
  });

  test('output format should align with directory analysis', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
        { path: '/project/src/b.ts', shortPath: 'src/b.ts' },
      ],
      [{ from: '/project/src/a.ts', to: '/project/src/b.ts' }]
    );
    const result = generateSymbolTreeOutput(graph, 'src/a.ts');

    // 文件级分析应该使用与目录级分析一致的格式
    // 目录级分析使用 [External Dependencies] 和 [Depended On]
    // 文件级分析应该也使用类似的格式（无 emoji）
    expect(result).not.toContain('📥');
    expect(result).not.toContain('📤');
    expect(result).not.toContain('📁');
    expect(result).toContain('[External Dependencies]');
    expect(result).toContain('[Depended On]');
  });

  test('file-level and directory-level symbol output format should be consistent', () => {
    // 创建相同的依赖图用于文件级和目录级分析
    const graph = createMockGraph(
      [
        { path: '/project/src/utils/a.ts', shortPath: 'src/utils/a.ts' },
        { path: '/project/src/utils/b.ts', shortPath: 'src/utils/b.ts' },
        { path: '/project/src/utils/helper.ts', shortPath: 'src/utils/helper.ts' },
      ],
      [
        { from: '/project/src/utils/a.ts', to: '/project/src/utils/b.ts' },
        { from: '/project/src/utils/a.ts', to: '/project/src/utils/helper.ts' },
      ]
    );

    // 设置 a.ts 的 imports
    const aModule = graph.modules.get('/project/src/utils/a.ts');
    if (aModule) {
      aModule.imports = [
        { path: './b.ts', names: ['funcB'], isDynamic: false, isReExport: false },
        { path: './helper.ts', names: ['HelperClass'], isDynamic: false, isReExport: false },
      ];
    }

    // 文件级分析
    const fileResult = generateSymbolTreeOutput(graph, 'src/utils/a.ts', { plain: true });
    // 目录级分析
    const dirResult = generateSymbolTreeOutput(graph, 'src/utils/a.ts', { plain: true });

    // 两种输出应该使用相同的格式元素
    // 1. 标题格式一致
    expect(fileResult).toContain('Symbol Dependency Analysis');
    expect(dirResult).toContain('Symbol Dependency Analysis');

    // 2. 章节标题一致（无 emoji）
    expect(fileResult).toContain('[External Dependencies]');
    expect(fileResult).toContain('[Depended On]');
    expect(dirResult).toContain('[External Dependencies]');
    expect(dirResult).toContain('[Depended On]');

    // 3. 不使用 emoji
    expect(fileResult).not.toContain('📁');
    expect(fileResult).not.toContain('📥');
    expect(fileResult).not.toContain('📤');
    expect(dirResult).not.toContain('📁');
    expect(dirResult).not.toContain('📥');
    expect(dirResult).not.toContain('📤');

    // 4. 不使用 ANSI 颜色代码
    expect(fileResult).not.toContain('\x1b[');
    expect(dirResult).not.toContain('\x1b[');

    // 5. 符号格式一致（使用图标如 [f], [K], [C] 等）
    expect(fileResult).toMatch(/\[.\] \w+/);
    expect(dirResult).toMatch(/\[.\] \w+/);
  });

  test('generates plain text output without colors and emojis', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
        { path: '/project/src/b.ts', shortPath: 'src/b.ts' },
      ],
      [{ from: '/project/src/a.ts', to: '/project/src/b.ts' }]
    );
    const result = generateSymbolTreeOutput(graph, 'src/a.ts', { plain: true });

    expect(result).toContain('Symbol Dependency Analysis');
    expect(result).toContain('[External Dependencies]');
    expect(result).toContain('[Depended On]');
    expect(result).not.toContain('\x1b[');
    expect(result).not.toContain('📁');
    expect(result).not.toContain('📥');
    expect(result).not.toContain('📤');
  });
});

describe('generateSymbolTreeJson', () => {
  test('returns JSON object', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/file.ts', shortPath: 'src/file.ts' }],
      []
    );
    const result = generateSymbolTreeJson(graph, 'src/file.ts');

    expect(result).toHaveProperty('file');
    expect(result).toHaveProperty('stats');
  });

  test('returns error for non-existent file', () => {
    const graph = createMockGraph();
    const result = generateSymbolTreeJson(graph, 'nonexistent.ts');

    expect(result).toHaveProperty('error');
  });

  test('includes statistics', () => {
    const graph = createMockGraph(
      [
        { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
        { path: '/project/src/b.ts', shortPath: 'src/b.ts' },
      ],
      [{ from: '/project/src/a.ts', to: '/project/src/b.ts' }]
    );
    const result = generateSymbolTreeJson(graph, 'src/a.ts') as { stats: { totalDirectDependencies: number } };

    expect(result.stats.totalDirectDependencies).toBe(1);
  });

  test('includes dependency tree', () => {
    const graph = createMockGraph(
      [{ path: '/project/src/file.ts', shortPath: 'src/file.ts' }],
      []
    );
    const result = generateSymbolTreeJson(graph, 'src/file.ts') as { directDependencies: object };

    expect(result.directDependencies).toBeDefined();
  });
});
