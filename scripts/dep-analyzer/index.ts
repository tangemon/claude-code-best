#!/usr/bin/env bun

import { resolve, basename, dirname, join, extname } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { parseTsconfig } from './parser/tsconfig.js';
import { buildDependencyGraph } from './graph/builder.js';
import { detectCycles } from './graph/cycles.js';
import { assignLayers, computeLayers, detectCrossLayerDependencies } from './graph/layers.js';
import { generateTextReport } from './output/report.js';
import { exportToJson } from './output/json.js';
import { generateMermaidGraph, generateLayerDiagram } from './output/mermaid.js';
import { generateFileDependencyGraph, generateFileTextReport, generateStructuredJson, generateTreeOnlyOutput, generateDirectoryDependencyGraph, generateDirectoryTextReport, generateDirectoryJson, generateDirectoryTreeOutput, generateDirectorySymbolTree } from './output/file-graph.js';
import { generateSymbolTreeOutput, generateSymbolTreeJson } from './output/symbol-tree.js';
import type { AnalysisResult, DependencyGraph } from './types.js';

interface CliOptions {
  format: 'text' | 'json' | 'mermaid' | 'simple' | 'tree' | 'symbols';
  output?: string;
  checkCycles: boolean;
  projectRoot: string;
  verbose: boolean;
  targetFile?: string;
  fileDepth?: number;
  fileDirection?: 'downstream' | 'upstream' | 'both';
  save?: boolean;
  plain?: boolean;
}

function isDirectory(path: string): boolean {
  return !path.endsWith('.ts') && !path.endsWith('.tsx') && !path.endsWith('.js') && !path.endsWith('.jsx');
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    format: 'text',
    checkCycles: false,
    projectRoot: process.cwd(),
    verbose: false,
    fileDepth: 2,
    fileDirection: 'both',
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--format':
      case '-f':
        options.format = args[++i] as 'text' | 'json' | 'mermaid' | 'simple' | 'tree' | 'symbols';
        break;
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--check-cycles':
      case '-c':
        options.checkCycles = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--file':
      case '-F':
        options.targetFile = args[++i];
        break;
      case '--depth':
      case '-d':
        options.fileDepth = parseInt(args[++i], 10);
        break;
      case '--direction':
        options.fileDirection = args[++i] as 'downstream' | 'upstream' | 'both';
        break;
      case '--save':
      case '-s':
        options.save = true;
        break;
      case '--plain':
      case '-p':
        options.plain = true;
        break;
      case '--help':
      case '-h':
        console.log(`
\x1b[1m用法\x1b[0m: bun run dep:analyze [选项] [路径]

\x1b[1m选项\x1b[0m:
  --format, -f <格式>    输出格式:
                          text    - 带颜色的文本报告 (默认)
                          json    - 结构化 JSON
                          mermaid - Mermaid 图
                          simple  - 纯文本无颜色
                          tree    - 目录+文件+符号树
                          symbols - 同 tree (符号级依赖)
  --output, -o <文件>    输出到指定文件
  --check-cycles, -c     检测到循环依赖时退出错误
  --verbose, -v          详细输出
  --save, -s             自动保存到 docs/diagrams/ 目录
  --plain, -p            纯文本输出（无颜色和 emoji，适合导出到文件）
  
  \x1b[33m单文件/目录分析选项\x1b[0m:
  --file, -F <路径>      分析指定文件或目录的依赖图
  --depth, -d <数字>     依赖深度 (默认: 2)
  --direction <方向>     依赖方向: downstream, upstream, both (默认: both)

\x1b[1m示例\x1b[0m:
  bun run dep:analyze                           # 全项目分析
  bun run dep:analyze -F src/main.tsx           # 分析 main.tsx 的依赖
  bun run dep:analyze -F src/assistant          # 分析 src/assistant 目录
  bun run dep:analyze -F src/assistant -f tree  # 树状输出
  bun run dep:analyze -F src/assistant -s       # 分析并保存
        `);
        process.exit(0);
      default:
        if (!arg.startsWith('-')) {
          if (arg.includes('/') || arg.includes('\\')) {
            options.targetFile = arg;
          } else {
            options.projectRoot = resolve(arg);
          }
        }
    }
  }
  
  return options;
}

