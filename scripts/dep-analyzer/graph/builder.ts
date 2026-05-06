import { readFileSync, existsSync } from 'fs';
import { resolve, relative } from 'path';
import { glob } from 'glob';
import type { ModuleInfo, DependencyEdge, DependencyGraph } from '../types.js';
import type { TsconfigResult } from '../parser/tsconfig.js';
import { extractImports, extractExports, extractSymbols, resolveImportPath, getRelativePath } from '../parser/imports.js';

export async function buildDependencyGraph(
  projectRoot: string,
  tsconfig: TsconfigResult,
  patterns: string[] = ['src/**/*.ts', 'src/**/*.tsx', 'packages/**/*.ts', 'packages/**/*.tsx']
): Promise<DependencyGraph> {
  const modules = new Map<string, ModuleInfo>();
  const edges: DependencyEdge[] = [];
  
  const files = await glob(patterns, {
    cwd: projectRoot,
    ignore: ['**/node_modules/**', '**/*.d.ts', '**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    absolute: false,
  });
  
  for (const file of files) {
    const fullPath = resolve(projectRoot, file);
    if (!existsSync(fullPath)) continue;
    
    try {
      const content = readFileSync(fullPath, 'utf-8');
      const imports = extractImports(fullPath, content);
      const exports = extractExports(content);
      const symbols = extractSymbols(content);
      
      modules.set(fullPath, {
        path: fullPath,
        shortPath: file,
        relativePath: file,
        exports,
        imports,
        importedBy: new Set(),
        symbols,
      });
    } catch (error) {
      console.warn(`Failed to parse ${file}: ${error}`);
    }
  }
  
  for (const [modulePath, moduleInfo] of modules) {
    for (const importInfo of moduleInfo.imports) {
      const resolvedPath = resolveImportPath(
        importInfo.path,
        modulePath,
        tsconfig,
        projectRoot
      );
      
      if (resolvedPath && modules.has(resolvedPath)) {
        edges.push({
          from: modulePath,
          to: resolvedPath,
          type: importInfo.isDynamic ? 'dynamic-import' : importInfo.isReExport ? 're-export' : 'import',
          isCircular: false,
        });
        
        const targetModule = modules.get(resolvedPath);
        targetModule.importedBy.add(modulePath);
      }
    }
  }
  
  return { modules, edges, layers: [], cycles: [], crossLayerDeps: [] };
}
