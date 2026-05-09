import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PROJECT_ROOT = '/home/workspace/claude-code-best';
const TEST_DIR = '/tmp/dep-dir-test';

describe('dep-analyzer: 目录分析功能', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/types'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/utils'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/components'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/components/inputs'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src/components/layouts'), { recursive: true });

    writeFileSync(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
    }, null, 2));

    // types 层
    writeFileSync(join(TEST_DIR, 'src/types/global.ts'), 'export type Config = { name: string };');
    writeFileSync(join(TEST_DIR, 'src/types/api.ts'), "import { Config } from './global.js'; export interface ApiResponse<T> { data: T; config: Config; }");

    // utils 层
    writeFileSync(join(TEST_DIR, 'src/utils/helper.ts'), "import { Config } from '../types/global.js'; export function createConfig(): Config { return { name: 'test' }; }");
    writeFileSync(join(TEST_DIR, 'src/utils/string.ts'), "import { createConfig } from './helper.js'; export function format(str: string): string { return str; }");

    // components 层
    writeFileSync(join(TEST_DIR, 'src/components/Button.tsx'), "import { format } from '../utils/string.js'; export function Button() { return null; }");
    writeFileSync(join(TEST_DIR, 'src/components/Input.tsx'), "import { Config } from '../types/global.js'; export function Input() { return null; }");

    // components/inputs 层
    writeFileSync(join(TEST_DIR, 'src/components/inputs/TextInput.tsx'), "import { Config } from '../../types/global.js'; export function TextInput() { return null; }");
    writeFileSync(join(TEST_DIR, 'src/components/inputs/Select.tsx'), "import { Button } from '../Button.js'; export function Select() { return null; }");

    // components/layouts 层
    writeFileSync(join(TEST_DIR, 'src/components/layouts/Card.tsx'), "import { Button } from '../Button.js'; import { Input } from '../Input.js'; export function Card() { return null; }");
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ========== 功能 19: 目录文本报告 ==========
  test('功能 19: 目录文本报告生成', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('目录依赖分析');
    expect(stdout).toContain('components');
    expect(stdout).toContain('目录内文件');
    expect(stdout).toContain('外部依赖');
  });

  test('功能 19: 报告包含目录内文件列表', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('Button.tsx');
    expect(stdout).toContain('Input.tsx');
  });

  test('功能 19: 报告包含统计信息', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components',
      { cwd: TEST_DIR }
    );
    expect(stdout).toMatch(/目录内文件数:\s*\d+/);
    expect(stdout).toMatch(/外部依赖数:\s*\d+/);
  });

  // ========== 功能 20: 目录 JSON 导出 ==========
  test('功能 20: 目录 JSON 导出结构', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result).toHaveProperty('directory');
    expect(result).toHaveProperty('files');
    expect(result).toHaveProperty('stats');
    expect(result).toHaveProperty('externalDependencies');
    expect(result).toHaveProperty('externalDependents');
  });

  test('功能 20: stats 包含目录统计', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats).toHaveProperty('totalFiles');
    expect(result.stats).toHaveProperty('totalExternalDependencies');
    expect(result.stats).toHaveProperty('totalExternalDependents');
  });

  test('功能 20: files 数组包含目录内所有文件', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.files.length).toBeGreaterThanOrEqual(4);
  });

  // ========== 功能 21: 目录 Mermaid 图 ==========
  test('功能 21: 目录 Mermaid 图生成', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components -f mermaid',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('```mermaid');
    expect(stdout).toContain('flowchart');
    expect(stdout).toContain('components_dir');
  });

  test('功能 21: 包含目录子图', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components -f mermaid',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('subgraph');
  });

  // ========== 功能 22: 目录树状输出 ==========
  test('功能 22: 目录树状输出', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components -f tree',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('目录依赖分析');
    expect(stdout).toMatch(/[└├│]/);
  });

  // ========== 功能 23: 目录符号树 ==========
  test('功能 23: 目录符号树生成', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components -f symbols',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('Symbol');
    expect(stdout).toMatch(/[└├│]/);
  });

  test('功能 23: 包含图例', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components -f symbols',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('Legend:');
  });

  test('功能 23: 区分外部依赖和被外部依赖', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components -f symbols',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('External Dependencies');
    expect(stdout).toContain('Depended On');
  });

  // ========== 目录分析边界条件 ==========
  test('边界: 分析只有 TypeScript 文件的目录', async () => {
    mkdirSync(join(TEST_DIR, 'src/pure-ts'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'src/pure-ts/util.ts'), 'export function util() { return 42; }');
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/pure-ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats.totalFiles).toBe(1);
  });

  test('边界: 分析不存在的目录', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/not-exist',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('not found');
  });

  test('边界: 分析嵌套目录', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/components/inputs -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.directory).toContain('inputs');
    expect(result.stats.totalFiles).toBeGreaterThan(0);
  });
});
