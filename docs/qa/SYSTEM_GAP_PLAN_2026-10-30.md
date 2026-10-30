# Centinel 全系统缺口清单与修复计划

- 日期：2026-10-30
- 代码版本：`main` @ `52e5169`（已包含 PR #43、#44）
- 依据：[PRD](../Centinel_PRD_Revised.md)（STA / DYN / SHR 需求、§13.2 的 14 个必选验收场景）、[DESIGN.md](../../DESIGN.md)、[DEVELOPMENT_PROGRESS.md](../DEVELOPMENT_PROGRESS.md)，以及两份已有的 QA 评审：
  - [QA_SYSTEM_REVIEW_2026-10-28.md](QA_SYSTEM_REVIEW_2026-10-28.md)（不含 Static）
  - [QA_FULL_SYSTEM_FLOW_REVIEW_2026-10-30.md](QA_FULL_SYSTEM_FLOW_REVIEW_2026-10-30.md)（含 Static）
- 方法：对照 PRD 读代码。两份 QA 评审里的每个问题，都在当前 `main` 上重新确认是否仍然存在。**本次没有在浏览器中实测，也没有发起任何付费的模型调用**。测试结果见第五节。

---

## 一、结论

1. **两个模块各自基本可用，但它们之间没有接通。** Dynamic 在 10-15 已按约定范围（Web / Vitest / Codex-live）验收。不过当时 Static 输入一直使用 mock 快照。Static 的 Review 引擎和结果页已经达到可演示的质量。
2. **PRD 中“Static → Dynamic”这条主线完全缺失**：没有把 Review 快照导出给 Dynamic 的功能，Dynamic 也只能读取 `createStaticContextStub`。这同时影响 STA-08、DYN-05、DYN-13 和验收场景 4。
3. **Static 自己的主流程有两个断点**：
   - 无法在 UI 中确认 requirements，导致 Traceability 永远为空；
   - 已批准的 Review 在 Home / Project 页显示的状态是错的。
4. **协作能力不完整**：没有成员邀请或移除的 UI，也没有注册和重置密码。验收场景 13 无法在 UI 中完成。

---

## 二、PRD 覆盖矩阵

状态说明：✅ 已实现且有验收记录；🟡 部分实现，或只在受限范围内验收；❌ 缺失。

### 2.1 Static（STA）

| ID | 需求 | 状态 | 说明 |
|---|---|---|---|
| STA-01 | 带来源信息的 source 导入 | ✅ | 支持本地、GitHub、Drive、Slack 导入，记录 hash 和 version；PDF 抽取有 fail-closed。图表和扫描件仍明确标为 unverified |
| STA-02 | 跨文档一致性 | 🟡 | 需要依靠已确认的 requirements，而 UI 无法确认 requirements（见 G-S1） |
| STA-03 | 安全相关分析 | ✅ | 四个 domain 的评估和引用校验已具备；实测能找到 XSS 和硬编码凭据 |
| STA-04 | Requirement 完整性与可追溯性 | ❌（流程层面） | 引擎能做，但 `RequirementsScreen` 没有入口，所以 Traceability 总是空的 |
| STA-05 | 结构化 finding 与修复建议 | 🟡 | 确定性规则和模型对同一处代码会各报一条，未合并；项目层面重复计数（G-S5） |
| STA-06 | 文档版本与时效 | 🟡 | 有版本和同步状态；但“确认时效 / 标记 deprecated / 90 天间隔”没有可操作的 UI |
| STA-07 | 冻结上下文与可归属的决定 | ✅ | 冻结 manifest、iteration、决定记录都已具备 |
| STA-08 | 导出 Review 报告并供 Dynamic 使用 | ❌ | 只有项目级统一报告；没有单个 Review 的报告，也没有 Review 快照到 Dynamic 的交换 |

### 2.2 Dynamic（DYN）

