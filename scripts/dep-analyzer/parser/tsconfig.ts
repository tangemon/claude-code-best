import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import type { TsconfigPaths } from '../types.js';

export interface TsconfigResult {
  baseUrl: string;
  paths: TsconfigPaths;
  rootDir?: string;
}

export function parseTsconfig(tsconfigPath: string = 'tsconfig.json'): TsconfigResult {
  const content = readFileSync(tsconfigPath, 'utf-8');
  const config = JSON.parse(content);
  const baseUrl = resolve(dirname(tsconfigPath), config.compilerOptions?.baseUrl || '.');
  
  return {
    baseUrl,
    paths: config.compilerOptions?.paths || {},
    rootDir: config.compilerOptions?.rootDir,
  };
}

export function resolveAlias(
  importPath: string,
  tsconfig: TsconfigResult
): string | null {
  for (const [alias, targets] of Object.entries(tsconfig.paths)) {
    if (alias.endsWith('/*')) {
      const prefix = alias.slice(0, -2);
      if (importPath.startsWith(prefix + '/') || importPath === prefix) {
        const targetBase = (targets as string[])[0].replace(/\/\*$/, '');
        const suffix = importPath.slice(prefix.length);
        return resolve(tsconfig.baseUrl, targetBase + suffix);
      }
    } else if (alias.endsWith('/')) {
      if (importPath.startsWith(alias) || importPath === alias.slice(0, -1)) {
        const targetBase = (targets as string[])[0].replace(/\/\*$/, '');
        const suffix = importPath.slice(alias.length - 1);
        return resolve(tsconfig.baseUrl, targetBase + suffix);
      }
    } else {
      if (importPath === alias || importPath.startsWith(alias + '/')) {
        const target = (targets as string[])[0];
        if (target.includes('*')) {
          const suffix = importPath.slice(alias.length);
          return resolve(tsconfig.baseUrl, target.replace('*', suffix));
        }
        return resolve(tsconfig.baseUrl, target);
      }
    }
  }
  return null;
}

export function normalizeExtension(filePath: string): string {
  if (existsSync(filePath)) {
    return filePath;
  }
  
  const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
  for (const ext of extensions) {
    const withExt = filePath.replace(/\.jsx?$/, '') + ext;
    if (existsSync(withExt)) {
      return withExt;
    }
  }
  
  for (const ext of extensions) {
    const withExt = filePath + ext;
    if (existsSync(withExt)) {
      return withExt;
    }
  }
  
  return filePath;
}
