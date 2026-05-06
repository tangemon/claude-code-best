import { resolve, isAbsolute, relative } from 'path';
import type { DependencyGraph, ModuleInfo } from '../types.js';

function findModulesByDirectory(graph: DependencyGraph, targetDir: string): ModuleInfo[] {
  const normalizedDir = targetDir.replace(/\\/g, '/').replace(/\/$/, '');
  const results: ModuleInfo[] = [];

  for (const [path, info] of graph.modules) {
    const normalizedPath = path.replace(/\\/g, '/');
    const shortPath = info.shortPath.replace(/\\/g, '/');

    if (shortPath.startsWith(normalizedDir + '/') || shortPath === normalizedDir) {
      results.push(info);
    }
  }

  return results;
}

export function generateDirectoryDependencyGraph(
  graph: DependencyGraph,
  targetDir: string,
  options: {
    depth?: number;
    direction?: 'downstream' | 'upstream' | 'both';
    showImports?: boolean;
    showExports?: boolean;
  } = {}
): string {
  const { depth = 2, direction = 'both', showImports = true } = options;

  const targetModules = findModulesByDirectory(graph, targetDir);
  if (targetModules.length === 0) {
    return `// Directory not found: ${targetDir}`;
  }

  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('flowchart TD');
  lines.push('    subgraph ' + makeNodeId(targetDir) + '_dir [' + targetDir + ']');

  const visited = new Set<string>();
  const nodes: { path: string; info: ModuleInfo; level: number; inTargetDir: boolean }[] = [];
  const edges: { from: string; to: string; type: string }[] = [];

  function collectDeps(modulePath: string, currentDepth: number, dir: 'deps' | 'dependents', inTargetDir: boolean) {
    if (currentDepth > depth || visited.has(modulePath + dir)) return;
    visited.add(modulePath + dir);

    const module = graph.modules.get(modulePath);
    if (!module) return;

    const isInTargetDir = findModulesByDirectory(graph, targetDir).some(m => m.path === modulePath);

    if (!nodes.some(n => n.path === modulePath)) {
      nodes.push({ path: modulePath, info: module, level: currentDepth, inTargetDir });
    }

    if (dir === 'deps' && showImports) {
      for (const edge of graph.edges) {
        if (edge.from === modulePath && !visited.has(edge.to + 'deps')) {
          edges.push({ from: modulePath, to: edge.to, type: 'import' });
          collectDeps(edge.to, currentDepth + 1, 'deps', isInTargetDir);
        }
      }
    } else if (dir === 'dependents') {
      for (const [path] of graph.modules) {
        const hasEdge = graph.edges.some(e => e.from === path && e.to === modulePath);
        if (hasEdge && !visited.has(path + 'dependents')) {
          edges.push({ from: path, to: modulePath, type: 'imported-by' });
          const isPathInTargetDir = findModulesByDirectory(graph, targetDir).some(m => m.path === path);
          if (!nodes.some(n => n.path === path)) {
            nodes.push({ path, info: graph.modules.get(path)!, level: currentDepth, inTargetDir: isPathInTargetDir });
          }
          visited.add(path + 'dependents');
          collectDeps(path, currentDepth + 1, 'dependents', isInTargetDir);
        }
      }
    }
  }

  for (const targetModule of targetModules) {
    collectDeps(targetModule.path, 0, 'deps', true);
  }

  if (direction === 'upstream' || direction === 'both') {
    for (const targetModule of targetModules) {
      visited.delete(targetModule.path + 'dependents');
      collectDeps(targetModule.path, 0, 'dependents', true);
    }
  }

  const uniqueNodes = new Map<string, { info: ModuleInfo; level: number; inTargetDir: boolean }>();
  for (const node of nodes) {
    if (!uniqueNodes.has(node.path)) {
      uniqueNodes.set(node.path, { info: node.info, level: node.level, inTargetDir: node.inTargetDir });
    }
  }

  for (const [path, { info, level, inTargetDir }] of uniqueNodes) {
    const nodeId = makeNodeId(info.shortPath);
    const label = info.shortPath.split('/').pop()!;
    const style = inTargetDir ? ':::target' : (level === 1 ? ':::direct' : '');
    lines.push(`    ${nodeId}["${label}"]${style}`);
  }

  lines.push('    end');

  const addedEdges = new Set<string>();
  for (const edge of edges) {
    const fromModule = graph.modules.get(edge.from);
    const toModule = graph.modules.get(edge.to);
    if (!fromModule || !toModule) continue;

    const fromId = makeNodeId(fromModule.shortPath);
    const toId = makeNodeId(toModule.shortPath);
    const edgeKey = `${fromId}-->${toId}`;

    if (!addedEdges.has(edgeKey)) {
      addedEdges.add(edgeKey);
      const style = edge.type === 'imported-by' ? ' -.->|' : ' -->|';
      lines.push(`    ${fromId}${style}${toId}`);
    }
  }

  lines.push('');
  lines.push('    classDef target fill:#f96,stroke:#333,stroke-width:2px');
  lines.push('    classDef direct fill:#bbf,stroke:#333,stroke-width:1px');
  lines.push('```');

  return lines.join('\n');
}

