# TypeScript/TSX 项目依赖分析工具推荐

> 生成日期：2026-05-08 | 来源：GitHub + npm 调研 | 状态：已验证

## 背景

在大型 TypeScript / TSX 项目中，理解模块间的依赖关系对以下场景至关重要：

- **架构治理** — 确保分层架构不被破坏，防止循环依赖
- **重构辅助** — 评估变更影响范围（blast radius）
- **死代码清理** — 识别未被引用的文件和未使用的 npm 包
- **代码质量度量** — 计算耦合度、凝聚力、圈复杂度等指标
- **文档生成** — 自动产出依赖图，辅助新人 onboarding

---

## 1. Dependency Cruiser（依赖巡航者）

| 维度 | 信息 |
|------|------|
| GitHub | https://github.com/sverweij/dependency-cruiser |
| 星星数 | 6.6K+ |
| npm 周下载 | 150 万 |
| 许可证 | MIT |
| 支持文件 | `.js` `.jsx` `.ts` `.tsx` `.vue` `.svelte` `.coffee` |
| 模块系统 | ES6, CommonJS, AMD |

### 核心能力

- **规则验证** — 通过 `.dependency-cruiser.js` 配置文件定义架构边界规则，例如「UI 层不可直接访问数据库层」
- **CI 集成** — 以类似 ESLint 的报告格式输出违规信息，可直接嵌入 CI/CD 流水线
- **循环依赖检测** — 自动发现环形引用链并报告
- **缺失依赖检测** — 发现引用了但未在 `package.json` 中声明的 npm 包
- **孤儿文件检测** — 找出没有任何其他文件引用的模块
- **Webpack 别名支持** — 自动读取 webpack/TSConfig 的路径映射配置

### 输出格式

DOT、Mermaid、JSON、CSV、HTML（自包含报告）、纯文本

### 快速上手

```bash
# 安装
npm install --save-dev dependency-cruiser

# 初始化配置（自动检测项目结构并生成规则）
npx depcruise --init

# 生成可视化图
npx depcruise src --include-only "^src" --output-type dot | dot -T svg > dependency-graph.svg

# CI 验证
npx depcruise src
```

### 适用场景

适合需要**强制执行架构规范**的团队——在 PR 合并前自动拦截违反分层规则的代码提交。

---

## 2. skott

| 维度 | 信息 |
|------|------|
| GitHub | https://github.com/antoine-coulon/skott |
| 许可证 | MIT |
| 支持文件 | `.js` `.jsx` `.cjs` `.mjs` `.ts` `.tsx` |

### 核心能力

- **全栈解析** — 不依赖模块系统配置，自动识别 `require/import`，支持 ESM 和 CommonJS
- **循环依赖深度检测** — 可配置搜索最大深度
- **未使用文件检测** — 找出整个代码库中没有任何文件引用的源文件
- **未使用 npm 依赖检测** — 识别 `package.json` 中声明但实际未使用的第三方依赖
- **图 API 暴露** — 提供 DFS/BFS 遍历、父子依赖查找等图操作原语
- **TypeScript 路径别名支持** — 自动读取 `tsconfig.json` 中的 `paths` 配置
- **交互式 Web UI** — 内置可视化前端，可放大/缩小查看依赖图

### 输出格式

CLI 文件树、交互式 Web 应用、`.svg`、`.png`、`.md`、`.json`

### 快速上手（CLI）

```bash
npx skott --help
```

### 快速上手（API）

```ts
import skott from "skott";

const { getStructure, getWorkspace, findUnusedDependencies, useGraph } = await skott({
  ignorePatterns: ["test/**/*"],
  dependencyTracking: {
    builtin: false,
    thirdParty: true,
    typeOnly: true,
  },
});

const { graph, files } = getStructure();
const unusedDependencies = await findUnusedDependencies();
const { findCircularDependencies, collectFilesDependencies, ...traversalApi } = useGraph();
```

### 适用场景

适合需要**同时使用 CLI 和编程 API** 的开发者——可以用 skott 的图原语构建自定义工具（如增量构建、影响分析等）。

