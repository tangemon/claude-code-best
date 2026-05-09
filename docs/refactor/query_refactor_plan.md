# query.ts 模块重构计划

> 本文档记录 `src/query.ts` 模块的重构目标、方案和进度。

## 概述

`src/query.ts` 是 Claude Code CLI 的核心模块，负责 API 查询循环、流式处理、工具执行和上下文管理。文件规模约 1991 行，是整个项目中最复杂的模块之一。

## 重构目标

| 目标 | 描述 | 优先级 |
|------|------|--------|
| **模块化** | 拆分为独立职责的子模块 | P0 |
| **可测试性** | 每个子模块独立可测 | P0 |
| **状态管理** | 简化 State 结构，降低复杂度 | P1 |
| **依赖注入** | 扩展 QueryDeps 覆盖更多依赖 | P1 |
| **可读性** | 减少嵌套层级，提取纯函数 | P2 |

## 当前状态

### ✅ 已完成

#### 1. 测试基础设施建立

- **集成测试**: `src/query/__tests__/integration.test.ts` (14 个测试)
  - 基础流程测试（stream_request_start、assistant message、completed）
  - 工具执行测试（tool_use、tool_result、continue）
  - 错误处理测试（model_error、API error）
  - 中止处理测试（aborted_streaming、aborted_tools）
  - 边界情况测试（maxTurns、empty messages）

- **单元测试**: 
  - `src/query/__tests__/unit/tokenBudget.test.ts` (19 个测试)
  - `src/query/__tests__/unit/transitions.test.ts` (22 个测试)

- **Mock 工厂**: `src/query/__tests__/mocks/query-deps.ts`
  - 提供完整的 mock 实现
  - 支持通过 partial overrides 覆盖默认行为

#### 2. QueryDeps 依赖注入扩展

**初始状态**: 4 个依赖
```typescript
type QueryDeps = {
  callModel: typeof queryModelWithStreaming
  microcompact: typeof microcompactMessages
  autocompact: typeof autoCompactIfNeeded
  uuid: () => string
}
```

**当前状态**: 19 个依赖
```typescript
type QueryDeps = {
  // Model
  callModel: typeof queryModelWithStreaming

  // Compaction
  microcompact: typeof microcompactMessages
  autocompact: typeof autoCompactIfNeeded

  // Platform
  uuid: () => string

  // Tool Execution
  runTools: typeof runTools
  generateToolUseSummary: typeof generateToolUseSummary

  // Tool Result
  applyToolResultBudget: typeof applyToolResultBudget

  // Context
  prependUserContext: typeof prependUserContext
  appendSystemContext: typeof appendSystemContext

  // Dump/Debug
  createDumpPromptsFetch: typeof createDumpPromptsFetch

  // Command
  notifyCommandLifecycle: typeof notifyCommandLifecycle

  // Profiling
  headlessProfilerCheckpoint: typeof headlessProfilerCheckpoint
  queryCheckpoint: typeof queryCheckpoint

  // Storage
  recordContentReplacement: typeof recordContentReplacement

  // Hooks
  handleStopHooks: AsyncGenerator<...>
  executeStopFailureHooks: typeof executeStopFailureHooks
  executePostSamplingHooks: typeof executePostSamplingHooks

  // Logging
  logEvent: typeof logEvent
  logError: typeof logError
}
```

#### 3. query.ts 代码更新

已将以下直接导入替换为 deps 版本：

| 函数 | 状态 |
|------|------|
| `runTools` | ✅ 已替换为 `runToolsFn` |
| `handleStopHooks` | ✅ 已替换为 `handleStopHooksFn` |
| `executeStopFailureHooks` | ✅ 已替换为 `executeStopFailureHooksFn` |
| `executePostSamplingHooks` | ✅ 已替换为 `executePostSamplingHooksFn` |
| `logEvent` | ✅ 已替换为 `logEventFn` |
| `logError` | ✅ 已替换为 `logErrorFn` |

### 📊 测试覆盖

