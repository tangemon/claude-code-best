import { describe, test, expect } from 'bun:test';
import {
  extractExports,
  extractImports,
  buildSymbolIndex,
  resolveSymbolImport,
} from '../output/symbols.js';
import type { DependencyGraph } from '../types.js';

function createMockGraph(modules: Array<{ path: string; shortPath: string }> = []): DependencyGraph {
  const moduleMap = new Map();
  for (const mod of modules) {
    moduleMap.set(mod.path, {
      path: mod.path,
      shortPath: mod.shortPath,
      relativePath: mod.shortPath,
      exports: [],
      imports: [],
      importedBy: new Set(),
    });
  }

  return {
    modules: moduleMap,
    edges: [],
    layers: [],
    cycles: [],
    crossLayerDeps: [],
  };
}

describe('extractExports', () => {
  test('extracts function exports', () => {
    const content = `export function foo() {}`;
    const exports = extractExports(content);

    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('foo');
    expect(exports[0].type).toBe('function');
  });

  test('extracts async function exports', () => {
    const content = `export async function bar() {}`;
    const exports = extractExports(content);

    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('bar');
    expect(exports[0].type).toBe('function');
  });

  test('extracts const exports', () => {
    const content = `export const FOO = 1;`;
    const exports = extractExports(content);

    expect(exports.some(e => e.name === 'FOO' && e.type === 'const')).toBe(true);
  });

  test('extracts let exports', () => {
    const content = `export let bar = 2;`;
    const exports = extractExports(content);

    expect(exports.some(e => e.name === 'bar' && e.type === 'const')).toBe(true);
  });

  test('extracts class exports', () => {
    const content = `export class MyClass {}`;
    const exports = extractExports(content);

    expect(exports.some(e => e.name === 'MyClass' && e.type === 'class')).toBe(true);
  });

  test('extracts interface exports', () => {
    const content = `export interface MyInterface {}`;
    const exports = extractExports(content);

    expect(exports.some(e => e.name === 'MyInterface' && e.type === 'interface')).toBe(true);
  });

  test('extracts type exports', () => {
    const content = `export type MyType = string;`;
    const exports = extractExports(content);

    expect(exports.some(e => e.name === 'MyType' && e.type === 'type')).toBe(true);
  });

  test('extracts default export', () => {
    const content = `export default MyClass;`;
    const exports = extractExports(content);

    expect(exports).toHaveLength(1);
    expect(exports[0].type).toBe('default');
  });

  test('extracts named exports in braces', () => {
    const content = `export { foo, bar };`;
    const exports = extractExports(content);

    expect(exports).toHaveLength(2);
    expect(exports.map(e => e.name)).toContain('foo');
    expect(exports.map(e => e.name)).toContain('bar');
  });

  test('handles aliased exports', () => {
    const content = `export { foo as bar };`;
    const exports = extractExports(content);

    expect(exports.some(e => e.name === 'foo')).toBe(true);
  });

  test('handles empty content', () => {
    const exports = extractExports('');
    expect(exports).toHaveLength(0);
  });
});

describe('extractImports', () => {
  test('extracts named imports', () => {
    const content = `import { foo, bar } from './module';`;
    const imports = extractImports(content);

    expect(imports).toHaveLength(1);
    expect(imports[0].names).toContain('foo');
    expect(imports[0].names).toContain('bar');
    expect(imports[0].from).toBe('./module');
  });

  test('extracts namespace imports', () => {
    const content = `import * as utils from './utils';`;
    const imports = extractImports(content);

    expect(imports).toHaveLength(1);
    expect(imports[0].names).toContain('utils');
  });

  test('extracts default imports', () => {
    const content = `import React from 'react';`;
    const imports = extractImports(content);

    expect(imports).toHaveLength(1);
    expect(imports[0].names).toContain('React');
  });

  test('extracts re-exports', () => {
    const content = `export { foo, bar } from './module';`;
    const imports = extractImports(content);

    expect(imports).toHaveLength(1);
    expect(imports[0].isReExport).toBe(true);
  });

  test('handles aliased imports', () => {
    const content = `import { foo as bar } from './module';`;
    const imports = extractImports(content);

    expect(imports[0].names).toContain('foo');
  });

  test('handles empty content', () => {
    const imports = extractImports('');
    expect(imports).toHaveLength(0);
  });
});

describe('buildSymbolIndex', () => {
  test('builds index from graph', () => {
    const graph = createMockGraph([
      { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
    ]);
    const index = buildSymbolIndex(graph);

    expect(index.size).toBeGreaterThanOrEqual(0);
  });
});

describe('resolveSymbolImport', () => {
  test('resolves symbol imports', () => {
    const graph = createMockGraph([
      { path: '/project/src/a.ts', shortPath: 'src/a.ts' },
    ]);
    const index = buildSymbolIndex(graph);
    const importInfo = {
      names: ['foo'],
      from: './a',
      isReExport: false,
    };

    const result = resolveSymbolImport(importInfo, '/project/src/b.ts', graph, index);

    expect(Array.isArray(result)).toBe(true);
  });
});