| ID | 状态 | 说明 |
|---|---|---|
| DYN-01 ~ 04 环境、变量、preflight、测试数据 | ✅ | M2 已验收 |
| DYN-05 读取 Static 上下文 | ❌ | 只有 `Example requirements (mock)`，[routes.ts:36](../../sidecar/src/dynamic/routes.ts:36) 默认使用 stub |
| DYN-06 Mission 修订与历史 | 🟡 | 能新建修订；**不能删除、归档或重命名** saved test（API 没有对应操作） |
| DYN-07 策略控制的操作 | 🟡 | 策略有效，但默认零授权，非技术用户无法跑通测试（G-D2） |
| DYN-08 ~ 10 测试类型、verdict、恢复 | ✅ | M4 已验收 |
| DYN-11 可用性评估 | ✅ | M5 已验收 |
| DYN-12 Findings | 🟡 | 需要手动点击 “Record … candidates”，Run 失败后不会自动生成候选 finding |
| DYN-13 Requirement → 测试覆盖 | 🟡 | 只能针对 mock 或手写 criteria 计算覆盖；无法对真实 requirement 计算 |
| DYN-14 报告 | 🟡 | Dynamic 自己的报告可用；**项目统一报告仍读取旧的 `dynamic_sessions`**（[supabaseSnapshot.ts:341](../../sidecar/src/report/supabaseSnapshot.ts:341)） |
| DYN-15 成员共享 | 🟡 | 后端 RLS 和两用户隔离已验收；但 UI 无法管理成员（G-X3） |
| DYN-16 API 与 Codex 两种模式 | 🟡 | Codex 已 live 验收；API provider 的 live 验收被用户延后 |
| DYN-17 单元测试 | ✅ | Vitest 适配器已验收 |
| DYN-18 原生桌面（扩展） | — | 可选，未排期 |

### 2.3 共享平台（SHR）

| ID | 状态 | 说明 |
|---|---|---|
| SHR-01 认证 | 🟡 | 能登录；**没有 Sign up、Forgot password、修改密码**；登录兜底错误里出现 “Supabase” 字样 |
| SHR-02 成员授权 | 🟡 | RLS 有效；成员只能通过 GitHub collaborator 同步加入（`replace_github_project_collaborators`），邮箱用户无法被邀请或移除 |
| SHR-03 跨模块稳定 ID | ❌ | Review 快照 ID 没有传给 Dynamic（同 STA-08） |
| SHR-04 ~ 06 凭据、审计、用量 | ✅ | 有大量专项文档和测试 |
| SHR-07 Findings 词汇 | 🟡 | Severity / Priority 大小写不一致；Dynamic findings 不进入项目 Assessment，而且页面上没有说明这一点 |
| SHR-08 报告与证据包 | 🟡 | 同 DYN-14 |

### 2.4 §13.2 必选验收场景

| # | 场景 | 状态 | 阻塞原因 |
|---|---|---|---|
| 1 | 导入 → Review → 证据 + traceability → 决定 | 🟡 | Traceability 为空（G-S1） |
| 2 | 更新 source 后显示远端版本 / 时效，旧快照不变 | 🟡 | 时效确认和 deprecated 没有 UI（G-S7） |
| 3 | 新共享项目跑 Dynamic | ✅ | |
| 4 | 选择 Static requirement → mission → 执行 | ❌ | G-X1 |
| 5 | 区分正常路径、缺陷、provider 故障、目标不可达 | ✅ | M4/M7 有记录 |
| 6 | 探索式测试披露未覆盖范围 | ✅ | |
| 7 | 修复后重跑并保留历史 | ✅ | |
| 8 | 取消与中断恢复 | ✅ | |
| 9 | 测试数据准备、清理与冲突 | ✅ | |
| 10 | 可用性观察 | ✅ | |
| 11 | 单元测试通过、失败、配置错误 | ✅ | |
| 12 | API 与 Codex 两种模式 | 🟡 | API live 验收被延后 |
| 13 | 报告导出、第二成员可读、非成员和被撤销成员不可读 | 🟡 | 后端已证明；UI 无法加入或撤销成员，统一报告的 Dynamic 部分读旧数据 |
| 14 | 检查 secret 泄漏与授权 | ✅ | 有专项记录；之前报告的 500 / 403 问题在本次未复现（见第五节） |

---

## 三、缺失清单（全部已在 `52e5169` 上重新确认）

“来源”一栏：`10-28` / `10-30` 表示该问题出自哪份已有评审，并已重新确认仍然存在；`新` 表示本次新发现。

### P0：阻断主流程或 PRD 验收