---

## 3. Madge

| 维度 | 信息 |
|------|------|
| GitHub | https://github.com/pahen/madge |
| 许可证 | MIT |
| 支持文件 | `.js` `.jsx` `.ts` `.tsx` |
| 模块系统 | ES6, CommonJS, AMD |

### 核心能力

- **快速出图** — 一行命令生成 SVG/PNG 依赖图
- **循环依赖检测** — 自动报告环形引用
- **多格式输出** — Graphviz DOT、JSON、GraphML
- **既可 CLI 也可作库** — 可在 Node.js 脚本中调用

### 快速上手

```bash
# 安装（需要系统已安装 Graphviz）
npm install -g madge

# 生成依赖图
npx madge --image graph.svg src/index.ts

# 检测循环依赖
npx madge --circular src/index.ts

# 输出 JSON
npx madge --json deps.json src/index.ts
```

### 适用场景

适合需要**快速查看依赖关系、不做复杂规则配置**的场景——轻量、开箱即用。

---

## 4. codebase-intelligence（代码库智能分析）

| 维度 | 信息 |
|------|------|
| GitHub | https://github.com/bntvllnt/codebase-intelligence |
| 许可证 | MIT |
| 支持文件 | TypeScript 项目 |

### 核心能力

- **15 个 CLI 命令** — 覆盖架构分析、依赖影响面、死代码检测、搜索等
- **11 项架构度量指标**：

  | 指标 | 含义 |
  |------|------|
  | PageRank | 文件被引用频率（重要性排序） |
  | Betweenness（中介中心性） | 连接不同模块的"桥梁"文件 |
  | Coupling（耦合度） | 文件的扇入/扇出连接数 |
  | Cohesion（凝聚力） | 模块内部依赖 vs 外部依赖的比值 |
  | Tension（张力） | 文件被多个模块拉扯的程度 |
  | Escape Velocity | 是否应该拆成独立包 |
  | Churn（变更频率） | Git 提交频次分析 |
  | Complexity（复杂度） | 导出函数的平均圈复杂度 |
  | Blast Radius（影响半径） | 变更一个文件会影响多少传递依赖文件 |
  | Dead Exports（死导出） | 未被任何地方使用的导出符号 |
  | Test Coverage（测试覆盖） | 每个源文件是否有对应的测试文件 |

- **符号级分析** — 调用者/被调用者关系、符号重要性排序
- **Git diff 分析** — 变更文件的风险度量
- **社区检测** — Louvain 聚类，自动识别文件分组
- **BM25 搜索** — 跨文件和符号的关键词搜索
- **可选 MCP Server** — 为 AI Agent 提供 15 个 MCP 工具

### 快速上手

```bash
npx codebase-intelligence overview ./src        # 全局概览
npx codebase-intelligence hotspots ./src         # 热点文件排序
npx codebase-intelligence dead-exports ./src     # 死导出检测
npx codebase-intelligence dependents ./src/file  # 影响半径分析
npx codebase-intelligence changes ./src          # Git diff 分析
```

### 适用场景

适合**深度架构分析**——热点识别、影响面评估、死代码检测。特别适合大型项目的重构前评估。

---

## 5. typescript-graph（tsg）

| 维度 | 信息 |
|------|------|
| GitHub | https://github.com/ysk8hori/typescript-graph |
| 许可证 | MIT |
| 支持文件 | `.ts` `.tsx` |

### 核心能力

- **自动读取 tsconfig.json** — 基于 TypeScript 编译器配置进行路径解析
- **Mermaid 图表输出** — 可直接嵌入 Markdown / GitHub / Notion 文档
- **include / exclude 过滤** — 精确控制分析范围
- **目录抽象** — 将整个目录视为单一节点，降低大图复杂度
- **代码质量度量**：
  - Maintainability Index（可维护性指数）
  - Cyclomatic Complexity（圈复杂度）
  - Cognitive Complexity（认知复杂度）
- **实时监控** — `--watch-metrics` 文件变更时自动重算指标
- **`--stdout` 结构化输出** — 可管道输出给 LLM Agent 或静态分析器