export function generateDirectoryTextReport(
  graph: DependencyGraph,
  targetDir: string
): string {
  const targetModules = findModulesByDirectory(graph, targetDir);
  if (targetModules.length === 0) {
    return `Directory not found: ${targetDir}`;
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(`\x1b[1m📁 目录依赖分析: ${targetDir}\x1b[0m`);
  lines.push('='.repeat(50));
  lines.push('');

  lines.push(`\x1b[1m📄 目录内文件 (${targetModules.length})\x1b[0m`);
  for (const mod of targetModules) {
    lines.push(`  • \x1b[33m${mod.shortPath}\x1b[0m`);
  }
  lines.push('');

  const allDeps = new Set<string>();
  const allDependents = new Set<string>();

  for (const targetModule of targetModules) {
    for (const edge of graph.edges) {
      if (edge.from === targetModule.path) {
        const toModule = graph.modules.get(edge.to);
        if (toModule && !findModulesByDirectory(graph, targetDir).some(m => m.path === toModule.path)) {
          allDeps.add(toModule.shortPath);
        }
      }
    }
    for (const dep of targetModule.importedBy) {
      const depModule = graph.modules.get(dep);
      if (depModule && !findModulesByDirectory(graph, targetDir).some(m => m.path === depModule.path)) {
        allDependents.add(depModule.shortPath);
      }
    }
  }

  lines.push('\x1b[1m📥 外部依赖 (被此目录依赖)\x1b[0m');
  const sortedDeps = Array.from(allDeps).sort();
  if (sortedDeps.length === 0) {
    lines.push('  (无外部依赖)');
  } else {
    for (const dep of sortedDeps) {
      lines.push(`  • \x1b[33m${dep}\x1b[0m`);
    }
  }
  lines.push('');

  lines.push('\x1b[1m📤 被外部依赖 (依赖此目录)\x1b[0m');
  const sortedDependents = Array.from(allDependents).sort();
  if (sortedDependents.length === 0) {
    lines.push('  (无外部文件依赖此目录)');
  } else {
    for (const dep of sortedDependents) {
      lines.push(`  • \x1b[36m${dep}\x1b[0m`);
    }
  }
  lines.push('');

  lines.push('\x1b[1m📊 统计\x1b[0m');
  lines.push(`  目录内文件数: ${targetModules.length}`);
  lines.push(`  外部依赖数: ${sortedDeps.length}`);
  lines.push(`  被外部依赖数: ${sortedDependents.length}`);
  lines.push('');

  return lines.join('\n');
}

export function generateDirectoryJson(
  graph: DependencyGraph,
  targetDir: string
): object {
  const targetModules = findModulesByDirectory(graph, targetDir);
  if (targetModules.length === 0) {
    return { error: `Directory not found: ${targetDir}` };
  }

  const allDeps = new Set<string>();
  const allDependents = new Set<string>();

  for (const targetModule of targetModules) {
    for (const edge of graph.edges) {
      if (edge.from === targetModule.path) {
        const toModule = graph.modules.get(edge.to);
        if (toModule && !findModulesByDirectory(graph, targetDir).some(m => m.path === toModule.path)) {
          allDeps.add(toModule.shortPath);
        }
      }
    }
    for (const dep of targetModule.importedBy) {
      const depModule = graph.modules.get(dep);
      if (depModule && !findModulesByDirectory(graph, targetDir).some(m => m.path === depModule.path)) {
        allDependents.add(depModule.shortPath);
      }
    }
  }

  const depTree = buildTree(Array.from(allDeps).sort());
  const depTreeImportedBy = buildTree(Array.from(allDependents).sort());

  return {
    directory: targetDir,
    files: targetModules.map(m => m.shortPath),
    stats: {
      totalFiles: targetModules.length,
      totalExternalDependencies: allDeps.size,
      totalExternalDependents: allDependents.size,
    },
    externalDependencies: {
      flat: Array.from(allDeps).sort(),
      tree: treeToString(depTree),
    },
    externalDependents: {
      flat: Array.from(allDependents).sort(),
      tree: treeToString(depTreeImportedBy),
    },
  };
}

export function generateDirectoryTreeOutput(
  graph: DependencyGraph,
  targetDir: string
): string {
  const targetModules = findModulesByDirectory(graph, targetDir);
  if (targetModules.length === 0) {
    return `Directory not found: ${targetDir}`;
  }

  const allDeps = new Set<string>();
  const allDependents = new Set<string>();

  for (const targetModule of targetModules) {
    for (const edge of graph.edges) {
      if (edge.from === targetModule.path) {
        const toModule = graph.modules.get(edge.to);
        if (toModule && !findModulesByDirectory(graph, targetDir).some(m => m.path === toModule.path)) {
          allDeps.add(toModule.shortPath);
        }
      }
    }
    for (const dep of targetModule.importedBy) {
      const depModule = graph.modules.get(dep);
      if (depModule && !findModulesByDirectory(graph, targetDir).some(m => m.path === depModule.path)) {
        allDependents.add(depModule.shortPath);
      }
    }
  }

  const depTree = buildTree(Array.from(allDeps).sort());
  const depTreeImportedBy = buildTree(Array.from(allDependents).sort());

  const lines: string[] = [];
  lines.push('');
  lines.push(`目录依赖分析: ${targetDir}`);
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`📄 目录内文件 (${targetModules.length})`);
  lines.push('-'.repeat(40));
  for (const mod of targetModules) {
    lines.push(`  • ${mod.shortPath}`);
  }
  lines.push('');
  lines.push(`📥 外部依赖 (${allDeps.size})`);
  lines.push('-'.repeat(40));
  lines.push(treeToString(depTree));
  lines.push('');
  lines.push(`📤 被外部依赖 (${allDependents.size})`);
  lines.push('-'.repeat(40));
  lines.push(treeToString(depTreeImportedBy));
  lines.push('');

  return lines.join('\n');
}