| 编号 | 问题 | 证据 | 来源 |
|---|---|---|---|
| G-S1 | 没有入口确认 requirements，Traceability 永远为空 | `RequirementsScreen` 只在 [App.tsx:353](../../centinel/src/App.tsx:353) 渲染，全应用没有任何 `navigate({name:'requirements'})` | 10-30 |
| G-S2 | 已批准的 Review 在 Project / Home 显示为 Need Approval 或 Failed | [reviewViewModel.ts:141](../../centinel/src/reviewViewModel.ts:141) 只认 `currentDecision`，没有映射 `approved / completed / changes_requested / pending_approval / prepared`；[useProjectSummaries.ts:96](../../centinel/src/hooks/useProjectSummaries.ts:96) 的 `getStaticAction` 不考虑 retry 链 | 10-30 |
| G-S3 | Review 启动前不检查 provider；失败后没有指向 Settings 的出口；Home 误报 “Complete provider setup” | `ReviewEntryScreen` 中没有 provider 检查；[DashboardScreen.tsx:77](../../centinel/src/screens/DashboardScreen.tsx:77) 只认 `hasApiKey`，Codex 用户也会被提示 | 10-28 / 10-30 |
| G-X1 | Static → Dynamic 没有桥接：Dynamic 只能用 mock 上下文，Review 不能导出快照 | [DynamicWorkspaceScreen.tsx:161](../../centinel/src/screens/DynamicWorkspaceScreen.tsx:161) 中的 “Example requirements (mock)”；`incomingContextSource` 没有真实实现 | 10-28 / 新（确认 sidecar 侧同样缺失） |
| G-D2 | Dynamic 默认零交互权限，新用户的第一个测试必定 Blocked | [actionPolicy.ts](../../sidecar/src/dynamic/browser/actionPolicy.ts) 中 `normalizeActionPolicy(undefined)` 返回 `interactions: []` | 10-28 |
| G-X3 | 无法邀请或移除项目成员（邮箱用户） | 成员只能来自 GitHub collaborator 同步；前端没有成员管理 UI；sidecar 没有 `/members` 路由 | 新 |

### P1：严重影响可信度或可用性

| 编号 | 问题 | 来源 |
|---|---|---|
| G-S4 | Approve 没有任何拦截：存在 Critical blocker 时仍可一键批准，与 Help 页的说法矛盾（[ReviewActivityScreen.tsx:607](../../centinel/src/screens/ReviewActivityScreen.tsx:607)） | 10-30 |
| G-S5 | 确定性规则和模型对同一行代码重复报告；父 Review 和 retry 在项目层面重复计数 | 10-30 |
| G-S6 | Readiness 把无关文档当成 Coding standards 并评为 Completed；旧的失败原因一直显示；criteria 没有可展开的理由 | 10-30 |
| G-S7 | 文档时效确认、deprecated 标记、90 天提醒没有可操作的 UI（STA-06） | 新 |
| G-S8 | 没有单个 Review 的报告导出（STA-08） | 新 |
| G-S9 | 没有 Review 列表页；“Open project sources” 会丢失已填写的草稿 | 10-30 |
| G-S10 | finding 位置显示内部存储路径 `uploads/<uuid>-file`；Queued 状态显示的是旧数据文案（[ReviewNarrative.tsx:26](../../centinel/src/components/ReviewNarrative.tsx:26)） | 10-30 |
| G-D1 | 项目统一报告的 Dynamic 部分仍读取旧 `dynamic_sessions` / `dynamic_evidence` | 10-28 |
| G-D3 | Saved test 不能删除、归档或重命名；Run 历史没有筛选和分页 | 10-28 |
| G-D4 | 运行中不显示步数和最新截图，却用大字显示 “Not tested” | 10-28 |
| G-D5 | Run 结果页有 15 个折叠区块，失败的 check 排在第 12 位；默认可见区域里有 CSS selector 等术语 | 10-28 |
| G-D6 | Run 失败后不会自动记录候选 finding | 10-28 |
| G-X2 | 没有路由和历史：刷新后回到 Home，Run 无法分享链接（[App.tsx:61](../../centinel/src/App.tsx:61)） | 10-28 |
| G-X5 | 没有 Sign up、Forgot password、修改密码 | 10-28 |
| G-X6 | 孤儿页面 `evidence-browser`；Playground 在一级导航中，与 DESIGN.md 冲突（[AppShell.tsx:232](../../centinel/src/components/AppShell.tsx:232)） | 10-28 |
| G-X7 | Dynamic findings 不进入项目 Assessment，页面上也没有说明（PRD §8 规定先保持分开，但必须让用户看得出来） | 10-28 |

