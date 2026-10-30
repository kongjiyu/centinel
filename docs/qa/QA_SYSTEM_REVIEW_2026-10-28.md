# Centinel 系统 QA 锐评（排除 Static/Review 模块）

- 日期：2026-10-28 · 分支 `claude/system-review-qa-46bd35` @ `476a506`
- 范围：Shell / 导航、Auth、Dashboard、Projects、Project Detail（非 Review 部分）、Dynamic Testing 全链路、Settings / Profile、统一报告、测试与构建
- 方法：代码走查 + 浏览器实测（2026-10-29 用测试账号登录后，完整走了一遍 Home → Projects → Project → Dynamic Testing（新建 Environment、保存测试、跑 Run、看证据）→ Settings → Profile）+ 跑测试和构建
- 视角：以 `DESIGN.md` 定义的主要用户（“office teams and non-technical reviewers”）以及一个专业 QA 用户为准

---

## 总评

| 维度 | 评分 | 一句话 |
|---|---|---|
| UI 视觉 | 7/10 | Shell、Dashboard、Auth 干净统一；一进 Dynamic Testing 就变成工程控制台 |
| System flow | 3/10 | 实测：Dynamic 结果在 Home 和 Project 里要么缺失，要么状态和 Dynamic 页面对不上 |
| 完整性 | 5/10 | 后端能力很多，但 CRUD 不全、有孤儿页面、有 mock 数据进生产 |
| 流畅性 | 5/10 | 同一个动作有三种入口逻辑；没有路由历史；结果页是一长串折叠面板 |
| 易用性 | 3/10 | 默认配置下 AI 浏览器什么都点不了；术语密度远超目标用户 |
| 工程质量信号 | 6/10 | 前端 348 个测试全过、build 通过；Sidecar 有 1–2 个测试红；Dynamic 代码几乎不可读 |

**一句话结论**：Centinel 像两个产品被硬拼在一起。外壳（Home / Projects / Settings）是给办公室用户的平静工作台；Dynamic Testing 是给安全工程师用的策略控制台。两者在数据上也没有接通。

---

## P0：阻断性问题（演示/交付前必须修）

### P0-1 Home、Projects、Project Overview 读的是“本机旧镜像”，Dynamic 结果缺失且状态错误（已实测）
- 证据：
  - Dynamic Testing 页面读写的是共享的 Mission/Run（Supabase）：`api.dynamicRuns` → `/projects/:id/dynamic/runs`。
  - Dashboard、Projects、Project Overview 读的是旧模型：`api.listDynamicSessions` → `/dynamic-sessions`（[useProjectSummaries.ts:314](../../centinel/src/hooks/useProjectSummaries.ts:314)、[ProjectDetailScreen.tsx:154](../../centinel/src/screens/ProjectDetailScreen.tsx:154)）。
  - 每次执行 Run 时，runner bridge 会在**本机 sql.js** 里另建一条旧 session 作为镜像（[runnerBridge.ts:37](../../sidecar/src/dynamic/runnerBridge.ts:37)）。标题是 `"Journey: " + goal.slice(0, 50)`（[dynamicSessions.ts](../../sidecar/src/dynamicSessions.ts)），状态由 agent 循环决定，而不是由独立检查的 verdict 决定。
  - 统一项目报告同样读旧的 `dynamic_sessions` / `dynamic_evidence`（[report/supabaseSnapshot.ts:220](../../sidecar/src/report/supabaseSnapshot.ts:220)）。
- 实测结果（测试账号，项目 Memos Web Testing）：
  1. **共享 Run 看不到**：项目里已有 7 个 Run（3 个 Needs attention），但 Home 显示 “Recent projects: No review or dynamic testing activity yet”，Project 显示 “No activity yet”。原因是这些 Run 在另一个 sidecar 或设备上执行，本机没有它们的镜像。协作者在其他电脑上永远看不到你的 Run。
  2. **同一个 Run，三个状态**：我 12:14 跑的 Run，在 Dynamic Testing 里是 **Completed / Passed**，在 Project Recent activity 里是 **Completed**，在 Home Recent projects 里是 **Blocked**。12:11 被拦截的 Run，在 Dynamic 页面是 “Needs attention / Not tested”，在 Project 页面是 “Failed”。
  3. **preflight 失败的 Run 完全不出现在活动列表里**（12:13 那次）。
  4. **标题是 goal 的前 50 个字符，不是测试名**。我的 goal 里写了 demo 登录信息，于是 Home 上直接显示 “Journey: First log in with username 'demo' and password 'de…”，在单词中间截断，还把 goal 里的敏感信息搬上了首页。
  5. **从活动进入的是旧页面**：两张截图都显示 “Screenshot unavailable”（新 Run 页面能正常显示同一张截图），Action trace 直接把本机绝对路径 `/Users/kongjy/.../logs/action-trace.json` 当作内容展示给用户。