interface SymbolDepNode {
  file: string;
  symbols: { name: string; type: string; importedBy: string[] }[];
}

function buildSymbolDepTree(graph: DependencyGraph, targetDir: string, direction: 'deps' | 'dependents'): Map<string, SymbolDepNode> {
  const targetModules = findModulesByDirectory(graph, targetDir);
  const result = new Map<string, SymbolDepNode>();

  for (const targetModule of targetModules) {
    const fileDeps = new Map<string, Set<string>>();

    if (direction === 'deps') {
      for (const importInfo of targetModule.imports) {
        const resolvedPath = resolveImportPathSimple(importInfo.path, targetModule.path, graph);
        if (resolvedPath && !findModulesByDirectory(graph, targetDir).some(m => m.path === resolvedPath)) {
          if (!fileDeps.has(resolvedPath)) {
            fileDeps.set(resolvedPath, new Set());
          }
          for (const name of importInfo.names) {
            fileDeps.get(resolvedPath)!.add(name);
          }
        }
      }
    } else {
      for (const depPath of targetModule.importedBy) {
        const depModule = graph.modules.get(depPath);
        if (depModule && !findModulesByDirectory(graph, targetDir).some(m => m.path === depPath)) {
          for (const importInfo of depModule.imports) {
            const resolvedPath = resolveImportPathSimple(importInfo.path, depModule.path, graph);
            const normalizedResolved = resolvedPath?.replace(/\.js(x)?$/, '.ts$1');
            if (normalizedResolved === targetModule.path || resolvedPath === targetModule.path) {
              if (!fileDeps.has(depPath)) {
                fileDeps.set(depPath, new Set());
              }
              for (const name of importInfo.names) {
                fileDeps.get(depPath)!.add(name);
              }
            }
          }
        }
      }
    }

    const symbols: { name: string; type: string; importedBy: string[] }[] = [];
    
    if (direction === 'deps') {
      for (const [file, importedSymbols] of fileDeps) {
        const fileModule = graph.modules.get(file);
        if (fileModule) {
          for (const symName of importedSymbols) {
            const symbolInfo = fileModule.symbols?.find(s => s.name === symName) || 
                              fileModule.exports.find(s => s.name === symName);
            symbols.push({
              name: symName,
              type: symbolInfo?.type || 'unknown',
              importedBy: [fileModule.shortPath],
            });
          }
        }
      }
    } else {
      for (const [depFile, importedSymbols] of fileDeps) {
        const depModule = graph.modules.get(depFile);
        const depFilePath = depModule?.shortPath || depFile.split('/').pop()!;
        for (const symName of importedSymbols) {
          const symbolInfo = targetModule.symbols?.find(s => s.name === symName) || 
                            targetModule.exports.find(s => s.name === symName);
          symbols.push({
            name: symName,
            type: symbolInfo?.type || 'unknown',
            importedBy: [depFilePath],
          });
        }
      }
    }

    result.set(targetModule.shortPath, {
      file: targetModule.shortPath,
      symbols,
    });
  }

  return result;
}

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
        const tsxPath = resolved.replace(/\.js$/, '.tsx');
        if (normalizedPath.endsWith(tsPath) || normalizedPath.endsWith(tsxPath)) {
          return path;
        }
      } else if (resolved.endsWith('.jsx')) {
        const tsxPath = resolved.replace(/\.jsx$/, '.tsx');
        if (normalizedPath.endsWith(tsxPath)) {
          return path;
        }
      } else if (!hasExt) {
        if (normalizedPath.endsWith(resolved + '.ts') || normalizedPath.endsWith(resolved + '.tsx')) {
          return path;
        }
      }
    }
    
    if (resolved.endsWith('.js')) {
      const tsPath = resolved.replace(/\.js$/, '.ts');
      for (const [path] of graph.modules) {
        const normalizedPath = path.replace(/\\/g, '/');
        if (normalizedPath.endsWith(tsPath)) {
          return path;
        }
      }
    } else if (resolved.endsWith('.jsx')) {
      const tsxPath = resolved.replace(/\.jsx$/, '.tsx');
      for (const [path] of graph.modules) {
        const normalizedPath = path.replace(/\\/g, '/');
        if (normalizedPath.endsWith(tsxPath)) {
          return path;
        }
      }
    }
  }
  return null;
}

