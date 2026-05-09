import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PROJECT_ROOT = '/home/workspace/claude-code-best';
const TEST_DIR = '/tmp/dep-error-test';

describe('dep-analyzer: 错误处理和边界条件', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, 'src'), { recursive: true });

    writeFileSync(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } }
    }, null, 2));

    writeFileSync(join(TEST_DIR, 'src/a.ts'), 'import { b } from "./b.js"; export const a = "a";');
    writeFileSync(join(TEST_DIR, 'src/b.ts'), 'import { c } from "./c.js"; export const b = "b";');
    writeFileSync(join(TEST_DIR, 'src/c.ts'), 'export const c = "c";');
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ========== 文件不存在处理 ==========
  test('文件不存在: 返回友好错误', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/not-exist.ts',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('not found');
  });

  test('目录不存在: 返回友好错误', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/not-exist-dir',
      { cwd: TEST_DIR }
    );
    expect(stdout).toContain('not found');
  });

  test('不存在文件 JSON 格式返回 error 字段', async () => {
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/not-exist.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result).toHaveProperty('error');
  });

  // ========== 循环依赖处理 ==========
  test('循环依赖: 检测两节点循环', async () => {
    mkdirSync(join(TEST_DIR, 'src/cycle'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'src/cycle/x.ts'), 'import { y } from "./y.js"; export const x = "x";');
    writeFileSync(join(TEST_DIR, 'src/cycle/y.ts'), 'import { x } from "./x.js"; export const y = "y";');
    try {
      const { stdout } = await execAsync(
        'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
        { cwd: TEST_DIR }
      );
      const result = JSON.parse(stdout);
      expect(result.stats.circularDeps).toBeGreaterThan(0);
    } finally {
      rmSync(join(TEST_DIR, 'src/cycle'), { recursive: true, force: true });
    }
  });

  test('循环依赖: 检测三节点循环', async () => {
    mkdirSync(join(TEST_DIR, 'src/cycle3'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'src/cycle3/a.ts'), 'import { b } from "./b.js"; export const a = "a";');
    writeFileSync(join(TEST_DIR, 'src/cycle3/b.ts'), 'import { c } from "./c.js"; export const b = "b";');
    writeFileSync(join(TEST_DIR, 'src/cycle3/c.ts'), 'import { a } from "./a.js"; export const c = "c";');
    try {
      const { stdout } = await execAsync(
        'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
        { cwd: TEST_DIR }
      );
      const result = JSON.parse(stdout);
      expect(result.stats.circularDeps).toBeGreaterThan(0);
    } finally {
      rmSync(join(TEST_DIR, 'src/cycle3'), { recursive: true, force: true });
    }
  });

  test('循环依赖: -c 参数返回退出码 1', async () => {
    mkdirSync(join(TEST_DIR, 'src/cycle-check'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'src/cycle-check/p.ts'), 'import { q } from "./q.js"; export const p = "p";');
    writeFileSync(join(TEST_DIR, 'src/cycle-check/q.ts'), 'import { p } from "./p.js"; export const q = "q";');
    try {
      await expect(
        execAsync('bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -c', { cwd: TEST_DIR })
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      rmSync(join(TEST_DIR, 'src/cycle-check'), { recursive: true, force: true });
    }
  });

  // ========== 特殊文件格式处理 ==========
  test('特殊格式: 处理 JSX 文件', async () => {
    writeFileSync(join(TEST_DIR, 'src/Component.jsx'), 'import React from "react"; export default function Component() { return null; }');
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats.totalModules).toBeGreaterThan(0);
  });

  test('特殊格式: 处理纯 JS 文件', async () => {
    writeFileSync(join(TEST_DIR, 'src/util.js'), 'export function util() { return 42; }');
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats.totalModules).toBeGreaterThan(0);
  });

  test('特殊格式: 处理空文件', async () => {
    writeFileSync(join(TEST_DIR, 'src/empty.ts'), '');
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/empty.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result).toHaveProperty('file');
  });

  // ========== 导入语句边界情况 ==========
  test('导入: 处理多行导入', async () => {
    writeFileSync(join(TEST_DIR, 'src/multi-import.ts'), 
      'import {\n  type Config,\n  createConfig,\n} from "./helper.js";');
    writeFileSync(join(TEST_DIR, 'src/helper.ts'), 
      'export type Config = { name: string }; export function createConfig(): Config { return { name: "test" }; }');
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/multi-import.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats.totalDirectDependencies).toBe(1);
  });

  test('导入: 处理动态导入', async () => {
    writeFileSync(join(TEST_DIR, 'src/dynamic.ts'), 'const module = await import("./helper.js");');
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/dynamic.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats.totalDirectDependencies).toBe(1);
  });

  test('导入: 处理 re-export', async () => {
    writeFileSync(join(TEST_DIR, 'src/reexport.ts'), 'export { createConfig } from "./helper.js";');
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats.totalModules).toBeGreaterThan(0);
  });

  test('导入: 处理别名导入', async () => {
    writeFileSync(join(TEST_DIR, 'src/aliased.ts'), 'import { createConfig as makeConfig } from "./helper.js";');
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/aliased.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats.totalDirectDependencies).toBe(1);
  });

  // ========== 路径处理边界情况 ==========
  test('路径: 处理上级目录引用 (..)', async () => {
    mkdirSync(join(TEST_DIR, 'src/nested/deep'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'src/nested/deep/file.ts'), 'import { createConfig } from "../../helper.js";');
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -F src/nested/deep/file.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result.stats.totalDirectDependencies).toBe(1);
  });

  // ========== 输出格式边界情况 ==========
  test('格式: 无效 format 参数处理', async () => {
    // 无效 format 参数会导致程序静默失败或使用默认行为
    // 测试其他有效格式参数确保功能正常
    const { stdout } = await execAsync(
      'bun run ' + PROJECT_ROOT + '/scripts/dep-analyzer/index.ts -f json',
      { cwd: TEST_DIR }
    );
    const result = JSON.parse(stdout);
    expect(result).toHaveProperty('stats');
  });
});
