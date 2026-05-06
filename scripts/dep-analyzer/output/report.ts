import type { AnalysisResult, Cycle, Layer, CrossLayerDependency } from '../types.js';

export function generateTextReport(result: AnalysisResult): string {
  const lines: string[] = [];
  
  lines.push('');
  lines.push('\x1b[1m\x1b[36m📊 Claude Code 依赖分析报告\x1b[0m');
  lines.push('='.repeat(50));
  lines.push('');
  
  lines.push('\x1b[1m📦 模块统计\x1b[0m');
  lines.push(`  总模块数: \x1b[33m${result.stats.totalModules}\x1b[0m`);
  lines.push(`  依赖边数: \x1b[33m${result.stats.totalEdges}\x1b[0m`);
  lines.push('');
  
  lines.push('\x1b[1m🔄 循环依赖\x1b[0m');
  if (result.cycles.length === 0) {
    lines.push('  \x1b[32m✅ 未检测到循环依赖\x1b[0m');
  } else {
    lines.push(`  \x1b[31m⚠️  检测到 ${result.cycles.length} 个循环依赖\x1b[0m`);
    for (const cycle of result.cycles.slice(0, 5)) {
      const nodes = cycle.nodes.map(n => n.split('/').pop()!).join(' → ');
      lines.push(`    • ${nodes}`);
    }
    if (result.cycles.length > 5) {
      lines.push(`    ... 还有 ${result.cycles.length - 5} 个`);
    }
  }
  lines.push('');
  
  lines.push('\x1b[1m📊 架构分层\x1b[0m');
  lines.push('  ┌' + '─'.repeat(48) + '┐');
  
  const layerOrder = [
    'types', 'constants', 'utils', 'state', 'services', 'query', 'tools',
    'bridge', 'buddy', 'components', 'commands', 'screens', 'context', 'entrypoints', 'packages'
  ];
  
  const sortedLayers = [...result.layers].sort((a, b) => {
    const aIdx = layerOrder.indexOf(a.name);
    const bIdx = layerOrder.indexOf(b.name);
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });
  
  for (const layer of sortedLayers) {
    const name = layer.name.padEnd(12);
    const count = `(${layer.modules.length})`.padStart(8);
    const deps = layer.dependsOn.length > 0 ? ` → ${layer.dependsOn.join(', ')}` : '';
    const line = `  │ \x1b[36m${name}\x1b[0m ${count.padEnd(8)} ${deps}\x1b[0m`;
    lines.push(line.length > 60 ? line.slice(0, 57) + '...\x1b[0m' : line);
  }
  
  lines.push('  └' + '─'.repeat(48) + '┘');
  lines.push('');
  
  if (result.crossLayerDeps.length > 0) {
    lines.push('\x1b[1m⚠️  跨层依赖警告\x1b[0m');
    lines.push(`  共 ${result.crossLayerDeps.length} 个跨层依赖`);
    
    const grouped = new Map<string, CrossLayerDependency[]>();
    for (const dep of result.crossLayerDeps) {
      const key = `${dep.fromLayer} → ${dep.toLayer}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(dep);
    }
    
    let count = 0;
    for (const [key, deps] of grouped) {
      if (count >= 10) {
        lines.push(`  ... 还有 ${result.crossLayerDeps.length - count} 个`);
        break;
      }
      lines.push(`  \x1b[33m${key}\x1b[0m (${deps.length} 个)`);
      count++;
    }
    lines.push('');
  }
  
  lines.push('\x1b[1m📈 模块耦合度\x1b[0m');
  if (result.mostIndependent.length > 0) {
    const m = result.mostIndependent[0];
    lines.push(`  最独立模块: \x1b[32m${m.path.split('/').pop()}\x1b[0m (0 个依赖)`);
  }
  if (result.mostDependent.length > 0) {
    const m = result.mostDependent[0];
    lines.push(`  最多依赖: \x1b[31m${m.path.split('/').pop()}\x1b[0m (${m.deps} 个依赖)`);
  }
  lines.push('');
  
  lines.push(`生成时间: ${result.generated}`);
  lines.push('');
  
  return lines.join('\n');
}

export function generateSimpleReport(result: AnalysisResult): string {
  const lines: string[] = [];
  
  lines.push(`Modules: ${result.stats.totalModules}`);
  lines.push(`Edges: ${result.stats.totalEdges}`);
  lines.push(`Cycles: ${result.cycles.length}`);
  lines.push(`Cross-layer deps: ${result.stats.crossLayerDeps}`);
  lines.push('');
  lines.push('Layers:');
  
  for (const layer of result.layers) {
    lines.push(`  ${layer.name}: ${layer.modules.length} modules, depends on: ${layer.dependsOn.join(', ') || 'none'}`);
  }
  
  return lines.join('\n');
}