const symbolTypeIcons: Record<string, string> = {
  function: 'ƒ',
  class: 'C',
  interface: 'I',
  type: 'T',
  const: 'K',
  variable: 'V',
  enum: 'E',
  export: 'X',
  default: 'D',
  reexport: 'R',
  unknown: '?',
};

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

export function generateDirectorySymbolTree(
  graph: DependencyGraph,
  targetDir: string,
  options: { plain?: boolean } = {}
): string {
  const { plain = false } = options;
  const targetModules = findModulesByDirectory(graph, targetDir);
  if (targetModules.length === 0) {
    return `Directory not found: ${targetDir}`;
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(plain ? `Symbol Dependency Analysis: ${targetDir}` : `Symbol Dependency Analysis: ${targetDir}`);
  lines.push('='.repeat(60));
  lines.push('');

  const depTree = buildSymbolDepTree(graph, targetDir, 'deps');
  const dependentTree = buildSymbolDepTree(graph, targetDir, 'dependents');

  // 计算每个目标模块的外部依赖数
  const moduleDepCounts = new Map<string, { depCount: number; dependentCount: number }>();
  for (const targetModule of targetModules) {
    const moduleDeps = depTree.get(targetModule.shortPath);
    const moduleDependents = dependentTree.get(targetModule.shortPath);
    moduleDepCounts.set(targetModule.shortPath, {
      depCount: moduleDeps?.symbols.length || 0,
      dependentCount: moduleDependents?.symbols.length || 0,
    });
  }

  // 计算目录总依赖数
  const totalDepCount = Array.from(moduleDepCounts.values()).reduce((sum, c) => sum + c.depCount, 0);
  const totalDependentCount = Array.from(moduleDepCounts.values()).reduce((sum, c) => sum + c.dependentCount, 0);

  lines.push(plain ? `[External Dependencies] (files and symbols this directory depends on)` : `[External Dependencies] (files and symbols this directory depends on)`);
  lines.push('-'.repeat(50));

  // 显示目录头部（带总依赖数）
  lines.push(plain ? `${targetDir} (${totalDepCount})` : `${targetDir} (${totalDepCount})`);

  let hasDeps = false;
  for (const targetModule of targetModules) {
    const moduleDeps = depTree.get(targetModule.shortPath);
    const counts = moduleDepCounts.get(targetModule.shortPath)!;
    if (!moduleDeps || moduleDeps.symbols.length === 0) continue;
    hasDeps = true;

    const byFile = new Map<string, { name: string; type: string }[]>();
    for (const sym of moduleDeps.symbols) {
      for (const file of sym.importedBy) {
        if (!byFile.has(file)) {
          byFile.set(file, []);
        }
        byFile.get(file)!.push({ name: sym.name, type: sym.type });
      }
    }

    // 显示文件（带依赖数）
    lines.push(`${targetModule.shortPath} (${counts.depCount})`);

    const files = Array.from(byFile.entries());
    for (let fi = 0; fi < files.length; fi++) {
      const [file, symbols] = files[fi];
      const isLastFile = fi === files.length - 1;
      const filePrefix = isLastFile ? '└── ' : '├── ';
      const childPrefix = isLastFile ? '    ' : '│   ';

      // 显示被依赖的文件（带符号数）
      lines.push(`${filePrefix}${file} (${symbols.length})`);

      for (let si = 0; si < symbols.length; si++) {
        const sym = symbols[si];
        const icon = symbolTypeIcons[sym.type] || '?';
        const typeName = symbolTypeNames[sym.type] || sym.type;
        const isLastSymbol = si === symbols.length - 1;
        const connector = isLastSymbol ? '└──' : '├──';
        lines.push(`${childPrefix}${connector} [${icon}] ${sym.name} (${typeName})`);
      }
    }
    lines.push('');
  }

  if (!hasDeps) {
    lines.push('  (No external dependencies)');
    lines.push('');
  }

  lines.push(`[Depended On] (files and symbols that depend on this directory)`);
  lines.push('-'.repeat(50));

  // 显示目录头部（带总被依赖数）
  lines.push(`${targetDir} (${totalDependentCount})`);

  let hasDependents = false;
  for (const targetModule of targetModules) {
    const moduleDependents = dependentTree.get(targetModule.shortPath);
    const counts = moduleDepCounts.get(targetModule.shortPath)!;
    if (!moduleDependents || moduleDependents.symbols.length === 0) continue;
    hasDependents = true;

    const byFile = new Map<string, { name: string; type: string }[]>();
    for (const sym of moduleDependents.symbols) {
      for (const file of sym.importedBy) {
        if (!byFile.has(file)) {
          byFile.set(file, []);
        }
        byFile.get(file)!.push({ name: sym.name, type: sym.type });
      }
    }

    // 显示文件（带被依赖数）
    lines.push(`${targetModule.shortPath} (${counts.dependentCount})`);

    const files = Array.from(byFile.entries());
    for (let fi = 0; fi < files.length; fi++) {
      const [file, symbols] = files[fi];
      const isLastFile = fi === files.length - 1;
      const filePrefix = isLastFile ? '└── ' : '├── ';
      const childPrefix = isLastFile ? '    ' : '│   ';

      // 显示依赖此文件的文件（带符号数）
      lines.push(`${filePrefix}${file} (${symbols.length})`);

      for (let si = 0; si < symbols.length; si++) {
        const sym = symbols[si];
        const icon = symbolTypeIcons[sym.type] || '?';
        const typeName = symbolTypeNames[sym.type] || sym.type;
        const isLastSymbol = si === symbols.length - 1;
        const connector = isLastSymbol ? '└──' : '├──';
        lines.push(`${childPrefix}${connector} [${icon}] ${sym.name} (${typeName})`);
      }
    }
    lines.push('');
  }

  if (!hasDependents) {
    lines.push('  (No external dependencies)');
    lines.push('');
  }

  lines.push('Legend: [f]=function [C]=class [I]=interface [T]=type [K]=const [E]=enum [X]=export [?]=unknown');
  lines.push('');

  return lines.join('\n');
}

export function generateFileDependencyGraph(
  graph: DependencyGraph,
  targetFile: string,
  options: {
    depth?: number;
    direction?: 'downstream' | 'upstream' | 'both';
    showImports?: boolean;
    showExports?: boolean;
  } = {}
): string {
  const { depth = 2, direction = 'both', showImports = true } = options;
  
  const targetModule = findModuleByPath(graph, targetFile);
  if (!targetModule) {
    return `// File not found: ${targetFile}`;
  }
  
  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('flowchart TD');
  
  const visited = new Set<string>();
  const nodes: { path: string; info: ModuleInfo; level: number }[] = [];
  const edges: { from: string; to: string; type: string }[] = [];
  
  function collectDeps(modulePath: string, currentDepth: number, dir: 'deps' | 'dependents') {
    if (currentDepth > depth || visited.has(modulePath + dir)) return;
    visited.add(modulePath + dir);
    
    const module = graph.modules.get(modulePath);
    if (!module) return;
    
    nodes.push({ path: modulePath, info: module, level: currentDepth });
    
    if (dir === 'deps' && showImports) {
      for (const edge of graph.edges) {
        if (edge.from === modulePath && !visited.has(edge.to + 'deps')) {
          edges.push({ from: modulePath, to: edge.to, type: 'import' });
          collectDeps(edge.to, currentDepth + 1, 'deps');
        }
      }
    } else if (dir === 'dependents') {
      for (const [path] of graph.modules) {
        const hasEdge = graph.edges.some(e => e.from === path && e.to === modulePath);
        if (hasEdge && !visited.has(path + 'dependents')) {
          edges.push({ from: path, to: modulePath, type: 'imported-by' });
          nodes.push({ path, info: graph.modules.get(path)!, level: currentDepth });
          visited.add(path + 'dependents');
          collectDeps(path, currentDepth + 1, 'dependents');
        }
      }
    }
  }
  
  collectDeps(targetModule.path, 0, 'deps');
  if (direction === 'upstream' || direction === 'both') {
    visited.delete(targetModule.path + 'dependents');
    collectDeps(targetModule.path, 0, 'dependents');
  }
  
  const uniqueNodes = new Map<string, { info: ModuleInfo; level: number }>();
  for (const node of nodes) {
    if (!uniqueNodes.has(node.path)) {
      uniqueNodes.set(node.path, { info: node.info, level: node.level });
    }
  }
  
  const targetId = makeNodeId(targetModule.shortPath);
  lines.push(`    ${targetId}["${targetModule.shortPath.split('/').pop()}"]:::target`);
  
  for (const [path, { info, level }] of uniqueNodes) {
    if (path === targetModule.path) continue;
    const nodeId = makeNodeId(info.shortPath);
    const label = info.shortPath.split('/').pop()!;
    const style = level === 1 ? ':::direct' : '';
    lines.push(`    ${nodeId}["${label}"]${style}`);
  }
  
  lines.push('');
  
  const addedEdges = new Set<string>();
  for (const edge of edges) {
    const fromModule = graph.modules.get(edge.from);
    const toModule = graph.modules.get(edge.to);
    if (!fromModule || !toModule) continue;
    
    const fromId = makeNodeId(fromModule.shortPath);
    const toId = makeNodeId(toModule.shortPath);
    const edgeKey = `${fromId}-->${toId}`;
    
    if (!addedEdges.has(edgeKey)) {
      addedEdges.add(edgeKey);
      const style = edge.type === 'imported-by' ? ' -.->|' : ' -->|';
      lines.push(`    ${fromId}${style}${toId}`);
    }
  }
  
  lines.push('');
  lines.push('    classDef target fill:#f96,stroke:#333,stroke-width:2px');
  lines.push('    classDef direct fill:#bbf,stroke:#333,stroke-width:1px');
  lines.push('```');
  
  return lines.join('\n');
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

function makeNodeId(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

export function generateFileTextReport(
  graph: DependencyGraph,
  targetFile: string
): string {
  const targetModule = findModuleByPath(graph, targetFile);
  if (!targetModule) {
    return `File not found: ${targetFile}`;
  }
  
  const lines: string[] = [];
  lines.push('');
  lines.push(`\x1b[1m📄 文件依赖分析: ${targetFile}\x1b[0m`);
  lines.push('='.repeat(50));
  lines.push('');
  
  lines.push('\x1b[1m📥 直接依赖\x1b[0m');
  const directDeps: string[] = [];
  for (const edge of graph.edges) {
    if (edge.from === targetModule.path) {
      const toModule = graph.modules.get(edge.to);
      if (toModule) {
        directDeps.push(toModule.shortPath);
      }
    }
  }
  
  if (directDeps.length === 0) {
    lines.push('  (无直接依赖)');
  } else {
    for (const dep of directDeps) {
      lines.push(`  • \x1b[33m${dep}\x1b[0m`);
    }
  }
  lines.push('');
  
  lines.push('\x1b[1m📤 被依赖\x1b[0m');
  const dependents = Array.from(targetModule.importedBy);
  if (dependents.length === 0) {
    lines.push('  (无其他文件依赖此文件)');
  } else {
    for (const dep of dependents) {
      const depModule = graph.modules.get(dep);
      if (depModule) {
        lines.push(`  • \x1b[36m${depModule.shortPath}\x1b[0m`);
      }
    }
  }
  lines.push('');
  
  lines.push(`\x1b[1m📊 统计\x1b[0m`);
  lines.push(`  直接依赖: ${directDeps.length}`);
  lines.push(`  被依赖数: ${dependents.length}`);
  lines.push(`  所在层级: ${targetModule.layer || 'other'}`);
  lines.push('');
  
  return lines.join('\n');
}

interface TreeNode {
  name: string;
  children?: TreeNode[];
  isFile?: boolean;
  count?: number;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: 'root', children: [] };
  
  for (const path of paths) {
    const parts = path.split('/');
    let current = root;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      
      let child = current.children?.find(c => c.name === part);
      if (!child) {
        child = { name: part, isFile: isLast };
        if (!current.children) current.children = [];
        current.children.push(child);
      }
      
      current = child;
    }
  }
  
  function countLeaves(node: TreeNode): number {
    if (node.isFile) return 1;
    if (!node.children) return 0;
    const count = node.children.reduce((sum, c) => sum + countLeaves(c), 0);
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
  
  countLeaves(root);
  sortChildren(root);
  
  return root;
}

function treeToLines(node: TreeNode, prefix: string = '', isLast: boolean = true): string[] {
  const lines: string[] = [];
  
  if (node.name !== 'root') {
    const connector = isLast ? '└── ' : '├── ';
    const suffix = node.isFile ? '' : ` (${node.count})`;
    lines.push(prefix + connector + node.name + suffix);
  }
  
  if (node.children) {
    const newPrefix = prefix + (isLast ? '    ' : '│   ');
    node.children.forEach((child, index) => {
      const childLines = treeToLines(child, newPrefix, index === node.children!.length - 1);
      lines.push(...childLines);
    });
  }
  
  return lines;
}

export function treeToString(node: TreeNode): string {
  return treeToLines(node).join('\n');
}

export function generateStructuredJson(
  graph: DependencyGraph,
  targetFile: string
): object {
  const targetModule = findModuleByPath(graph, targetFile);
  if (!targetModule) {
    return { error: `File not found: ${targetFile}` };
  }
  
  const directDeps: string[] = [];
  for (const edge of graph.edges) {
    if (edge.from === targetModule.path) {
      const toModule = graph.modules.get(edge.to);
      if (toModule) {
        directDeps.push(toModule.shortPath);
      }
    }
  }
  
  const dependents: string[] = [];
  for (const dep of targetModule.importedBy) {
    const depModule = graph.modules.get(dep);
    if (depModule) {
      dependents.push(depModule.shortPath);
    }
  }
  
  const depTree = buildTree(directDeps);
  const depTreeStr = treeToString(depTree);
  
  const depTreeImportedBy = buildTree(dependents);
  const depTreeImportedByStr = treeToString(depTreeImportedBy);
  
  return {
    file: targetFile,
    layer: targetModule.layer,
    stats: {
      totalDirectDependencies: directDeps.length,
      totalDependents: dependents.length,
    },
    directDependencies: {
      flat: directDeps,
      tree: depTreeStr,
    },
    importedBy: {
      flat: dependents,
      tree: depTreeImportedByStr,
    },
  };
}

export function generateTreeOnlyOutput(
  graph: DependencyGraph,
  targetFile: string
): string {
  const targetModule = findModuleByPath(graph, targetFile);
  if (!targetModule) {
    return `File not found: ${targetFile}`;
  }
  
  const directDeps: string[] = [];
  for (const edge of graph.edges) {
    if (edge.from === targetModule.path) {
      const toModule = graph.modules.get(edge.to);
      if (toModule) {
        directDeps.push(toModule.shortPath);
      }
    }
  }
  
  const dependents: string[] = [];
  for (const dep of targetModule.importedBy) {
    const depModule = graph.modules.get(dep);
    if (depModule) {
      dependents.push(depModule.shortPath);
    }
  }
  
  const depTree = buildTree(directDeps);
  const depTreeStr = treeToString(depTree);
  
  const depTreeImportedBy = buildTree(dependents);
  const depTreeImportedByStr = treeToString(depTreeImportedBy);
  
  const lines: string[] = [];
  lines.push('');
  lines.push(`依赖分析: ${targetFile}`);
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`📥 直接依赖 (${directDeps.length})`);
  lines.push('-'.repeat(40));
  lines.push(depTreeStr);
  lines.push('');
  lines.push(`📤 被依赖 (${dependents.length})`);
  lines.push('-'.repeat(40));
  lines.push(depTreeImportedByStr);
  lines.push('');
  
  return lines.join('\n');
}

interface TreeNode {
  name: string;
  children?: TreeNode[];
  isFile?: boolean;
  count?: number;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: 'root', children: [] };
  
  for (const path of paths) {
    const parts = path.split('/');
    let current = root;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      
      let child = current.children?.find(c => c.name === part);
      if (!child) {
        child = { name: part, isFile: isLast };
        if (!current.children) current.children = [];
        current.children.push(child);
      }
      
      current = child;
    }
  }
  
  function countLeaves(node: TreeNode): number {
    if (node.isFile) return 1;
    if (!node.children) return 0;
    const count = node.children.reduce((sum, c) => sum + countLeaves(c), 0);
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
  
  countLeaves(root);
  sortChildren(root);
  
  return root;
}