### P2：体验与工程卫生

- Help 页只覆盖 Review；Need attention 噪音大，没有优先级。
- Severity / Priority 大小写不一致；toast 遮住面包屑；新上传文件显示 “Updated time unavailable”。
- 1200 px 下 Recommendations 的轮播按钮被裁掉；Dashboard 没有 `<h1>`。
- `DynamicWorkspaceScreen.tsx` 和 `DynamicEnvironmentPanel.tsx` 是压缩风格代码（单行最长 2141 字符）；前端直接 import sidecar 源码。
- 仓库中验收 JSON 体积很大（单个文件最多 3.6 万行）。#44 已清理调试预览文件，但这些 JSON 还在。
- 前端 bundle 1.17 MB，没有 code splitting；多个轮询没有在页面隐藏时暂停。

---

## 四、修复计划

原则：**先修主流程的正确性，再接通模块，最后改体验**。每一步都要补测试，UI 改动按 AGENTS.md 要求 build，并在 1440 / 1200 / 窄屏三种宽度下检查。负责人按 PRD §3 的分工：CS = Static，JY = Dynamic，共享部分由两人协调。

### 阶段 1：主流程正确性（约 2–3 天，可并行）

| 任务 | 负责 | 做法 | 完成标准 |
|---|---|---|---|
| 1.1 修 G-S2 状态映射 | CS | 在 `projectActivityLifecycle` 中映射新的 status；`getStaticAction` 中，父 Review 被同一 retry 链上更新的 attempt 覆盖；Assessment 读取已批准的 snapshot | 新增单元测试：approved / retry 链在 Review 详情页、Project、Home 显示同一状态 |
| 1.2 修 G-S3 provider 预检 | CS | Review entry 提交前调用现有的 workflow provider 状态接口；失败时显示 “Open Settings” 按钮；Dashboard 改用 workflow provider 状态（Codex 也算已配置） | 未配置时 Start 不可点并说明原因；配置了 Codex 后 Home 不再提示 |
| 1.3 修 G-S1 requirements 入口 | CS | 在 Project 中加 “Requirements” tab 或入口，挂上现有的 `RequirementsScreen`；从被识别为 requirement 的文档中列出候选项，支持一键确认 | 上传 `REQUIREMENTS.md` → 确认 → 新建 Review → Traceability 不为空 |

### 阶段 2：接通 Static → Dynamic（约 4–6 天，核心 PRD 缺口）

| 任务 | 负责 | 做法 | 完成标准 |
|---|---|---|---|
| 2.1 Review 快照导出契约 | CS | 新增经过认证的接口，返回 PRD §10.1 定义的字段（projectId、reviewId、iteration、批准状态、requirement 和 criteria、source 版本与时效、相关 findings）；只读，只读取冻结数据 | 契约测试：跨项目请求被拒；未批准的快照会被标注为未批准 |
| 2.2 Dynamic 实现 `incomingContextSource` | JY | 用 2.1 的接口替换 stub；“Criteria source” 改为 “From a Review”，可选择 Review 和 requirements；mock 选项只在开发模式下显示 | 验收场景 4 跑通：选择 requirement → 保存 mission → 运行 → 覆盖率按真实 requirement 计算 |
| 2.3 Finding → Dynamic 验证 | CS + JY | 在 Finding 详情的 “How to verify resolution” 处加 “Verify with Dynamic Testing”，预填目标和 check | 从 finding 一键生成 mission 草稿 |
| 2.4 统一报告读取新 Run（G-D1） | JY | `supabaseSnapshot.ts` 改为读取 Mission/Run；旧 sessions 作为 legacy 只读合并 | 报告中的 Dynamic 部分与 Dynamic 页面一致 |

### 阶段 3：协作与账户（约 3–4 天）