### 快速上手

```bash
npx typescript-graph --dir src                # 生成 Mermaid 图
npx typescript-graph --dir src --metrics      # 附带代码质量度量
npx typescript-graph --stdout deps            # 仅输出依赖图 JSON
npx typescript-graph --stdout metrics         # 仅输出度量 JSON
npx typescript-graph --watch-metrics --dir src # 实时监控
```

### 适用场景

适合**文档驱动团队**——生成的 Mermaid 图可直接嵌入 Markdown，GitHub / GitLab 会自动渲染。也适合 AI Agent 集成（结构化 JSON 输出）。

---

## 横向对比

| 特性 | Dependency Cruiser | skott | Madge | codebase-intelligence | typescript-graph |
|------|:-:|:-:|:-:|:-:|:-:|
| 规则验证 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 循环依赖检测 | ✅ | ✅ | ✅ | ❌ | ✅ |
| 死代码/未使用文件 | ✅（孤儿） | ✅ | ❌ | ✅（死导出） | ❌ |
| 架构度量指标 | ❌ | ❌ | ❌ | ✅（11 项） | ✅（3 项） |
| 可视化输出 | DOT/Mermaid/HTML | SVG/PNG/Web UI | Graphviz | JSON/Mermaid | Mermaid |
| 编程 API | 有限 | ✅ 完整 | ✅ | 有限 | 有限 |
| TS 路径别名 | ✅ | ✅ | ✅ | ✅ | ✅ |
| CI 集成友好 | ✅ 首选 | ✅ | ✅ | ✅ | ✅ |
| AI Agent 友好 | ❌ | ❌ | ❌ | ✅（MCP） | ✅（--stdout） |
| npm 周下载 | 150 万 | — | — | — | — |
| 社区成熟度 | 极高（2016 年启动） | 中 | 高 | 低（新兴） | 中 |

---

## 选型建议

| 你的需求 | 推荐工具 |
|----------|----------|
| 强制执行架构规则，CI 拦截违规 | **Dependency Cruiser** |
| 需要编程 API 构建自定义工具 | **skott** |
| 快速出图，轻量简单 | **Madge** |
| 深度架构分析 + 影响面评估 | **codebase-intelligence** |
| 文档友好，Mermaid 嵌入 | **typescript-graph** |

### 组合使用推荐

- **日常开发**：`skott`（交互式 Web UI 查看依赖图）+ `dependency-cruiser`（CI 验证）
- **重构前评估**：`codebase-intelligence`（热点分析 + 影响半径）+ `dependency-cruiser`（规则检查）
- **文档沉淀**：`typescript-graph`（Mermaid 输出嵌入 Markdown）+ `skott`（导出 JSON 保留原始数据）

---

## 参考资料

1. [sverweij/dependency-cruiser](https://github.com/sverweij/dependency-cruiser) — 官方 README
2. [antoine-coulon/skott](https://github.com/antoine-coulon/skott) — 官方 README
3. [pahen/madge](https://github.com/pahen/madge) — 官方 README
4. [bntvllnt/codebase-intelligence](https://github.com/bntvllnt/codebase-intelligence) — 官方 README
5. [ysk8hori/typescript-graph](https://github.com/ysk8hori/typescript-graph) — 官方 README
6. [dependency-cruiser on npm](https://www.npmjs.com/package/dependency-cruiser) — npm 包信息
7. [How to Visualize Your npm Dependency Graph](https://www.pkg-graph.info/article/how-to-visualize-npm-dependency-graph) — 工具对比评测

---

## 方法论

通过 Exa 搜索引擎在 GitHub 和 npm 注册表中搜索了 "TypeScript dependency analysis tools"、"TSX project static analysis" 等关键词，分析了 20+ 个开源项目。基于以下维度进行筛选：

- 是否支持 TypeScript/TSX 文件解析
- 是否活跃维护（2025-2026 年有提交记录）
- 是否具有可用的 CLI 或 API
- 功能覆盖度和差异化程度