- 测试盲区：前端 348 个测试全过，但没有任何测试覆盖“跑一个 Run → Home 和 Project 显示同样的状态”这条跨模块路径。
- **修复状态（2026-10-29，未提交）**：Home、Projects、Project Overview 已改为读取共享 Run（[dynamic/runActivity.ts](../../centinel/src/dynamic/runActivity.ts)）。
  - 状态按 Run 的 state 和 verdict 计算，名称使用 saved test 的名称。
  - 已被某个 Run 镜像的本机旧 session 会被去重。
  - 同一个 saved test 的较新 Run 会覆盖旧结果，不再重复要求处理。
  - 点击 Dynamic 活动会进入 Run 结果页。
  - blocked 或 inconclusive 的 Dynamic 统一显示为 “Needs attention”。
  - 已补单元测试和跨模块测试，并在浏览器中实测通过。
  - **仍未修**：统一项目报告（`report/supabaseSnapshot.ts`）还在读旧的 `dynamic_sessions`。

### P0-2 默认配置下，AI 浏览器 agent 不能点击、不能输入
- 证据：`normalizeActionPolicy(undefined)` 返回 `interactions: []`（[actionPolicy.ts:16](../../sidecar/src/dynamic/browser/actionPolicy.ts:16)）；之后每个 click / fill 动作都要匹配一个预先批准、且在页面上唯一的 CSS selector，否则抛出 `BrowserPolicyBlocked`（[actionPolicy.ts:69](../../sidecar/src/dynamic/browser/actionPolicy.ts:69)）。每个 Environment 最多 20 个 selector。
- Run environment 下拉框的默认值是 “Use test address (no saved environment)”，也就是零授权。
- 用户体验：新用户写好 “登录然后检查 Dashboard 标题”，点 Run，得到 Needs attention / Blocked。要让它工作，必须先展开 “Manage environments and local values”，新建 Environment，再按动作类型逐行手写 `input[name="username"]` 这类 selector。这对 `DESIGN.md` 定义的非技术用户是不可能完成的任务，也直接抵消了 “AI 驱动浏览器” 的核心卖点。
- **实测复现**：我用默认环境新建了测试 “Add a todo 'Buy milk'”（目标是 demo app `localhost:37702`），结果是 Needs attention / Not tested，原因原文：*“Cannot add or confirm 'Buy milk': no interactions are approved, and the page shows only a login form.”* 模型本身工作正常，是默认策略把它挡住了。而且独立检查器也没有运行（“No observation recorded”），本来至少应该给出一个 Failed。
- **项目里已有的 3 个失败 Run，全部是工具自身造成的，不是被测应用的 bug**：(a) “This control/action is not approved in the frozen environment”；(b) agent 在它看到的页面信息里找不到编辑器元素（“no elementRef for the note editor or Save button”）；(c) Memos 后台对 `nominatim.openstreetmap.org` 的一个请求被 origin 白名单拦截，整个 Run 因此终止。三者在 UI 上都只显示 “Not tested / Needs attention”，用户分不清是产品有 bug 还是工具受限。
- **跑通一次真实测试，需要越过三道门**（全部实测）：
  1. Environment 表单有 25 个字段（执行时长、模型调用次数、页面观察字符数、console 字节数、token 停止上限，以及按 click / fill / select / checkbox 分开的 selector 列表），其中权限列表还藏在折叠区里。
  2. 保存失败时，提示只有一句笼统的 “Environment needs a name, HTTP website, valid origins, viewport and variable names.”，不指出是哪个字段出错（我这次是 URL 里带了 `#`）。
  3. 保存后第一次 Run 直接失败：“Environment preflight failed”，要展开 Recorded environment 才看到原因是 “Test data: Needs attention — Prepare test data and record its initial state”。必须在 Environment 面板手动填写备注并点 “Record preparation”，这个操作只是记录人工声明，Centinel 不做任何验证。
  - 越过三道门之后，同一个测试约 60 秒内 **Passed**，截图证据清晰，还自动遮挡了顶部区域。说明核心引擎能用，问题全在默认值和上手路径。