| 任务 | 负责 | 做法 | 完成标准 |
|---|---|---|---|
| 3.1 成员管理（G-X3） | 共享 | 新增 owner 专用的 RPC 和路由：按邮箱邀请或添加成员、移除成员（增量 migration，不重置数据）；在 Project 页加 Members 区块 | 验收场景 13 可以完全在 UI 中完成 |
| 3.2 注册与重置密码（G-X5） | 共享 | 使用 Supabase Auth 自带的 signUp / resetPasswordForEmail；Profile 页加修改密码；兜底错误文案去掉实现细节 | 新邮箱用户可以自助注册和找回密码 |
| 3.3 文档时效 UI（G-S7） | CS | 在 Source 行加 “Confirm current” 和 “Mark deprecated”，显示距上次确认的天数（默认 90 天） | 验收场景 2 跑通 |
| 3.4 单个 Review 的报告（G-S8） | CS | 复用 `reportExport` 生成单个 Review 的报告，包含 manifest、traceability、决定历史 | 可下载，且包含 PRD §11.3 规定的字段 |

### 阶段 4：可信度（约 3–4 天）

- 4.1（CS）Approve 拦截（G-S4）：存在 verified Critical/High 时要求填写理由并二次确认。
- 4.2（CS）合并规则与模型的重复 finding；项目层面按相关 finding 去重计数（G-S5）。
- 4.3（CS）Readiness：不相关的文档不能把某个类别评为 Completed；配置变化后清除旧的失败原因；criteria 可以展开查看理由（G-S6）。
- 4.4（JY）Dynamic 默认权限（G-D2）：提供 “允许在目标 origin 内点击和输入” 的低风险默认授权，或者在 Run 被拦截后提供 “批准这个操作” 的向导。前提是保持策略在代码层强制执行。
- 4.5（JY）Run 失败后自动记录候选 finding，仍然标为 candidate（G-D6）。
- 4.6（共享）在 Assessment 页说明 Dynamic findings 暂不计入项目风险（G-X7）。

### 阶段 5：体验与导航（约 4–5 天）

- 5.1 hash 路由与历史（G-X2）：刷新后保持当前页面，Run 和 Review 可以分享链接。
- 5.2 Review 列表页；Review 草稿不因跳转而丢失（G-S9）；显示原始文件名而不是存储路径；修正 Queued 状态文案（G-S10）。
- 5.3 Dynamic：重排 Run 结果页的信息层级、运行中显示步数和截图、saved test 的删除和归档、Run 历史筛选（G-D3 ~ D5）。
- 5.4 导航整理：Playground 移到 Settings 或开发模式下；为 `evidence-browser` 加入口，或者删除它（G-X6）。
- 5.5 Help 页补充 Dynamic、Projects、Settings 的说明；Need attention 加优先级排序。

### 阶段 6：工程卫生与发布验收（约 2–3 天）

- 拆开 `DynamicWorkspaceScreen.tsx` 和 `DynamicEnvironmentPanel.tsx`，去掉前端对 sidecar 源码的 import（改用共享的 types 包）。
- 把大型验收 JSON 移到 release artifact 或 Git LFS（需要团队决定；不会删除历史证据）。
- code splitting，以及页面隐藏时暂停轮询。
- 重新按 §13.2 的 14 个场景完整走一遍；API provider 的 live 验收等配置好 key 后补做。

**建议顺序**：阶段 1 → 阶段 2 → 阶段 3，这三个阶段决定 PRD 验收能否通过；阶段 4、5 可以穿插进行；阶段 6 放在最后。按两人并行估算，总计约 3–4 周。

---

## 五、本次检查结果

在主 checkout 运行（`pnpm install --frozen-lockfile` 之后；之前本机 `node_modules` 过期，缺少 `@supabase/supabase-js`、`pdfkit` 等依赖，导致 42 个测试文件无法加载）：

| 检查 | 结果 |
|---|---|
| 前端 `tsc --noEmit` | 通过 |
| Sidecar `tsc --noEmit` | 通过 |
| `pnpm --filter centinel test` | **73 个文件 / 520 个测试全部通过** |
| `pnpm --filter @centinel/sidecar test` | **152 个文件 / 1516 个测试通过，1 个 skipped** |

10-28 和 10-30 评审中提到的 `activeHttpAuth.test.ts`（500 / 403）和 `dynamicHooks.test.ts` 失败，本次都没有复现。它们很可能来自 worktree 中缺少 `.env` 或机器负载过高，因此不列为代码缺口。

