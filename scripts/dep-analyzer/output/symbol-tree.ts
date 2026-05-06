import { readFileSync } from 'fs';
import type { DependencyGraph, ModuleInfo } from '../types.js';

export interface ExportSymbol {
  name: string;
  type: 'function' | 'const' | 'class' | 'interface' | 'type' | 'default' | 'unknown';
}

interface TreeNode {
  name: string;
  children?: TreeNode[];
  isDir?: boolean;
  isFile?: boolean;
  symbols?: ExportSymbol[];
  count?: number;
}

function findModuleByPath(graph: DependencyGraph, targetFile: string): ModuleInfo | undefined {
  const normalizedTarget = targetFile.replace(/\\/g, '/');
  
  for (const [path, info] of graph.modules) {
    const normalizedPath = path.replace(/\\/g, '/');
    if (normalizedPath.endsWith(normalizedTarget) || info.shortPath === normalizedTarget) {
      return info;
    }
  }
  
  return undefined;
}

function extractExports(content: string): ExportSymbol[] {
  const exports: ExportSymbol[] = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('export function ') || trimmed.startsWith('export async function ')) {
      const match = trimmed.match(/export\s+(?:async\s+)?function\s+(\w+)/);
      if (match) {
        exports.push({ name: match[1], type: 'function' });
      }
    } else if (trimmed.startsWith('export const ') || trimmed.startsWith('export let ') || trimmed.startsWith('export var ')) {
      const match = trimmed.match(/export\s+(?:const|let|var)\s+(\w+)/);
      if (match) {
        exports.push({ name: match[1], type: 'const' });
      }
    } else if (trimmed.startsWith('export class ')) {
      const match = trimmed.match(/export\s+class\s+(\w+)/);
      if (match) {
        exports.push({ name: match[1], type: 'class' });
      }
    } else if (trimmed.startsWith('export interface ')) {
      const match = trimmed.match(/export\s+interface\s+(\w+)/);
      if (match) {
        exports.push({ name: match[1], type: 'interface' });
      }
    } else if (trimmed.startsWith('export type ')) {
      const match = trimmed.match(/export\s+type\s+(\w+)/);
      if (match) {
        exports.push({ name: match[1], type: 'type' });
      }
    } else if (trimmed.startsWith('export default ')) {
      const match = trimmed.match(/export\s+default\s+(\w+)?/);
      exports.push({ 
        name: match?.[1] || 'default', 
        type: 'default' 
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
      exports.push({ name, type: 'unknown' });
    }
  }
  
  return exports;
}

function getSymbolIcon(type: string): string {
  switch (type) {
    case 'function': return 'ƒ';
    case 'const': return '≡';
    case 'class': return '◆';
    case 'interface': return '◇';
    case 'type': return '□';
    case 'default': return '★';
    default: return '○';
  }
}

function buildSymbolTree(
  deps: { file: string; path: string }[],
  graph: DependencyGraph
): TreeNode {
  const root: TreeNode = { name: 'root', isDir: true, children: [] };
  
  for (const dep of deps) {
    const parts = dep.file.split('/');
    let current = root;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const isFile = isLast && (part.endsWith('.ts') || part.endsWith('.tsx'));
      
      let child = current.children?.find(c => c.name === part);
      if (!child) {
        child = { 
          name: part, 
          isDir: !isFile,
          isFile,
          children: isFile ? undefined : []
        };
        if (!current.children) current.children = [];
        current.children.push(child);
      }
      
      current = child;
      
      if (isFile && current.isFile) {
        try {
          const fullPath = Array.from(graph.modules.entries()).find(
            ([, info]) => info.shortPath === dep.file
          )?.[0];
          
          if (fullPath) {
            const content = readFileSync(fullPath, 'utf-8');
            current.symbols = extractExports(content);
          }
        } catch {}
      }
    }
  }
  
  function countNodes(node: TreeNode): number {
    if (node.isFile) return 1;
    if (!node.children) return 0;
    const count = node.children.reduce((sum, c) => sum + countNodes(c), 0);
    node.count = count;
    return count;
  }
  
  function sortChildren(node: TreeNode): void {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.isFile && !b.isFile) return 1;
      if (!a.isFile && b.isFile) return -1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortChildren);
  }
  
  countNodes(root);
  sortChildren(root);
  
  return root;
}