- 建议：安全设计本身没错，但默认值应该是 “本 origin 内的普通控件允许、危险动作（上传、下载、提交支付）需要批准”；或者提供 “先 Explore 一次 → 列出观察到的控件 → 一键批准” 的向导，而不是让用户手写 selector。

### P0-3 Mock 数据出现在生产表单里
- “Criteria source” 只有两个选项：“Write my own criteria” 和 **“Example requirements (mock)”**。后者默认来自 `createStaticContextStub`（[DynamicWorkspaceScreen.tsx:36](../../centinel/src/screens/DynamicWorkspaceScreen.tsx:36)）。
- 这意味着 Dynamic Testing 没有接上项目里真实的 Requirements 或 Review findings。PRD 里 “Static 发现问题 → Dynamic 验证” 这座桥实际不存在，用户还会直接看到 “mock” 这个词。

---

## P1：严重问题（明显伤害流程和信任）

### 导航与 Flow
1. **没有路由和历史。** 页面状态只是 `useState<Screen>`（[App.tsx](../../centinel/src/App.tsx)），没有 Back/Forward，刷新或 Tauri reload 后一律回到 Home，Run 链接也不能分享。对一个 QA 工具来说，“把这个 Run 链接发给开发” 是基本需求。
2. **“开始 Dynamic Testing” 有三种行为：**
   - 侧边栏（没有项目上下文时）：弹出 “Choose a project” 模态框 → Continue → 进入 Dynamic 页面，页面顶部**又有一个** Project 下拉框（重复选择）。
   - Dashboard 的 Quick action 或 Recommendation：静默选中 “最近更新的项目”，用户不知道选的是哪个。
   - 模态框里的 `static` 分支已经是死代码（static 直接跳转了）。
3. **孤儿页面**：`evidence-browser` 和 `requirements` 两个路由已经实现、也有测试，但整个应用里没有任何入口能跳到它们（只在 `types.ts`、`App.tsx`、面包屑里出现）。要么接入，要么删除。
4. **开发者工具 “Playground” 出现在一级导航**，和 `DESIGN.md` 规定的导航 “Home, Projects, Review, Dynamic Testing, Settings” 冲突。侧边栏分组也和规范不一致（规范是 Dashboard 组只有 Home）。
5. **项目被删除或拿不到时页面是空白**：`screen.name === 'project-detail' && currentProject && ...`，`currentProject` 为空时什么都不渲染，也没有 “Project not found” 提示。

### Dynamic Testing 页面
6. **结果页是一面 “details 墙”。** 选中一个 Run 后依次出现：verdict、Coverage、Usability、Recorded browser permissions、Regression、Findings、Retest、Exploration、Recorded execution limits、Downloaded files、Recorded environment、检查结果表、Evidence、Reports、Run details，共 15 个区块。最重要的 “哪些 check 失败、截图在哪” 排在第 12 和第 13 位。应该按 “结论 → 失败的 check 和对应截图 → 下一步动作 → 技术细节” 重排。
7. **术语密度与目标用户严重不符**，截取几条 UI 原文：
   - “Ordinary grants do not approve file controls, downloads or implicit keyboard submissions.”
   - “Accounted-token stop limit … this is not a billing cap.”
   - “Native field validity”、“Downloaded file fingerprint (SHA-256)”、“Signed-in readiness selector”、“Shared test-data resource”、“Session reference”
   - 这些都应该收进 “Advanced” 或换成人话。现在默认可见区域里就有 CSS selector 输入框。
