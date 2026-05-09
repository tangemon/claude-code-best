import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PROJECT_ROOT = '/home/workspace/claude-code-best';
const TEST_DIR = '/tmp/dep-analyzer-test';

describe('dep-analyzer: 全项目分析功能', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/types'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/utils'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/components'), { recursive: true });

    writeFileSync(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
    }, null, 2));

    writeFileSync(join(TEST_DIR, 'src/types/global.ts'), `
      export type Config = { name: string };
      export const VERSION = '1.0.0';
    `);

    writeFileSync(join(TEST_DIR, 'src/utils/helper.ts'), `
      import { Config } from '../types/global.js';
      export function createConfig(): Config { return { name: 'test' }; }
    `);

    writeFileSync(join(TEST_DIR, 'src/components/Button.tsx'), `
      import { createConfig } from '../utils/helper.js';
      export function Button() { return null; }
    `);
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('功能 1: 文本报告生成', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('依赖分析报告');
    expect(stdout).toContain('模块统计');
    expect(stdout).toContain('循环依赖');
  });

  test('功能 2: JSON 导出', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result).toHaveProperty('stats');
    expect(result).toHaveProperty('layers');
    expect(result.stats.totalModules).toBeGreaterThan(0);
  });

  test('功能 3: Mermaid 图生成', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f mermaid',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('```mermaid');
    expect(stdout).toContain('flowchart');
  });

  test('功能 4: 纯文本报告', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f simple',
      { cwd: TEST_DIR }
    );
    // simple 格式应该无 ANSI 颜色代码
    expect(stdout).not.toContain('\x1b[');
    // 应该包含基本统计信息
    expect(stdout).toMatch(/Modules:|总模块数/);
  });

  test('功能 5: 树状输出', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f tree',
      { cwd: TEST_DIR }
    );
    expect(stdout).toMatch(/[└├│]/);
  });

  test('功能 7: 循环依赖检测 - 无循环时正常退出', async () => {
    // 无循环依赖时，命令应该成功执行（不抛出错误）
    const result = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -c',
      { cwd: TEST_DIR }
    );
    // 如果成功执行，result 不应该有 error 属性
    expect(result.stdout).toContain('依赖分析报告');
  });

  test('功能 7: 循环依赖检测 - 有循环时退出码为1', async () => {
    mkdirSync(join(TEST_DIR, 'src/cycle'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'src/cycle/a.ts'), 'import { b } from "./b.js"; export const a = 1;');
    writeFileSync(join(TEST_DIR, 'src/cycle/b.ts'), 'import { a } from "./a.js"; export const b = 2;');
    try {
      await expect(
        execAsync('bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -c', { cwd: TEST_DIR })
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      rmSync(join(TEST_DIR, 'src/cycle'), { recursive: true, force: true });
    }
  });

  test('功能 8: 详细模式', async () => {
    const { stderr } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -v',
      { cwd: TEST_DIR }
    );
    expect(stderr).toContain('Analyzing project');
    expect(stderr).toContain('Found');
  });

  test('功能 9: 输出到文件', async () => {
    const outputFile = join(TEST_DIR, 'report.txt');
    await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -o ' + outputFile,
      { cwd: TEST_DIR }
    );
    const content = readFileSync(outputFile, 'utf-8');
    expect(content).toContain('依赖分析报告');
  });

  test('功能 11: 纯文本模式', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -p',
      { cwd: TEST_DIR }
    );
    // -p 参数应该保留基本内容
    expect(stdout).toContain('依赖分析报告');
    expect(stdout).toContain('模块统计');
  });
});