function treeToLines(
  node: TreeNode, 
  prefix: string = '', 
  isLast: boolean = true,
  showSymbols: boolean = true
): string[] {
  const lines: string[] = [];
  
  if (node.name !== 'root') {
    const connector = isLast ? '└── ' : '├── ';
    let suffix = '';
    
    if (node.isDir) {
      suffix = ` (${node.count})`;
    } else if (node.isFile && node.symbols && node.symbols.length > 0) {
      suffix = ` [${node.symbols.length} symbols]`;
    }
    
    lines.push(prefix + connector + node.name + suffix);
  }
  
  if (node.children) {
    const newPrefix = prefix + (isLast ? '    ' : '│   ');
    node.children.forEach((child, index) => {
      const childLines = treeToLines(
        child, 
        newPrefix, 
        index === node.children!.length - 1,
        showSymbols
      );
      lines.push(...childLines);
    });
  }
  
  if (node.isFile && node.symbols && showSymbols && node.symbols.length > 0) {
    const symbolPrefix = prefix + (isLast ? '    ' : '│   ');
    const sortedSymbols = [...node.symbols].sort((a, b) => {
      const typeOrder = ['function', 'const', 'class', 'interface', 'type', 'default', 'unknown'];
      const aIdx = typeOrder.indexOf(a.type);
      const bIdx = typeOrder.indexOf(b.type);
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.name.localeCompare(b.name);
    });
    
    const grouped = new Map<string, ExportSymbol[]>();
    for (const sym of sortedSymbols) {
      if (!grouped.has(sym.type)) grouped.set(sym.type, []);
      grouped.get(sym.type)!.push(sym);
    }
    
    for (const [type, symbols] of grouped) {
      const icon = getSymbolIcon(type);
      const isFirst = lines[lines.length - 1]?.includes(node.name);
      const symPrefix = symbolPrefix + '    ';
      
      lines.push(symPrefix + `├── ${icon} ${type}s (${symbols.length})`);
      for (let i = 0; i < symbols.length; i++) {
        const sym = symbols[i];
        const conn = i === symbols.length - 1 ? '└── ' : '├── ';
        lines.push(symPrefix + `│   ${conn}${sym.name}`);
      }
    }
  }
  
  return lines;
}

// 获取文件导入的符号类型对应的中文名称
const symbolTypeNames: Record<string, string> = {
  function: '函数',
  class: '类',
  interface: '接口',
  type: '类型',
  const: '常量',
  variable: '变量',
  enum: '枚举',
  export: '导出',
  default: '默认导出',
  reexport: '重导出',
  unknown: '未知',
};

function getSymbolIcon(type: string): string {
  switch (type) {
    case 'function': return 'f';
    case 'const': return 'K';
    case 'class': return 'C';
    case 'interface': return 'I';
    case 'type': return 'T';
    case 'default': return 'D';
    default: return '?';
  }
}