```
测试结果: 93 pass, 0 fail
├── integration.test.ts: 14 tests
├── unit/tokenBudget.test.ts: 19 tests
├── unit/transitions.test.ts: 22 tests
├── unit/deps.test.ts: 8 tests
├── unit/phases/init.test.ts: 5 tests
├── unit/phases/preprocess.test.ts: 5 tests
├── unit/phases/autocompact.test.ts: 5 tests
├── unit/phases/streaming.test.ts: 5 tests
├── unit/phases/toolExecution.test.ts: 5 tests
└── unit/phases/recovery.test.ts: 5 tests
```

## 待完成

### P0 - 核心任务

#### 1. 替换 query.ts 中剩余的直接导入 ✅

以下函数已替换为 deps 版本：

| 函数 | 用途 | 状态 |
|------|------|------|
| `generateToolUseSummary` | 工具摘要生成 | ✅ 已替换 |
| `applyToolResultBudget` | 结果预算应用 | ✅ 已替换 |
| `prependUserContext` | 用户上下文预处理 | ✅ 已替换 |
| `appendSystemContext` | 系统上下文追加 | ✅ 已替换 |
| `createDumpPromptsFetch` | Dump prompts 创建 | ✅ 已替换 |
| `notifyCommandLifecycle` | 命令生命周期通知 | ✅ 已替换 |
| `headlessProfilerCheckpoint` | 性能检查点 | ✅ 已替换 |
| `queryCheckpoint` | 查询检查点 | ✅ 已替换 |
| `recordContentReplacement` | 替换记录 | ✅ 已替换 |

**变更内容**：
- 移除 9 个直接导入语句
- 在 `queryLoop` 中从 `deps` 解构所有函数
- 在 `query` 函数中获取 `notifyCommandLifecycleFn`（该函数在 query 和 queryLoop 中都有使用）

#### 2. 模块拆分

```
src/query/
├── index.ts              # 导出公共 API（保持向后兼容）
├── query.ts              # 主入口（精简后）
├── loop.ts               # queryLoop 核心逻辑（待提取）
├── types.ts              # QueryParams, State, Terminal, Continue
├── deps.ts               # QueryDeps 类型和工厂（已完成）
├── config.ts             # QueryConfig 构建（已独立）
├── tokenBudget.ts        # Token 预算逻辑（已独立）
├── transitions.ts        # Terminal/Continue 类型（已独立）
│
├── phases/               # 循环阶段子模块（已完成）
│   ├── init.ts           # 初始化阶段 ✅
│   ├── preprocess.ts     # 上下文预处理 ✅
│   ├── autocompact.ts    # 自动压缩 ✅
│   ├── streaming.ts      # API 流式处理 ✅
│   ├── recovery.ts       # 错误恢复 ✅
│   ├── toolExecution.ts  # 工具执行 ✅
│   └── attachments.ts    # 附件处理 ✅
│
└── __tests__/            # 测试文件（已完成）
    ├── integration.test.ts
    ├── unit/
    └── mocks/
```

**已完成的 phases 模块**：
- `init.ts` — 初始化 query loop 状态和上下文
- `preprocess.ts` — 消息预处理、预算执行
- `autocompact.ts` — 自动压缩逻辑
- `streaming.ts` — API 流式处理和工具块收集
- `recovery.ts` — 错误恢复（prompt-too-long、max_output_tokens）
- `toolExecution.ts` — 工具执行和摘要生成
- `attachments.ts` — 队列命令和附件处理

### P1 - 重要任务

#### 3. 添加更多依赖到 QueryDeps

可考虑的依赖：

| 依赖 | 用途 | 优先级 |
|------|------|--------|
| `StreamingToolExecutor` 工厂 | 流式工具执行器 | 高 |
| `buildQueryConfig` | 查询配置构建 | 中 |
| `createTrace` / `endTrace` | Langfuse 追踪 | 中 |
| `flushLangfuse` | Langfuse 刷新 | 中 |

#### 4. 补充测试用例

- 工具摘要生成测试
- 上下文预处理测试
- 压缩流程测试
- 错误恢复路径测试

### P2 - 优化任务

#### 5. 性能优化

