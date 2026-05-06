import { describe, test, expect } from 'bun:test';
import { generateTextReport, generateSimpleReport } from '../output/report.js';
import type { AnalysisResult } from '../types.js';

function createMockResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    generated: '2024-01-01T00:00:00.000Z',
    stats: {
      totalModules: 10,
      totalEdges: 20,
      circularDeps: 0,
      crossLayerDeps: 2,
      maxDependencies: 5,
      maxDependents: 3,
    },
    mostIndependent: [{ path: 'src/utils/helper.ts', deps: 0 }],
    mostDependent: [{ path: 'src/main.tsx', deps: 5 }],
    layers: [
      {
        name: 'types',
        description: '类型定义',
        modules: ['src/types/global.ts'],
        dependsOn: [],
        dependedBy: ['utils'],
      },
      {
        name: 'utils',
        description: '工具函数',
        modules: ['src/utils/helper.ts'],
        dependsOn: ['types'],
        dependedBy: [],
      },
    ],
    cycles: [],
    crossLayerDeps: [
      {
        from: 'src/utils/helper.ts',
        to: 'src/types/global.ts',
        fromLayer: 'utils',
        toLayer: 'types',
      },
    ],
    ...overrides,
  };
}

describe('generateTextReport', () => {
  test('generates report header', () => {
    const result = createMockResult();
    const report = generateTextReport(result);

    expect(report).toContain('Claude Code 依赖分析报告');
  });

  test('displays module statistics', () => {
    const result = createMockResult();
    const report = generateTextReport(result);

    expect(report).toContain('总模块数');
    expect(report).toContain('10');
    expect(report).toContain('依赖边数');
    expect(report).toContain('20');
  });

  test('displays no cycles message when none exist', () => {
    const result = createMockResult({ cycles: [] });
    const report = generateTextReport(result);

    expect(report).toContain('未检测到循环依赖');
  });

  test('displays cycle warning when cycles exist', () => {
    const result = createMockResult({
      cycles: [
        { nodes: ['a.ts', 'b.ts', 'a.ts'], length: 2 },
      ],
      stats: { ...createMockResult().stats, circularDeps: 1 },
    });
    const report = generateTextReport(result);

    expect(report).toContain('循环依赖');
    expect(report).toContain('1');
  });

  test('displays layer information', () => {
    const result = createMockResult();
    const report = generateTextReport(result);

    expect(report).toContain('架构分层');
    expect(report).toContain('types');
    expect(report).toContain('utils');
  });

  test('displays cross-layer dependency warnings', () => {
    const result = createMockResult();
    const report = generateTextReport(result);

    expect(report).toContain('跨层依赖');
  });

  test('displays module coupling information', () => {
    const result = createMockResult();
    const report = generateTextReport(result);

    expect(report).toContain('模块耦合度');
    expect(report).toContain('最独立模块');
    expect(report).toContain('最多依赖');
  });

  test('includes generation timestamp', () => {
    const result = createMockResult();
    const report = generateTextReport(result);

    expect(report).toContain('生成时间');
    expect(report).toContain('2024-01-01');
  });

  test('handles empty layers', () => {
    const result = createMockResult({ layers: [] });
    const report = generateTextReport(result);

    expect(report).toContain('架构分层');
  });

  test('limits displayed cycles to 5', () => {
    const cycles = Array.from({ length: 10 }, (_, i) => ({
      nodes: [`a${i}.ts`, `b${i}.ts`, `a${i}.ts`],
      length: 2,
    }));
    const result = createMockResult({
      cycles,
      stats: { ...createMockResult().stats, circularDeps: 10 },
    });
    const report = generateTextReport(result);

    expect(report).toContain('... 还有 5 个');
  });
});

describe('generateSimpleReport', () => {
  test('generates basic statistics', () => {
    const result = createMockResult();
    const report = generateSimpleReport(result);

    expect(report).toContain('Modules: 10');
    expect(report).toContain('Edges: 20');
    expect(report).toContain('Cycles: 0');
  });

  test('displays layer information', () => {
    const result = createMockResult();
    const report = generateSimpleReport(result);

    expect(report).toContain('Layers:');
    expect(report).toContain('types');
    expect(report).toContain('utils');
  });

  test('shows layer dependencies', () => {
    const result = createMockResult();
    const report = generateSimpleReport(result);

    expect(report).toContain('depends on:');
  });

  test('handles empty cross-layer dependencies', () => {
    const result = createMockResult({
      crossLayerDeps: [],
      stats: { ...createMockResult().stats, crossLayerDeps: 0 },
    });
    const report = generateSimpleReport(result);

    expect(report).toContain('Cross-layer deps: 0');
  });

  test('displays module count per layer', () => {
    const result = createMockResult();
    const report = generateSimpleReport(result);

    expect(report).toContain('1 modules');
  });
});
