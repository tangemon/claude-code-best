import type { DependencyGraph, Layer, LayerDefinition, CrossLayerDependency } from '../types.js';

const DEFAULT_LAYER_DEFINITIONS: LayerDefinition[] = [
  { name: 'types', patterns: ['src/types/**', 'src/types/*'], description: '类型定义' },
  { name: 'constants', patterns: ['src/constants/**', 'src/constants/*'], description: '常量定义' },
  { name: 'utils', patterns: ['src/utils/**', 'src/utils/*'], description: '工具函数' },
  { name: 'state', patterns: ['src/state/**', 'src/state/*'], description: '状态管理' },
  { name: 'services', patterns: ['src/services/**', 'src/services/*'], description: '服务层' },
  { name: 'query', patterns: ['src/query.ts', 'src/QueryEngine.ts'], description: '查询引擎' },
  { name: 'tools', patterns: ['src/tools.ts', 'src/Tool.ts'], description: '工具系统' },
  { name: 'bridge', patterns: ['src/bridge/**', 'src/bridge/*'], description: '桥接层' },
  { name: 'buddy', patterns: ['src/buddy/**', 'src/buddy/*'], description: 'Buddy 模式' },
  { name: 'components', patterns: ['src/components/**', 'src/components/*'], description: 'UI 组件' },
  { name: 'commands', patterns: ['src/commands/**', 'src/commands/*'], description: '命令层' },
  { name: 'screens', patterns: ['src/screens/**', 'src/screens/*'], description: '屏幕组件' },
  { name: 'context', patterns: ['src/context.ts'], description: '上下文构建' },
  { name: 'entrypoints', patterns: ['src/entrypoints/**', 'src/entrypoints/*', 'src/main.tsx'], description: '入口点' },
  { name: 'packages', patterns: ['packages/**'], description: 'Workspace 包' },
];

function matchPattern(path: string, patterns: string[]): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  for (const pattern of patterns) {
    const patternParts = pattern.split('/');
    const pathParts = normalizedPath.split('/');
    
    let matches = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '**') {
        continue;
      }
      if (patternParts[i] === '*') {
        if (i >= pathParts.length) {
          matches = false;
          break;
        }
        continue;
      }
      if (patternParts[i] !== pathParts[i]) {
        matches = false;
        break;
      }
    }
    
    if (matches && patternParts.length <= pathParts.length) {
      return true;
    }
  }
  return false;
}

export function assignLayers(
  graph: DependencyGraph,
  definitions: LayerDefinition[] = DEFAULT_LAYER_DEFINITIONS
): void {
  for (const [modulePath, moduleInfo] of graph.modules) {
    for (const def of definitions) {
      if (matchPattern(moduleInfo.shortPath, def.patterns)) {
        moduleInfo.layer = def.name;
        break;
      }
    }
    if (!moduleInfo.layer) {
      moduleInfo.layer = 'other';
    }
  }
}

export function computeLayers(graph: DependencyGraph): Layer[] {
  const layerModules = new Map<string, string[]>();
  const layerDeps = new Map<string, Set<string>>();
  const layerDependents = new Map<string, Set<string>>();
  
  for (const def of DEFAULT_LAYER_DEFINITIONS) {
    layerModules.set(def.name, []);
    layerDeps.set(def.name, new Set());
    layerDependents.set(def.name, new Set());
  }
  layerModules.set('other', []);
  layerDeps.set('other', new Set());
  layerDependents.set('other', new Set());
  
  for (const [modulePath, moduleInfo] of graph.modules) {
    const layer = moduleInfo.layer || 'other';
    if (!layerModules.has(layer)) {
      layerModules.set(layer, []);
    }
    layerModules.get(layer)!.push(moduleInfo.shortPath);
    
    for (const edge of graph.edges) {
      if (edge.from === modulePath) {
        const targetModule = graph.modules.get(edge.to);
        if (targetModule) {
          const targetLayer = targetModule.layer || 'other';
          if (layer !== targetLayer) {
            layerDeps.get(layer)?.add(targetLayer);
            layerDependents.get(targetLayer)?.add(layer);
          }
        }
      }
    }
  }
  
  const layers: Layer[] = [];
  for (const [name, modules] of layerModules) {
    if (modules.length === 0) continue;
    
    const def = DEFAULT_LAYER_DEFINITIONS.find(d => d.name === name);
    layers.push({
      name,
      description: def?.description,
      modules,
      dependsOn: Array.from(layerDeps.get(name) || []),
      dependedBy: Array.from(layerDependents.get(name) || []),
    });
  }
  
  return layers.sort((a, b) => {
    const order = DEFAULT_LAYER_DEFINITIONS.map(d => d.name);
    const aIdx = order.indexOf(a.name);
    const bIdx = order.indexOf(b.name);
    if (aIdx === -1 && bIdx === -1) return a.name.localeCompare(b.name);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });
}

export function detectCrossLayerDependencies(graph: DependencyGraph): CrossLayerDependency[] {
  const crossLayerDeps: CrossLayerDependency[] = [];
  
  for (const edge of graph.edges) {
    const fromModule = graph.modules.get(edge.from);
    const toModule = graph.modules.get(edge.to);
    
    if (fromModule && toModule) {
      const fromLayer = fromModule.layer || 'other';
      const toLayer = toModule.layer || 'other';
      
      if (fromLayer !== toLayer) {
        crossLayerDeps.push({
          from: fromModule.shortPath,
          to: toModule.shortPath,
          fromLayer,
          toLayer,
        });
      }
    }
  }
  
  return crossLayerDeps;
}
