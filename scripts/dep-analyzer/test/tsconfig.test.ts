import { describe, test, expect, beforeAll } from 'bun:test';
import { parseTsconfig, resolveAlias, normalizeExtension } from '../parser/tsconfig.js';
import { writeFileSync, unlinkSync, mkdirSync, existsSync, rmdirSync } from 'fs';
import { resolve } from 'path';

const testDir = '/tmp/dep-analyzer-test';

function setup() {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }
}

function cleanup() {
  if (existsSync(testDir)) {
    try {
      unlinkSync(resolve(testDir, 'tsconfig.json'));
      unlinkSync(resolve(testDir, 'nested', 'tsconfig.json'));
      unlinkSync(resolve(testDir, 'test.ts'));
      unlinkSync(resolve(testDir, 'test.tsx'));
      unlinkSync(resolve(testDir, 'nested', 'test.ts'));
      unlinkSync(resolve(testDir, 'nested', 'index.ts'));
      rmdirSync(resolve(testDir, 'nested'));
      rmdirSync(testDir);
    } catch {}
  }
}

describe('parseTsconfig', () => {
  beforeAll(() => {
    setup();
  });

  test('parses basic tsconfig.json', () => {
    const config = {
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@/*': ['src/*'],
        },
      },
    };
    writeFileSync(resolve(testDir, 'tsconfig.json'), JSON.stringify(config));

    const result = parseTsconfig(resolve(testDir, 'tsconfig.json'));

    expect(result.baseUrl).toContain('dep-analyzer-test');
    expect(result.paths).toHaveProperty('@/*');
    expect(result.paths['@/*']).toEqual(['src/*']);
  });

  test('handles missing paths', () => {
    const config = {
      compilerOptions: {
        baseUrl: '.',
      },
    };
    writeFileSync(resolve(testDir, 'tsconfig.json'), JSON.stringify(config));

    const result = parseTsconfig(resolve(testDir, 'tsconfig.json'));

    expect(result.paths).toEqual({});
  });

  test('handles missing compilerOptions', () => {
    const config = {};
    writeFileSync(resolve(testDir, 'tsconfig.json'), JSON.stringify(config));

    const result = parseTsconfig(resolve(testDir, 'tsconfig.json'));

    expect(result.baseUrl).toBeDefined();
    expect(result.paths).toEqual({});
  });

  test('resolves baseUrl relative to tsconfig location', () => {
    mkdirSync(resolve(testDir, 'nested'), { recursive: true });
    const config = {
      compilerOptions: {
        baseUrl: '..',
        paths: {},
      },
    };
    writeFileSync(resolve(testDir, 'nested', 'tsconfig.json'), JSON.stringify(config));

    const result = parseTsconfig(resolve(testDir, 'nested', 'tsconfig.json'));

    expect(result.baseUrl).toContain('dep-analyzer-test');
  });

  test('extracts rootDir', () => {
    const config = {
      compilerOptions: {
        baseUrl: '.',
        rootDir: './src',
        paths: {},
      },
    };
    writeFileSync(resolve(testDir, 'tsconfig.json'), JSON.stringify(config));

    const result = parseTsconfig(resolve(testDir, 'tsconfig.json'));

    expect(result.rootDir).toBe('./src');
  });
});

describe('resolveAlias', () => {
  const mockTsconfig = {
    baseUrl: '/project',
    paths: {
      '@/*': ['src/*'],
      'utils/*': ['src/utils/*'],
      'components': ['src/components/index'],
      'lib/': ['lib/'],
    },
  };

  test('resolves wildcard alias with prefix', () => {
    const result = resolveAlias('@/utils/helper', mockTsconfig);
    expect(result).toContain('utils');
    expect(result).toContain('helper');
  });

  test('resolves wildcard alias without suffix', () => {
    const result = resolveAlias('@/components', mockTsconfig);
    expect(result).toContain('components');
  });

  test('resolves exact alias', () => {
    const result = resolveAlias('components', mockTsconfig);
    expect(result).toContain('components');
    expect(result).toContain('index');
  });

  test('resolves trailing slash alias', () => {
    const result = resolveAlias('lib/util', mockTsconfig);
    expect(result).toContain('lib');
    expect(result).toContain('util');
  });

  test('returns null for unmatched alias', () => {
    const result = resolveAlias('unknown/path', mockTsconfig);
    expect(result).toBeNull();
  });

  test('handles alias with nested wildcard', () => {
    const result = resolveAlias('utils/nested/deep', mockTsconfig);
    expect(result).toBeTruthy();
  });
});

describe('normalizeExtension', () => {
  beforeAll(() => {
    setup();
  });

  test('returns existing path as-is', () => {
    writeFileSync(resolve(testDir, 'test.ts'), '');
    const result = normalizeExtension(resolve(testDir, 'test.ts'));
    expect(result).toBe(resolve(testDir, 'test.ts'));
  });

  test('adds .ts extension', () => {
    const result = normalizeExtension(resolve(testDir, 'test'));
    expect(result).toBe(resolve(testDir, 'test.ts'));
  });

  test('adds .tsx extension', () => {
    const result = normalizeExtension(resolve(testDir, 'test'));
    expect(result).toBe(resolve(testDir, 'test.ts'));
  });

  test('adds /index.ts for directories', () => {
    mkdirSync(resolve(testDir, 'nested'), { recursive: true });
    writeFileSync(resolve(testDir, 'nested', 'index.ts'), '');
    const result = normalizeExtension(resolve(testDir, 'nested') + '/index');
    expect(result).toContain('index.ts');
  });

  test('prefers .ts extension', () => {
    writeFileSync(resolve(testDir, 'test.ts'), '');
    const result = normalizeExtension(resolve(testDir, 'test'));
    expect(result).toBe(resolve(testDir, 'test.ts'));
  });

  test('returns original path if no extension matches', () => {
    const result = normalizeExtension(resolve(testDir, 'nonexistent'));
    expect(result).toBe(resolve(testDir, 'nonexistent'));
  });
});