**注意**：测试全部通过，并不代表上面的缺口不存在。这些缺口大多是“功能没有做”或“跨模块没有接通”，现有测试本来就没有覆盖。修复时需要补上相应的跨模块测试。

## 六、未覆盖

- 浏览器实测、Tauri 打包产物、GitHub / Drive / Slack 的 OAuth 实际连接。
- 付费的模型或 embedding 调用（Review 和 Readiness 的语义质量沿用 10-30 评审的实测结论）。
- 10-30 评审中的 P2 视觉问题只做了抽查，没有逐条复核。

---

## 七、执行结果（2026-10-30，同日完成）

| 编号 | 状态 | 做法 |
|---|---|---|
| G-S1 requirements 入口 | ✅ 已修 | Source 页 “Manage requirements”；Review entry 中 requirements 为空时提供入口 |
| G-S2 状态不一致 | ✅ 已修，浏览器实测 | 共享 mapper 识别 `approved` 等新 status；retry/iteration 覆盖父 Review；summary 接口补上 lineage |
| G-S3 provider 预检 | ✅ 已修，浏览器实测 | Review entry 检查模型和 Codex 连接状态，失败页提供 “Open Settings”；Home 不再误报 |
| G-X1 Static → Dynamic | ✅ 已修，浏览器实测 | 新接口 `/static-sessions/:id/dynamic-context`（只读取冻结数据，服务端重建防伪造）；Dynamic 新增 “Requirements from a Review”；finding 和 Review 页提供 “Verify / Test in Dynamic Testing”；migration `202610300001` 已应用 |
| G-D2 默认零权限 | ✅ 已缓解，浏览器实测 | 环境权限新增只读的 “Find controls”，一键批准页面控件；策略仍在代码层强制执行 |
| G-X3 成员管理 | ✅ 已修，浏览器实测 | Members 页按邮箱添加或移除；migration `202610300002` 已应用，并在本地 Postgres 验证了越权拒绝和撤销效果 |
| G-S4 Approve 拦截 | ✅ 已修 | 存在 blocker 时必须写理由并勾选确认 |
| G-S5 重复 finding | ✅ 展示层已修 | 规则引擎的问题如果与模型问题位于同一位置，会合并展示；存储、风险计算和 resolution proof 不变 |
| G-S6 Readiness 误判 | ❌ 未修 | 按文件类型限制会违反“按内容分类”的契约（测试 A2）；需要改 prompt 并做付费评测 |
| G-S7 文档时效 | ✅ 已修 | Confirm still current / Mark deprecated / Restore，90 天提醒；deprecated 文档不进入新 Review |
| G-S8 单个 Review 报告 | ✅ 已修，浏览器实测 | Review 页 “Export report”；报告显示邮箱而不是 UUID |
| G-S9 Review 列表与草稿 | ✅ 已修 | Review entry 显示 Recent Reviews；草稿保存在 session 中 |
| G-S10 路径和 Queued 文案 | ✅ 已修 | 显示原始文件名；Queued 状态使用正确文案 |
| G-D1 报告读旧数据 | ✅ 已修 | 项目报告读取共享 Run，去掉重复的旧镜像 |
| G-D3 删除 saved test | ❌ 未做 | 需要新增 API 和 migration |
| G-D4 运行中显示 | ✅ 已修 | 显示 “Running · up to N steps” |
| G-D5 结果页重排 | ❌ 未做 | 改动面大，留待后续 |
| G-D6 自动记录候选 finding | ✅ 已修 | 幂等，仍需人工确认 |
| G-X2 路由 | ✅ 已修，浏览器实测 | `#/` hash 路由，支持刷新和 Back/Forward；不影响 OAuth 回调的 hash |
| G-X5 注册和重置密码 | ✅ 已修，浏览器实测（界面） | 注册、忘记密码、Profile 修改密码；没有真的发送邮件 |
| G-X6 导航 | ✅ 部分 | Playground 只在开发模式下显示；`evidence-browser` 仍然没有入口 |
| G-X7 Assessment 说明 | ✅ 已修 | |
| Help | ✅ 已修 | 补充了 requirements、Dynamic、共享和模型设置 |

演示流程见 [PRESENTATION_DEMO_FLOW_2026-10-30.md](PRESENTATION_DEMO_FLOW_2026-10-30.md)。