- 分析并优化依赖注入的运行时开销
- 考虑使用 `lazy` 导入优化初始加载时间

#### 6. 文档完善

- 为每个子模块添加 JSDoc
- 补充类型定义文档

## 重构顺序

```
1. ✅ 建立测试保护网（Golden Master）
         ↓
2. ✅ 扩展 QueryDeps 依赖
         ↓
3. ✅ 替换 query.ts 中剩余直接导入
         ↓
4. ✅ 提取 phases/ 子模块（7/7 完成）
         ↓
5. ✅ 提取 loop.ts
         ↓
6. ✅ 精简 query.ts 主入口
         ↓
7. ✅ 补充子模块单元测试
         ↓
8. ⬜ 端到端测试验证
```

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| `feature()` 调用遍布全文件 | 重构时保持 feature() 在原位置，只移动纯逻辑 |
| 状态管理复杂（State 结构） | 保持 State 结构不变，先拆分纯函数 |
| AsyncGenerator 难以 mock | 通过 deps 注入隔离，不直接 mock 生成器 |
| 现有测试覆盖不足 | 先补充 Golden Master 测试，再重构 |
| 依赖循环引用 | 使用 lazy require 避免循环依赖 |

## 文件清单

### 新增文件

| 文件 | 描述 |
|------|------|
| `src/query/__tests__/integration.test.ts` | 集成测试 |
| `src/query/__tests__/unit/tokenBudget.test.ts` | tokenBudget 单元测试 |
| `src/query/__tests__/unit/transitions.test.ts` | 类型测试 |
| `src/query/__tests__/unit/deps.test.ts` | QueryDeps 工厂测试 |
| `src/query/__tests__/unit/phases/init.test.ts` | 初始化阶段测试 |
| `src/query/__tests__/unit/phases/preprocess.test.ts` | 预处理阶段测试 |
| `src/query/__tests__/unit/phases/autocompact.test.ts` | 自动压缩阶段测试 |
| `src/query/__tests__/unit/phases/streaming.test.ts` | 流式处理阶段测试 |
| `src/query/__tests__/unit/phases/toolExecution.test.ts` | 工具执行阶段测试 |
| `src/query/__tests__/unit/phases/recovery.test.ts` | 错误恢复阶段测试 |
| `src/query/__tests__/mocks/query-deps.ts` | Mock 工厂 |
| `src/query/types.ts` | Query loop 类型定义 |
| `src/query/phases/init.ts` | 初始化阶段模块 |
| `src/query/phases/preprocess.ts` | 预处理阶段模块 |
| `src/query/phases/autocompact.ts` | 自动压缩阶段模块 |
| `src/query/phases/toolExecution.ts` | 工具执行阶段模块 |
| `src/query/phases/attachments.ts` | 附件处理阶段模块 |
| `src/query/phases/streaming.ts` | 流式处理阶段模块 |
| `src/query/phases/recovery.ts` | 错误恢复阶段模块 |
| `src/query/phases/index.ts` | Phases 导出文件 |
| `src/query/loop.ts` | queryLoop 函数提取 |
| `src/query/stopHooks.ts` | Stop hooks 处理模块 |
| `src/query/config.ts` | QueryConfig 构建模块 |
| `src/query/tokenBudget.ts` | Token 预算逻辑模块 |
| `src/query/transitions.ts` | Terminal/Continue 类型模块 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/query.ts` | 从 2000+ 行精简到 247 行；移除 9 个直接导入；使用 QueryDeps 依赖注入 |
| `src/query/__tests__/mocks/query-deps.ts` | Mock 工厂（已有完整实现） |

## 验证命令

```bash
# 运行所有 query 测试
bun test src/query/__tests__/

# 类型检查
bun run typecheck

# 完整检查
bun run test:all
```

## 参考资料

- [TDD Workflow Skill](../.flow/skills/tdd-workflow/SKILL.md)
- [src/query.ts 原始代码](../src/query.ts)
- [src/query/deps.ts](../src/query/deps.ts)

---

*最后更新: 2026-05-09（P0 核心任务 1-5 全部完成，93 个测试通过）*