function getOutputPath(options: CliOptions): string | null {
  if (options.output) {
    return resolve(options.projectRoot, options.output);
  }
  
  if (!options.save) {
    return null;
  }
  
  const diagramsDir = resolve(options.projectRoot, 'docs/diagrams');
  if (!existsSync(diagramsDir)) {
    mkdirSync(diagramsDir, { recursive: true });
  }
  
  let filename: string;
  if (options.targetFile) {
    const baseName = basename(options.targetFile, extname(options.targetFile));
    const parts = options.targetFile.replace(/\\/g, '/').split('/');
    const dirPart = parts.slice(0, -1).join('_').replace(/[^a-zA-Z0-9]/g, '_') || 'src';
    filename = `dep_${dirPart}_${baseName}`;
  } else {
    filename = 'dep_project';
  }
  
  const ext = options.format === 'mermaid' ? '.mmd' 
    : options.format === 'json' ? '.json' 
    : '.txt';
  
  return join(diagramsDir, filename + ext);
}

async function analyze(options: CliOptions): Promise<AnalysisResult> {
  if (options.verbose) {
    console.error(`Analyzing project at: ${options.projectRoot}`);
  }
  
  const tsconfig = parseTsconfig(resolve(options.projectRoot, 'tsconfig.json'));
  if (options.verbose) {
    console.error(`Found ${Object.keys(tsconfig.paths).length} path aliases`);
  }
  
  let graph = await buildDependencyGraph(options.projectRoot, tsconfig);
  if (options.verbose) {
    console.error(`Found ${graph.modules.size} modules`);
  }
  
  assignLayers(graph);
  graph.layers = computeLayers(graph);
  graph.cycles = detectCycles(graph);
  graph.crossLayerDeps = detectCrossLayerDependencies(graph);
  
  const moduleList = Array.from(graph.modules.entries());
  const depCounts = moduleList.map(([path, info]) => ({
    path: info.shortPath,
    deps: info.imports.length,
    dependents: info.importedBy.size,
  }));
  
  depCounts.sort((a, b) => b.deps - a.deps);
  const mostDependent = depCounts.slice(0, 5);
  
  depCounts.sort((a, b) => a.deps - b.deps);
  const mostIndependent = depCounts.filter(m => m.deps === 0).slice(0, 5);
  
  return {
    generated: new Date().toISOString(),
    stats: {
      totalModules: graph.modules.size,
      totalEdges: graph.edges.length,
      circularDeps: graph.cycles.length,
      crossLayerDeps: graph.crossLayerDeps.length,
      maxDependencies: mostDependent[0]?.deps || 0,
      maxDependents: Math.max(...moduleList.map(([, m]) => m.importedBy.size)),
    },
    mostIndependent,
    mostDependent,
    layers: graph.layers,
    cycles: graph.cycles,
    crossLayerDeps: graph.crossLayerDeps,
  };
}

async function analyzeFile(options: CliOptions): Promise<DependencyGraph> {
  const tsconfig = parseTsconfig(resolve(options.projectRoot, 'tsconfig.json'));
  const graph = await buildDependencyGraph(options.projectRoot, tsconfig);
  assignLayers(graph);
  graph.layers = computeLayers(graph);
  graph.cycles = detectCycles(graph);
  
  return graph;
}

function saveToFile(content: string, outputPath: string): void {
  writeFileSync(outputPath, content, 'utf-8');
  console.error(`\x1b[32m✓ 已保存到 ${outputPath}\x1b[0m`);
}