export function generateSymbolTreeOutput(
  graph: DependencyGraph,
  targetFile: string,
  options: { plain?: boolean } = {}
): string {
  const { plain = false } = options;
  const targetModule = findModuleByPath(graph, targetFile);
  if (!targetModule) {
    return `File not found: ${targetFile}`;
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(`Symbol Dependency Analysis: ${targetFile}`);
  lines.push('='.repeat(60));
  lines.push('');

  // 获取直接依赖（目标文件 import 的文件）
  const fileDeps = new Map<string, Set<string>>();
  for (const importInfo of targetModule.imports) {
    const resolvedPath = resolveImportPathSimple(importInfo.path, targetModule.path, graph);
    if (resolvedPath) {
      if (!fileDeps.has(resolvedPath)) {
        fileDeps.set(resolvedPath, new Set());
      }
      for (const name of importInfo.names) {
        fileDeps.get(resolvedPath)!.add(name);
      }
    }
  }

  // 收集被依赖的文件（import 这个文件的文件）
  const fileDependents = new Map<string, Set<string>>();
  for (const depPath of targetModule.importedBy) {
    const depModule = graph.modules.get(depPath);
    if (depModule) {
      for (const importInfo of depModule.imports) {
        const resolvedPath = resolveImportPathSimple(importInfo.path, depModule.path, graph);
        const normalizedResolved = resolvedPath?.replace(/\.js(x)?$/, '.ts$1');
        if (normalizedResolved === targetModule.path || resolvedPath === targetModule.path) {
          if (!fileDependents.has(depPath)) {
            fileDependents.set(depPath, new Set());
          }
          for (const name of importInfo.names) {
            fileDependents.get(depPath)!.add(name);
          }
        }
      }
    }
  }

  // 显示外部依赖（过滤掉没有实际导入符号的条目）
  const filteredDepEntries = Array.from(fileDeps.entries())
    .filter(([, names]) => names.size > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const totalDepCount = filteredDepEntries.reduce((sum, [, names]) => sum + names.size, 0);
  lines.push(`[External Dependencies] (${totalDepCount})`);
  lines.push('-'.repeat(50));

  for (let i = 0; i < filteredDepEntries.length; i++) {
    const [filePath, importedNames] = filteredDepEntries[i];
    const depModule = graph.modules.get(filePath);
    const fileShortPath = depModule?.shortPath || filePath.split('/').pop()!;
    const isLastFile = i === filteredDepEntries.length - 1;
    const filePrefix = isLastFile ? '└── ' : '├── ';

    lines.push(`${filePrefix}${fileShortPath} (${importedNames.size})`);

    const names = Array.from(importedNames).sort();
    const childPrefix = isLastFile ? '    ' : '│   ';

    for (let j = 0; j < names.length; j++) {
      const symName = names[j];
      const symbolInfo = depModule?.symbols?.find(s => s.name === symName) ||
                        depModule?.exports.find(s => s.name === symName);
      const icon = getSymbolIcon(symbolInfo?.type || 'unknown');
      const typeName = symbolTypeNames[symbolInfo?.type || 'unknown'] || symbolInfo?.type || '未知';
      const isLastSymbol = j === names.length - 1;
      const connector = isLastSymbol ? '└──' : '├──';

      lines.push(`${childPrefix}${connector} [${icon}] ${symName} (${typeName})`);
    }
  }

  if (filteredDepEntries.length === 0) {
    lines.push('  (No external dependencies)');
  }

  lines.push('');

  // 显示被依赖（过滤掉没有实际导入符号的条目）
  const filteredDependentEntries = Array.from(fileDependents.entries())
    .filter(([, names]) => names.size > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const totalDependentCount = filteredDependentEntries.reduce((sum, [, names]) => sum + names.size, 0);
  lines.push(`[Depended On] (${totalDependentCount})`);
  lines.push('-'.repeat(50));

  for (let i = 0; i < filteredDependentEntries.length; i++) {
    const [depPath, importedNames] = filteredDependentEntries[i];
    const depModule = graph.modules.get(depPath);
    const fileShortPath = depModule?.shortPath || depPath.split('/').pop()!;
    const isLastFile = i === filteredDependentEntries.length - 1;
    const filePrefix = isLastFile ? '└── ' : '├── ';

    lines.push(`${filePrefix}${fileShortPath} (${importedNames.size})`);

    const names = Array.from(importedNames).sort();
    const childPrefix = isLastFile ? '    ' : '│   ';

    for (let j = 0; j < names.length; j++) {
      const symName = names[j];
      const symbolInfo = targetModule.symbols?.find(s => s.name === symName) ||
                        targetModule.exports.find(s => s.name === symName);
      const icon = getSymbolIcon(symbolInfo?.type || 'unknown');
      const typeName = symbolTypeNames[symbolInfo?.type || 'unknown'] || symbolInfo?.type || '未知';
      const isLastSymbol = j === names.length - 1;
      const connector = isLastSymbol ? '└──' : '├──';

      lines.push(`${childPrefix}${connector} [${icon}] ${symName} (${typeName})`);
    }
  }

  if (filteredDependentEntries.length === 0) {
    lines.push('  (No external dependencies)');
  }

  lines.push('');
  lines.push('Legend: [f]=function [K]=const [C]=class [I]=interface [T]=type [D]=default [?]=unknown');
  lines.push('');

  return lines.join('\n');
}

// 简单的导入路径解析
function resolveImportPathSimple(importPath: string, fromFile: string, graph: DependencyGraph): string | null {
  if (importPath.startsWith('.')) {
    const fileParts = fromFile.replace(/\\/g, '/').split('/');
    const dir = fileParts.slice(0, -1).join('/');
    let resolved = dir + '/' + importPath;

    const resolvedParts = resolved.split('/');
    const normalizedParts: string[] = [];
    for (const part of resolvedParts) {
      if (part === '..') {
        normalizedParts.pop();
      } else if (part !== '.') {
        normalizedParts.push(part);
      }
    }
    resolved = normalizedParts.join('/');

    const hasExt = /\.(ts|tsx|js|jsx)$/.test(resolved);
    if (!hasExt) {
      resolved += '.ts';
    }

    for (const [path] of graph.modules) {
      const normalizedPath = path.replace(/\\/g, '/');
      if (normalizedPath.endsWith(resolved)) {
        return path;
      }
      if (resolved.endsWith('.js')) {
        const tsPath = resolved.replace(/\.js$/, '.ts');
        if (normalizedPath.endsWith(tsPath)) {
          return path;
        }
      }
    }
  }
  return null;
}

export function generateSymbolTreeJson(
  graph: DependencyGraph,
  targetFile: string
): object {
  const targetModule = findModuleByPath(graph, targetFile);
  if (!targetModule) {
    return { error: `File not found: ${targetFile}` };
  }
  
  const directDeps: { file: string; path: string }[] = [];
  for (const edge of graph.edges) {
    if (edge.from === targetModule.path) {
      const toModule = graph.modules.get(edge.to);
      if (toModule) {
        directDeps.push({ file: toModule.shortPath, path: toModule.path });
      }
    }
  }
  
  const depTree = buildSymbolTree(directDeps, graph);
  
  const dependents: { file: string; path: string }[] = [];
  for (const dep of targetModule.importedBy) {
    const depModule = graph.modules.get(dep);
    if (depModule) {
      dependents.push({ file: depModule.shortPath, path: depModule.path });
    }
  }
  
  const depTreeImportedBy = buildSymbolTree(dependents, graph);
  
  return {
    file: targetFile,
    directDependencies: depTree,
    importedBy: depTreeImportedBy,
    stats: {
      totalDirectDependencies: directDeps.length,
      totalDependents: dependents.length,
    },
  };
}
