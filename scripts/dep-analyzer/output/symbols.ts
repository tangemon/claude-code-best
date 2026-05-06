import { readFileSync } from 'fs';
import type { DependencyGraph, ModuleInfo } from '../types.js';

export interface ExportSymbol {
  name: string;
  type: 'function' | 'const' | 'class' | 'interface' | 'type' | 'default' | 'unknown';
  line: number;
}

export interface ImportSymbol {
  names: string[];
  from: string;
  isReExport: boolean;
}

export interface FileSymbols {
  file: string;
  exports: ExportSymbol[];
  imports: ImportSymbol[];
}

export function extractExports(content: string): ExportSymbol[] {
  const exports: ExportSymbol[] = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('export function ') || trimmed.startsWith('export async function ')) {
      const match = trimmed.match(/export\s+(?:async\s+)?function\s+(\w+)/);
      if (match) {
        exports.push({ name: match[1], type: 'function', line: i + 1 });
      }
    } else if (trimmed.startsWith('export const ') || trimmed.startsWith('export let ') || trimmed.startsWith('export var ')) {
      const match = trimmed.match(/export\s+(?:const|let|var)\s+(\w+)/);
      if (match) {
        exports.push({ name: match[1], type: 'const', line: i + 1 });
      }
    } else if (trimmed.startsWith('export class ')) {
      const match = trimmed.match(/export\s+class\s+(\w+)/);
      if (match) {
        exports.push({ name: match[1], type: 'class', line: i + 1 });
      }
    } else if (trimmed.startsWith('export interface ')) {
      const match = trimmed.match(/export\s+interface\s+(\w+)/);
      if (match) {
        exports.push({ name: match[1], type: 'interface', line: i + 1 });
      }
    } else if (trimmed.startsWith('export type ')) {
      const match = trimmed.match(/export\s+type\s+(\w+)/);
      if (match) {
        exports.push({ name: match[1], type: 'type', line: i + 1 });
      }
    } else if (trimmed.startsWith('export default ')) {
      const match = trimmed.match(/export\s+default\s+(\w+)?/);
      exports.push({ 
        name: match?.[1] || 'default', 
        type: 'default', 
        line: i + 1 
      });
    }
  }
  
  const namedExportRegex = /export\s+\{([^}]+)\}/g;
  let match;
  while ((match = namedExportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map(n => {
      const parts = n.trim().split(' as ');
      return parts[0].trim();
    }).filter(n => n && !n.startsWith('type '));
    
    for (const name of names) {
      exports.push({ name, type: 'unknown', line: 0 });
    }
  }
  
  return exports;
}

export function extractImports(content: string): ImportSymbol[] {
  const imports: ImportSymbol[] = [];
  
  const importFromRegex = /import\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importFromRegex.exec(content)) !== null) {
    const names = match[1] 
      ? match[1].split(',').map(n => n.trim().split(' as ')[0].trim()).filter(Boolean)
      : match[2] ? [match[2]] : match[3] ? [match[3]] : [];
    
    imports.push({
      names,
      from: match[4],
      isReExport: false,
    });
  }
  
  const reExportRegex = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map(n => n.trim().split(' as ')[0].trim()).filter(Boolean);
    imports.push({
      names,
      from: match[2],
      isReExport: true,
    });
  }
  
  return imports;
}

export function buildSymbolIndex(graph: DependencyGraph): Map<string, Map<string, ExportSymbol[]>> {
  const index = new Map<string, Map<string, ExportSymbol[]>>();
  
  for (const [filePath, moduleInfo] of graph.modules) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const exports = extractExports(content);
      
      const fileExports = new Map<string, ExportSymbol[]>();
      for (const exp of exports) {
        if (!fileExports.has(exp.name)) {
          fileExports.set(exp.name, []);
        }
        fileExports.get(exp.name)!.push(exp);
      }
      
      index.set(filePath, fileExports);
    } catch {
      // skip
    }
  }
  
  return index;
}

export function resolveSymbolImport(
  importInfo: ImportSymbol,
  fromFile: string,
  graph: DependencyGraph,
  symbolIndex: Map<string, Map<string, ExportSymbol[]>>
): { file: string; symbols: ExportSymbol[] }[] {
  const results: { file: string; symbols: ExportSymbol[] }[] = [];
  
  const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));
  const resolvePath = (p: string): string | null => {
    if (p.startsWith('.')) {
      const exts = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
      for (const ext of exts) {
        const fullPath = dir + '/' + p.replace(/\.[jt]sx?$/, '') + ext;
        if (graph.modules.has(fullPath)) return fullPath;
      }
    }
    return null;
  };
  
  const resolvedFile = resolvePath(importInfo.from);
  if (!resolvedFile) return results;
  
  const fileExports = symbolIndex.get(resolvedFile);
  if (!fileExports) return results;
  
  for (const name of importInfo.names) {
    const symbols = fileExports.get(name);
    if (symbols) {
      results.push({ file: resolvedFile, symbols });
    }
  }
  
  return results;
}