8. **运行中没有过程反馈**：只显示 “In progress”，靠每 5 秒轮询刷新，看不到当前步骤、最新截图、已用步数和步数上限。用户不知道它是在跑还是卡住了。
9. **CRUD 不完整**：Saved tests 不能删除、归档或重命名（API 里没有 delete mission）；Run history 没有筛选、搜索、分页，列表会无限变长。
10. **Findings 需要手动 “collect”**：Run 失败后不会自动生成候选 finding，必须进入面板点 collect。用户很容易以为 “失败了但没有 finding”。
11. **Dynamic findings 不进入 Project Findings / Assessment**：`DESIGN.md` 明确写了 Dynamic “remains a separate evidence area”。这是有意的设计决定，但从用户角度看就是 “项目风险评估不包含实际运行中失败的东西”，至少要在 Assessment 页面明说。
12. **用 `ref` 存 dirty 状态**：“Run saved test” 按钮的 disabled 依赖 `dirty.current`（ref 变化不会触发重渲染），目前靠其他 setState 顺带刷新，属于脆弱逻辑，容易出现按钮状态不同步。

### Auth / 账户
13. 登录页没有 **Sign up** 和 **Forgot password**。邮箱用户首次使用和忘记密码时都没有出路。
14. 兜底错误文案 “Check your Supabase credentials.”（[AuthScreen.tsx:61](../../centinel/src/screens/AuthScreen.tsx:61)）把实现细节暴露给最终用户。
15. Profile 页只有 email 和 provider，没有退出所有设备、删除账户、数据导出等账户基本操作。

---

### 实测新增（2026-10-29 登录后）
16. **运行中显示 “Not tested” 大字**：Run 进行中，结果区已经用最显眼的字号显示 verdict “Not tested”，看起来像已经失败。应该显示 “Running · step x/15”。
17. **Check 没有名称字段**：结果表里的检查项名称就是字段标签 “Expected visible text”，有多个 check 时无法区分。
18. **Saved tests 有重名，且无法删除**：项目里有 “Memos create” ×3、“Memos read” ×2，列表里只能靠 revision 和 check 数区分，也没有删除或重命名入口。
19. **Home 误报 “Complete provider setup”**：Settings 显示 Model Provider “Codex with ChatGPT · Connected · Dynamic: Codex · gpt-6.1-sol”，但 Home 的第一条推荐仍然是 “Complete provider setup”。原因是 Dashboard 只认 `text` / `vision` 设置里的 `hasApiKey`（[DashboardScreen.tsx:76-78](../../centinel/src/screens/DashboardScreen.tsx:76)），Codex 是免 API key 登录。
20. **1200 px 宽度下 Recommendations 轮播按钮被裁掉**：按钮位于 x 1140–1224，而卡片右边界是 x 1153，下一条 / 上一条无法点击。1440 px 正常。
21. **报告快照的 Actor 显示原始 UUID**（`ff70beb1-198d-…`），而不是用户邮箱或姓名。
22. **Profile 页没有修改密码**：对邮箱密码账号也没有，只能看到 “Signed in with Email and password”。
23. **保存测试后页面跳回顶部**：“Saved revision 2. Ready to run.” 的反馈和 “Run saved test” 按钮都在页面下方，用户需要自己滚回去。
24. **768 px 宽度**：没有横向溢出；但侧边栏不会自动收起，占了约三分之一宽度，“Saved tests & runs” 被推到页面约 1676 px 的位置，在长表单之后。
25. **证据默认只存在本机**：要点 “Sync independent evidence” 才会共享给项目成员，共享副本 7 天后过期。这个默认行为对团队协作不友好，而且只在折叠区里提示。

## P2：体验瑕疵

- Dashboard 首次使用时，“Create your first project” 跳到 Projects 列表，还要再点一次 New；而 Quick action 的 “Create project” 会直接打开模态框。同类入口行为不一致。
- Recommendations 用轮播（1 of 4）。其中 “Review current sources” 和 “Verify a live workflow” 是无条件显示的固定文案，不是真正基于状态的推荐，降低了这个区块的可信度。
- Dashboard 没有 `<h1>`，页面标题层级缺失（a11y）。
- 时间格式不统一：Dynamic 用 `toLocaleString()`，其他页面用 `formatActivityTime`。
- 浏览器预览的标题栏有 File / Edit / View / Help 假菜单，和 Tauri 原生菜单重复，开发态会误导 QA 截图。
- 后台轮询叠加：Dynamic workspace 每 5 秒、Environment data 每 5 秒、Project detail 活跃轮询、GitHub reconciliation、Slack 每 60 秒。没有可见性暂停（`document.hidden`）或退避。
- 前端单个 JS bundle 1.17 MB，没有做 code splitting。桌面端可以接受，但首屏加载能感觉到。
- Auth 校验错误显示在表单顶部，而不是对应字段旁边。

