import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PROJECT_ROOT = '/home/workspace/claude-code-best';
const TEST_DIR = '/tmp/dep-format-test';

describe('dep-analyzer: 输出格式一致性验证', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/types'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/utils'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/components'), { recursive: true });

    writeFileSync(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
    }, null, 2));

    writeFileSync(join(TEST_DIR, 'src/types/global.ts'), 'export type Config = { name: string };');
    writeFileSync(join(TEST_DIR, 'src/utils/helper.ts'), "import { Config } from '../types/global.js'; export function createConfig(): Config { return { name: 'test' }; }");
    writeFileSync(join(TEST_DIR, 'src/components/Button.tsx'), "import { createConfig } from '../utils/helper.js'; export function Button() { return null; }");
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ========== JSON 输出格式一致性 ==========
  test('JSON: 全项目分析结构完整', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result).toHaveProperty('generated');
    expect(result).toHaveProperty('stats');
    expect(result).toHaveProperty('layers');
    expect(result).toHaveProperty('cycles');
    expect(result).toHaveProperty('crossLayerDeps');
  });

  test('JSON: stats 结构完整', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats).toHaveProperty('totalModules');
    expect(result.stats).toHaveProperty('totalEdges');
    expect(result.stats).toHaveProperty('circularDeps');
    expect(typeof result.stats.totalModules).toBe('number');
  });

  test('JSON: 可被多次解析', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
      { cwd: TEST_DIR }
    );
    const result1 = JSON.parse(stdout);
    const result2 = JSON.parse(stdout);
    expect(result1).toEqual(result2);
  });

  test('JSON: generated 格式正确', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.generated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // ========== Mermaid 输出格式一致性 ==========
  test('Mermaid: 代码块格式正确', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f mermaid',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('```mermaid');
    expect(stdout).toMatch(/```\s*$/);
  });

  test('Mermaid: flowchart 语法正确', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f mermaid',
      { cwd: TEST_DIR }
    );
    expect(stdout).toMatch(/flowchart\s+(LR|TD|BT|RL)/);
  });

  test('Mermaid: 子图语法正确', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f mermaid',
      { cwd: TEST_DIR }
    );
    expect(stdout).toMatch(/subgraph\s+\w+/);
  });

  test('Mermaid: 边语法正确', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f mermaid',
      { cwd: TEST_DIR }
    );
    expect(stdout).toMatch(/-->/);
  });

  // ========== 文本输出格式一致性 ==========
  test('文本: 包含标题', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('依赖分析报告');
    expect(stdout).toMatch(/=+/);
  });

  test('文本: 包含所有关键部分', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('模块统计');
    expect(stdout).toContain('循环依赖');
    expect(stdout).toContain('架构分层');
  });

  // ========== 简单文本输出格式 ==========
  test('simple: 无 ANSI 颜色', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f simple',
      { cwd: TEST_DIR }
    );
    expect(stdout).not.toContain('\x1b[');
  });

  test('simple: 包含关键数据', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f simple',
      { cwd: TEST_DIR }
    );
    // simple 格式应该包含统计信息
    expect(stdout).toMatch(/总模块数|Modules/);
  });

  // ========== 树状输出格式 ==========
  test('tree: 使用正确的连接符', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f tree',
      { cwd: TEST_DIR }
    );
    expect(stdout).toMatch(/[└├│]/);
  });

  test('tree: 包含文件统计', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f tree',
      { cwd: TEST_DIR }
    );
    expect(stdout).toMatch(/\(\d+\)/);
  });

  // ========== 输出到文件格式一致性 ==========
  test('文件: 保存的文本文件内容正确', async () => {
    const outputFile = join(TEST_DIR, 'saved-report.txt');
    await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -o ' + outputFile,
      { cwd: TEST_DIR }
    );
    const content = readFileSync(outputFile, 'utf-8');
    expect(content).toContain('依赖分析报告');
  });

  test('文件: 保存的 JSON 文件可解析', async () => {
    const outputFile = join(TEST_DIR, 'saved-report.json');
    await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json -o ' + outputFile,
      { cwd: TEST_DIR }
    );
    const content = readFileSync(outputFile, 'utf-8');
    const result = JSON.parse(content);
    expect(result).toHaveProperty('stats');
  });

  test('文件: 保存的 Mermaid 文件格式正确', async () => {
    const outputFile = join(TEST_DIR, 'saved-graph.mmd');
    await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f mermaid -o ' + outputFile,
      { cwd: TEST_DIR }
    );
    const content = readFileSync(outputFile, 'utf-8');
    expect(content).toContain('```mermaid');
    expect(content).toMatch(/flowchart/);
  });

  // ========== 跨格式数据一致性 ==========
  test('一致性: JSON 和文本报告的模块数一致', async () => {
    const { stdout: jsonOut } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
      { cwd: TEST_DIR }
    );
    const jsonResult = JSON.parse(jsonOut);

    const { stdout: textOut } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts',
      { cwd: TEST_DIR }
    );

    const textMatch = textOut.match(/总模块数:\s*(\d+)/);
    if (textMatch) {
      expect(parseInt(textMatch[1])).toBe(jsonResult.stats.totalModules);
    }
  });

  test('一致性: JSON 和文本报告的边数一致', async () => {
    const { stdout: jsonOut } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
      { cwd: TEST_DIR }
    );
    const jsonResult = JSON.parse(jsonOut);

    const { stdout: textOut } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts',
      { cwd: TEST_DIR }
    );

    const textMatch = textOut.match(/依赖边数:\s*(\d+)/);
    if (textMatch) {
      expect(parseInt(textMatch[1])).toBe(jsonResult.stats.totalEdges);
    }
  });
});
