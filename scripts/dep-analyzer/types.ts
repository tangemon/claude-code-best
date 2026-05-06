export type SymbolType = 'function' | 'class' | 'interface' | 'type' | 'const' | 'variable' | 'enum' | 'export' | 'default' | 're-export' | 'unknown';

export interface ExportInfo {
  name: string;
  type: SymbolType;
  from?: string;
  line?: number;
}

export interface ImportInfo {
  path: string;
  names: string[];
  isDynamic: boolean;
  isReExport: boolean;
}

export interface SymbolDependency {
  symbolName: string;
  targetFile: string;
  targetSymbol?: string;
  type: 'import' | 're-export' | 'type';
}

export interface ModuleInfo {
  path: string;
  shortPath: string;
  relativePath: string;
  exports: ExportInfo[];
  imports: ImportInfo[];
  importedBy: Set<string>;
  layer?: string;
  symbols?: ExportInfo[];
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'import' | 're-export' | 'dynamic-import';
  isCircular: boolean;
}

export interface Cycle {
  nodes: string[];
  length: number;
}

export interface LayerDefinition {
  name: string;
  patterns: string[];
  description?: string;
}

export interface Layer {
  name: string;
  description?: string;
  modules: string[];
  dependsOn: string[];
  dependedBy: string[];
}

export interface CrossLayerDependency {
  from: string;
  to: string;
  fromLayer: string;
  toLayer: string;
}

export interface DependencyGraph {
  modules: Map<string, ModuleInfo>;
  edges: DependencyEdge[];
  layers: Layer[];
  cycles: Cycle[];
  crossLayerDeps: CrossLayerDependency[];
}

export interface AnalysisResult {
  generated: string;
  stats: {
    totalModules: number;
    totalEdges: number;
    circularDeps: number;
    crossLayerDeps: number;
    maxDependencies: number;
    maxDependents: number;
  };
  mostIndependent: { path: string; deps: number }[];
  mostDependent: { path: string; deps: number }[];
  layers: Layer[];
  cycles: Cycle[];
  crossLayerDeps: CrossLayerDependency[];
}

export interface TsconfigPaths {
  [key: string]: string[];
}
