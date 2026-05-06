import { describe, test, expect } from 'bun:test';
import {
  extractImports,
  extractExports,
  extractSymbols,
  resolveImportPath,
  getRelativePath,
} from '../parser/imports.js';
import type { TsconfigResult } from '../parser/tsconfig.js';

describe('extractImports', () => {
  test('extracts named imports', () => {
    const content = `import { foo, bar } from './module';`;
    const imports = extractImports('/src/file.ts', content);
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe('./module');
    expect(imports[0].names).toEqual(['foo', 'bar']);
    expect(imports[0].isDynamic).toBe(false);
    expect(imports[0].isReExport).toBe(false);
  });

  test('extracts default import', () => {
    const content = `import React from 'react';`;
    const imports = extractImports('/src/file.ts', content);
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe('react');
    expect(imports[0].names).toEqual(['React']);
  });

  test('extracts type imports', () => {
    const content = `import type { SomeType } from './types';`;
    const imports = extractImports('/src/file.ts', content);
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe('./types');
    expect(imports[0].names).toEqual(['SomeType']);
  });

  test('extracts aliased imports', () => {
    const content = `import { foo as bar } from './module';`;
    const imports = extractImports('/src/file.ts', content);
    expect(imports).toHaveLength(1);
    expect(imports[0].names).toEqual(['foo']);
  });

  test('extracts namespace imports', () => {
    const content = `import * as utils from './utils';`;
    const imports = extractImports('/src/file.ts', content);
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe('./utils');
    expect(imports[0].names).toEqual(['*']);
  });

  test('extracts re-exports', () => {
    const content = `export { foo, bar } from './module';`;
    const imports = extractImports('/src/file.ts', content);
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe('./module');
    expect(imports[0].isReExport).toBe(true);
  });

  test('extracts dynamic imports', () => {
    const content = `const mod = await import('./dynamic');`;
    const imports = extractImports('/src/file.ts', content);
    expect(imports.some(i => i.isDynamic && i.path === './dynamic')).toBe(true);
  });

  test('extracts multiple imports', () => {
    const content = `
      import { a } from './a';
      import { b } from './b';
      import { c } from './c';
    `;
    const imports = extractImports('/src/file.ts', content);
    expect(imports).toHaveLength(3);
  });

  test('handles CommonJS require', () => {
    const content = `const { foo, bar } = require('./module');`;
    const imports = extractImports('/src/file.ts', content);
    expect(imports.some(i => i.path === './module')).toBe(true);
  });

  test('extracts import with relative path using ..', () => {
    const content = `import { getMainLoopModelOverride } from '../../bootstrap/state.js'`;
    const imports = extractImports('/src/utils/model/model.ts', content);
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe('../../bootstrap/state.js');
    expect(imports[0].names).toContain('getMainLoopModelOverride');
  });

  test('extracts import with multiple symbols and relative path', () => {
    const content = `import {
  getSubscriptionType,
  isClaudeAISubscriber,
  isMaxSubscriber,
  isProSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'`;
    const imports = extractImports('/src/utils/model/model.ts', content);
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe('../auth.js');
    expect(imports[0].names).toContain('getSubscriptionType');
    expect(imports[0].names).toContain('isClaudeAISubscriber');
    expect(imports[0].names).toContain('isMaxSubscriber');
    expect(imports[0].names).toContain('isProSubscriber');
    expect(imports[0].names).toContain('isTeamPremiumSubscriber');
  });

  test('extracts import with preceding biome-ignore comment', () => {
    const content = `// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { getMainLoopModelOverride } from '../../bootstrap/state.js'`;
    const imports = extractImports('/src/utils/model/model.ts', content);
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe('../../bootstrap/state.js');
    expect(imports[0].names).toContain('getMainLoopModelOverride');
  });
});