function treeToLines(node: TreeNode, prefix: string = '', isLast: boolean = true): string[] {
  const lines: string[] = [];
  
  if (node.name !== 'root') {
    const connector = isLast ? '└── ' : '├── ';
    const suffix = node.isFile ? '' : ` (${node.count})`;
    lines.push(prefix + connector + node.name + suffix);
  }
  
  if (node.children) {
    const newPrefix = prefix + (isLast ? '    ' : '│   ');
    node.children.forEach((child, index) => {
      const childLines = treeToLines(child, newPrefix, index === node.children!.length - 1);
      lines.push(...childLines);
    });
  }
  
  return lines;
}

export function treeToString(node: TreeNode): string {
  return treeToLines(node).join('\n');
}

export function generateTreeOnlyOutput(
  graph: DependencyGraph,
  targetFile: string
): string {
  const targetModule = findModuleByPath(graph, targetFile);
  if (!targetModule) {
    return `File not found: ${targetFile}`;
  }
  
  const directDeps: string[] = [];
  for (const edge of graph.edges) {
    if (edge.from === targetModule.path) {
      const toModule = graph.modules.get(edge.to);
      if (toModule) {
        directDeps.push(toModule.shortPath);
      }
    }
  }
  
  const dependents: string[] = [];
  for (const dep of targetModule.importedBy) {
    const depModule = graph.modules.get(dep);
    if (depModule) {
      dependents.push(depModule.shortPath);
    }
  }
  
  const depTree = buildTree(directDeps);
  const depTreeStr = treeToString(depTree);
  
  const depTreeImportedBy = buildTree(dependents);
  const depTreeImportedByStr = treeToString(depTreeImportedBy);
  
  const lines: string[] = [];
  lines.push('');
  lines.push(`依赖分析: ${targetFile}`);
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`📥 直接依赖 (${directDeps.length})`);
  lines.push('-'.repeat(40));
  lines.push(depTreeStr);
  lines.push('');
  lines.push(`📤 被依赖 (${dependents.length})`);
  lines.push('-'.repeat(40));
  lines.push(depTreeImportedByStr);
  lines.push('');
  
  return lines.join('\n');
}