---

## 工程质量信号（影响长期 “流畅性”）

- **Dynamic 前端代码几乎不可维护**：[DynamicWorkspaceScreen.tsx](../../centinel/src/screens/DynamicWorkspaceScreen.tsx) 只有 217 行但有 36 KB，最长一行 2141 个字符；[DynamicEnvironmentPanel.tsx](../../centinel/src/screens/DynamicEnvironmentPanel.tsx) 是同样的压缩风格。和 Shell、Dashboard 的代码风格截然不同，任何 UI 调整都很高风险。
- **前端直接 import sidecar 源码**（`../../../sidecar/src/dynamic/...`），包括运行时函数 `validateIncomingContext` 和 `createStaticContextStub`，前后端边界被打穿。
- **测试结果**（本 worktree 实测）：
  - `pnpm --filter centinel test`：60 个文件 / 348 个测试**全部通过**
  - `pnpm --filter centinel build`：**通过**（有 chunk > 500 kB 警告）
  - `pnpm --filter @centinel/sidecar test`：**1 个失败 / 858 个通过**。单独运行时，以下两个测试**稳定失败**：
    - `activeHttpAuth.test.ts` “denies non-members before storage”：非成员访问 Dynamic 资源得到 **500**，而不是 403（访问仍被拒绝，但状态码不对；日志里有 `Supabase unavailable`，可能和本 worktree 没有 `.env` 有关，需要在主 checkout 复核）
    - `dynamicHooks.test.ts` “executes only an authorized script”：得到 `runner_error`，期望 `passed`
  - 全量运行和单独运行失败的测试集合不同，存在顺序或环境依赖（flaky）。

---

## 修复优先级建议

1. **统一 Dynamic 数据源**（P0-1）：让 `useProjectSummaries`、Project activity、统一报告改读 Mission/Run，并把旧 sessions 作为 legacy 只读合并显示；活动行跳转到 `dynamic-testing?runId=`。补一个跨模块集成测试。
2. **默认可用的 action policy 或批准向导**（P0-2）。
3. **把 Dynamic criteria 接到真实 Requirements / Review findings**，在生产环境隐藏 mock 选项（P0-3）。
4. **重排 Run 结果页的信息层级**，把技术细节收进一个 “Technical record” 区块；运行中显示步骤进度（P1-6/7/8）。
5. 引入轻量路由（hash 路由即可），统一 “选项目” 交互，处理孤儿页面和 Playground 的去留（P1-1~4）。
6. 补齐 Saved test 删除/归档、Sign up / Reset password（P1-9/13）。

## 实测环境与留下的数据（2026-10-29）

- 运行的是本 worktree 的代码（`476a506`）：sidecar 在 `localhost:37731`，前端在 `localhost:1421`，被测目标是 demo app（`localhost:37702`）。配置在 `.claude/launch.json`，该文件被 git 忽略。
- 登录：测试账号 `centinel.testing.20261022@example.com`，由用户本人在浏览器面板登录。
- 实测宽度：1440、1200、768。Auth 页另外测了 375。
- **在共享 Supabase 项目 “Memos Web Testing” 中留下的测试数据**（UI 无法删除，需要时请用管理工具清理）：
  - Saved test “Demo todo add (QA 20261029)”，revision 1 和 2
  - Environment “Demo app local” v1，并有一条人工 test-data preparation 记录
  - 3 个 Run：12:11 被权限拦截、12:13 preflight 失败、12:14 Passed
  - 本机 `data/` 目录下的旧 session 镜像和证据文件

## 本次未覆盖

- Review / Static 模块和 Playground（按要求排除）。
- Google Drive / GitHub / Slack 连接流程（需要外部 OAuth）。
- 统一项目报告导出、Tauri 打包产物、Memos 目标（它的 Docker 容器 `centinel-memos-20261022` 已不存在）。