describe('extractExports', () => {
  test('extracts named exports', () => {
    const content = `export { foo, bar };`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(2);
    expect(exports.map(e => e.name)).toEqual(['foo', 'bar']);
  });

  test('extracts default export', () => {
    const content = `export default MyClass;`;
    const exports = extractExports(content);
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('MyClass');
    expect(exports[0].type).toBe('default');
  });

  test('extracts function exports', () => {
    const content = `export function foo() {}`;
    const exports = extractExports(content);
    expect(exports.some(e => e.name === 'foo' && e.type === 'function')).toBe(true);
  });

  test('extracts const exports', () => {
    const content = `export const FOO = 1;`;
    const exports = extractExports(content);
    expect(exports.some(e => e.name === 'FOO' && e.type === 'const')).toBe(true);
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

  test('extracts enum exports', () => {
    const content = `export enum MyEnum {}`;
    const exports = extractExports(content);
    expect(exports.some(e => e.name === 'MyEnum' && e.type === 'enum')).toBe(true);
  });

  test('extracts async function exports', () => {
    const content = `export async function foo() {}`;
    const exports = extractExports(content);
    expect(exports.some(e => e.name === 'foo' && e.type === 'function')).toBe(true);
  });

  test('extracts aliased exports', () => {
    const content = `export { foo as bar };`;
    const exports = extractExports(content);
    expect(exports.some(e => e.name === 'foo')).toBe(true);
  });

  test('extracts function with return type annotation', () => {
    const content = `export function getMainLoopModelOverride(): ModelSetting | undefined {
  return STATE.mainLoopModelOverride
}`;
    const exports = extractExports(content);
    expect(exports.some(e => e.name === 'getMainLoopModelOverride' && e.type === 'function')).toBe(true);
  });

  test('extracts multiple functions with various patterns', () => {
    const content = `
export function getSessionId(): SessionId {
  return STATE.sessionId
}

export function getMainLoopModelOverride(): ModelSetting | undefined {
  return STATE.mainLoopModelOverride
}

export function getInitialMainLoopModel(): ModelSetting {
  return STATE.initialMainLoopModel
}
`;
    const exports = extractExports(content);
    expect(exports.some(e => e.name === 'getSessionId')).toBe(true);
    expect(exports.some(e => e.name === 'getMainLoopModelOverride')).toBe(true);
    expect(exports.some(e => e.name === 'getInitialMainLoopModel')).toBe(true);
  });
});

describe('extractSymbols', () => {
  test('extracts functions', () => {
    const content = `function foo() {}`;
    const symbols = extractSymbols(content);
    expect(symbols.some(s => s.name === 'foo' && s.type === 'function')).toBe(true);
  });

  test('extracts async functions', () => {
    const content = `async function foo() {}`;
    const symbols = extractSymbols(content);
    expect(symbols.some(s => s.name === 'foo' && s.type === 'function')).toBe(true);
  });

  test('extracts classes', () => {
    const content = `class MyClass extends Base {}`;
    const symbols = extractSymbols(content);
    expect(symbols.some(s => s.name === 'MyClass' && s.type === 'class')).toBe(true);
  });

  test('extracts interfaces', () => {
    const content = `interface MyInterface {}`;
    const symbols = extractSymbols(content);
    expect(symbols.some(s => s.name === 'MyInterface' && s.type === 'interface')).toBe(true);
  });

  test('extracts types', () => {
    const content = `type MyType = string;`;
    const symbols = extractSymbols(content);
    expect(symbols.some(s => s.name === 'MyType' && s.type === 'type')).toBe(true);
  });

  test('extracts const declarations', () => {
    const content = `const FOO = 1;`;
    const symbols = extractSymbols(content);
    expect(symbols.some(s => s.name === 'FOO' && s.type === 'const')).toBe(true);
  });

  test('extracts enums', () => {
    const content = `enum MyEnum {}`;
    const symbols = extractSymbols(content);
    expect(symbols.some(s => s.name === 'MyEnum' && s.type === 'enum')).toBe(true);
  });

  test('extracts exported symbols', () => {
    const content = `export function foo() {}`;
    const symbols = extractSymbols(content);
    expect(symbols.some(s => s.name === 'foo' && s.type === 'function')).toBe(true);
  });
});

describe('resolveImportPath', () => {
  const mockTsconfig: TsconfigResult = {
    baseUrl: '/project',
    paths: {
      '@/*': ['src/*'],
      'utils/*': ['src/utils/*'],
      'src/*': ['src/*'],
    },
  };

  test('handles relative imports with path resolution', () => {
    const result = resolveImportPath('./module', '/project/src/file.ts', mockTsconfig, '/project');
    expect(result).toBeTruthy();
  });

  test('handles workspace alias imports', () => {
    const result = resolveImportPath('@/utils/helper', '/project/src/file.ts', mockTsconfig, '/project');
    expect(result).toBeTruthy();
  });

  test('handles src imports with alias resolution', () => {
    const result = resolveImportPath('src/utils/helper', '/project/file.ts', mockTsconfig, '/project');
    expect(result).toBeTruthy();
  });

  test('returns null for bun modules', () => {
    const result = resolveImportPath('bun:bundle', '/project/src/file.ts', mockTsconfig, '/project');
    expect(result).toBeNull();
  });

  test('returns null for node modules', () => {
    const result = resolveImportPath('node:fs', '/project/src/file.ts', mockTsconfig, '/project');
    expect(result).toBeNull();
  });
});

describe('getRelativePath', () => {
  test('returns relative path from project root', () => {
    const result = getRelativePath('/project', '/project/src/file.ts', '/project');
    expect(result).toBe('src/file.ts');
  });

  test('converts backslashes to forward slashes', () => {
    const result = getRelativePath('/project', '/project/src\\file.ts', '/project');
    expect(result).not.toContain('\\');
  });
});
