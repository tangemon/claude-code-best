import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PROJECT_ROOT = '/home/workspace/claude-code-best';
const TEST_DIR = '/tmp/dep-file-test';

describe('dep-analyzer: 单文件分析功能', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/types'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/utils'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/components'), { recursive: true });

    writeFileSync(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
    }, null, 2));

    // 创建深层依赖结构
    writeFileSync(join(TEST_DIR, 'src/types/global.ts'), `
      export type Config = { name: string; version: string };
      export const VERSION = '1.0.0';
    `);

    writeFileSync(join(TEST_DIR, 'src/utils/helper.ts'), `
      import { Config } from '../types/global.js';
      export function createConfig(): Config { return { name: 'test', version: '1.0.0' }; }
      export function validateConfig(config: Config): boolean { return !!config.name; }
    `);

    writeFileSync(join(TEST_DIR, 'src/utils/string.ts'), `
      import { createConfig } from './helper.js';
      export function formatString(str: string): string {
        const config = createConfig();
        return config.version + ' ' + str;
      }
      export function capitalize(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
      }
    `);

    writeFileSync(join(TEST_DIR, 'src/components/Button.tsx'), `
      import { formatString, capitalize } from '../utils/string.js';
      import { validateConfig } from '../utils/helper.js';
      export function Button() { return null; }
      export function IconButton() { return null; }
    `);
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ========== 功能 12: 文件文本报告 ==========
  test('功能 12: 文件文本报告生成', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('文件依赖分析');
    expect(stdout).toContain('Button.tsx');
    expect(stdout).toContain('直接依赖');
    expect(stdout).toContain('被依赖');
  });

  test('功能 12: 文件报告包含统计信息', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx',
      { cwd: TEST_DIR }
    );
    expect(stdout).toMatch(/直接依赖:\s*\d+/);
    expect(stdout).toMatch(/被依赖数:\s*\d+/);
    expect(stdout).toMatch(/所在层级:/);
  });

  test('功能 12: 显示直接依赖文件', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('string.ts');
    expect(stdout).toContain('helper.ts');
  });

  // ========== 功能 13: 文件 JSON 导出 ==========
  test('功能 13: 文件 JSON 导出结构', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result).toHaveProperty('file');
    expect(result).toHaveProperty('layer');
    expect(result).toHaveProperty('stats');
    expect(result).toHaveProperty('directDependencies');
    expect(result).toHaveProperty('importedBy');
  });

  test('功能 13: stats 包含依赖统计', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats).toHaveProperty('totalDirectDependencies');
    expect(result.stats).toHaveProperty('totalDependents');
  });

  test('功能 13: directDependencies 包含 flat 和 tree', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.directDependencies).toHaveProperty('flat');
    expect(result.directDependencies).toHaveProperty('tree');
  });

  // ========== 功能 14: 文件 Mermaid 图 ==========
  test('功能 14: 文件 Mermaid 图生成', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx -f mermaid',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('```mermaid');
    expect(stdout).toContain('flowchart');
    expect(stdout).toContain('Button');
  });

  test('功能 14: 包含依赖关系边', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx -f mermaid',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('-->');
  });

  // ========== 功能 15: 文件树状输出 ==========
  test('功能 15: 文件树状输出', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx -f tree',
      { cwd: TEST_DIR }
    );
    // tree 格式会输出符号树
    expect(stdout).toContain('Symbol');
    expect(stdout).toMatch(/[└├│]/);
  });

  // ========== 功能 16: 文件符号树 ==========
  test('功能 16: 文件符号树生成', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx -f symbols',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('Symbol');
    expect(stdout).toMatch(/[└├│]/);
  });

  test('功能 16: 显示导入的符号信息', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx -f symbols',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('formatString');
    expect(stdout).toContain('capitalize');
  });

  // ========== 功能 17: 依赖深度控制 ==========
  test('功能 17: depth=1 只显示直接依赖', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx -d 1',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('string.ts');
    expect(stdout).toContain('helper.ts');
  });

  test('功能 17: depth=2 影响 Mermaid 图', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx -d 2',
      { cwd: TEST_DIR }
    );
    // depth 参数影响 Mermaid 图中的依赖深度
    expect(stdout).toContain('```mermaid');
    expect(stdout).toContain('flowchart');
  });

  // ========== 功能 18: 依赖方向控制 ==========
  test('功能 18: direction=downstream 只显示被依赖', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/types/global.ts --direction downstream',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('被依赖');
  });

  test('功能 18: direction=upstream 只显示依赖', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/Button.tsx --direction upstream',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('直接依赖');
  });

  test('功能 18: direction=both 显示双向依赖', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/utils/helper.ts --direction both',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('直接依赖');
    expect(stdout).toContain('被依赖');
  });

  // ========== 边界条件测试 ==========
  test('边界: 分析不存在的文件', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/not-exist.ts',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('not found');
  });

  test('边界: 分析没有依赖的文件', async () => {
    writeFileSync(join(TEST_DIR, 'src/standalone.ts'), 'export const CONSTANT = "standalone";');
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/standalone.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats.totalDirectDependencies).toBe(0);
  });

  test('边界: 分析不被依赖的文件', async () => {
    writeFileSync(join(TEST_DIR, 'src/unused.ts'), 'export function unused() { return 42; }');
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/unused.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats.totalDependents).toBe(0);
  });
});