async function main() {
  const options = parseArgs();
  const outputPath = getOutputPath(options);
  
  try {
    if (options.targetFile) {
      const graph = await analyzeFile(options);
      const isDir = isDirectory(options.targetFile);
      
      if (isDir) {
        if (options.format === 'json') {
          const structuredData = generateDirectoryJson(graph, options.targetFile);
          const json = JSON.stringify(structuredData, null, 2);
          
          if (outputPath) {
            saveToFile(json, outputPath);
          } else {
            console.log(json);
          }
        } else if (options.format === 'symbols') {
          const symbolOutput = generateDirectorySymbolTree(graph, options.targetFile, { plain: options.plain });
          
          if (outputPath) {
            saveToFile(symbolOutput, outputPath);
          } else {
            console.log(symbolOutput);
          }
        } else if (options.format === 'tree') {
          const treeOutput = generateDirectoryTreeOutput(graph, options.targetFile);
          
          if (outputPath) {
            saveToFile(treeOutput, outputPath);
          } else {
            console.log(treeOutput);
          }
        } else if (options.format === 'mermaid') {
          const textReport = generateDirectoryTextReport(graph, options.targetFile);
          const mermaidGraph = generateDirectoryDependencyGraph(graph, options.targetFile, {
            depth: options.fileDepth!,
            direction: options.fileDirection,
          });
          
          const fullContent = textReport + '\n' + mermaidGraph;
          
          if (outputPath) {
            saveToFile(fullContent, outputPath);
          } else {
            console.log(fullContent);
          }
        } else {
          const textReport = generateDirectoryTextReport(graph, options.targetFile);
          const mermaidGraph = generateDirectoryDependencyGraph(graph, options.targetFile, {
            depth: options.fileDepth!,
            direction: options.fileDirection,
          });
          
          const fullContent = textReport + '\n' + mermaidGraph;
          
          if (outputPath) {
            saveToFile(fullContent, outputPath);
          } else {
            console.log(fullContent);
          }
        }
      } else {
        if (options.format === 'json') {
          const structuredData = generateStructuredJson(graph, options.targetFile);
          const json = JSON.stringify(structuredData, null, 2);
          
          if (outputPath) {
            saveToFile(json, outputPath);
          } else {
            console.log(json);
          }
        } else if (options.format === 'tree' || options.format === 'symbols') {
          const treeOutput = generateSymbolTreeOutput(graph, options.targetFile);
          
          if (outputPath) {
            saveToFile(treeOutput, outputPath);
          } else {
            console.log(treeOutput);
          }
        } else if (options.format === 'mermaid') {
          const textReport = generateFileTextReport(graph, options.targetFile);
          const mermaidGraph = generateFileDependencyGraph(graph, options.targetFile, {
            depth: options.fileDepth!,
            direction: options.fileDirection,
          });
          
          const fullContent = textReport + '\n' + mermaidGraph;
          
          if (outputPath) {
            saveToFile(fullContent, outputPath);
          } else {
            console.log(fullContent);
          }
        } else {
          const textReport = generateFileTextReport(graph, options.targetFile);
          const mermaidGraph = generateFileDependencyGraph(graph, options.targetFile, {
            depth: options.fileDepth!,
            direction: options.fileDirection,
          });
          
          const fullContent = textReport + '\n' + mermaidGraph;
          
          if (outputPath) {
            saveToFile(fullContent, outputPath);
          } else {
            console.log(fullContent);
          }
        }
      }
      return;
    }
    
    const result = await analyze(options);
    
    switch (options.format) {
      case 'text':
      case 'simple':
      case 'tree':
      case 'symbols': {
        const report = options.format === 'simple' 
          ? generateTextReport(result).replace(/\x1b\[[0-9;]*m/g, '')
          : generateTextReport(result);
        
        if (outputPath) {
          saveToFile(report, outputPath);
        } else {
          console.log(report);
        }
        break;
      }
      case 'json': {
        const json = exportToJson(result);
        if (outputPath) {
          saveToFile(json, outputPath);
        } else {
          console.log(json);
        }
        break;
      }
      case 'mermaid': {
        const tsconfig = parseTsconfig(resolve(options.projectRoot, 'tsconfig.json'));
        const graph = await buildDependencyGraph(options.projectRoot, tsconfig);
        assignLayers(graph);
        graph.layers = computeLayers(graph);
        graph.cycles = detectCycles(graph);
        
        const mermaidContent = generateMermaidGraph(graph, { showLayers: true, maxNodes: 50 }) 
          + '\n\n---\n\n' 
          + generateLayerDiagram(graph.layers);
        
        if (outputPath) {
          saveToFile(mermaidContent, outputPath);
        } else {
          console.log(mermaidContent);
        }
        break;
      }
    }
    
    if (options.checkCycles && result.stats.circularDeps > 0) {
      console.error(`\nError: Found ${result.stats.circularDeps} circular dependencies`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

main();
