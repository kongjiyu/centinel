# Centinel 全系统 Flow 评审（含 Static / Review）

- 日期：2026-10-30
- 代码版本：已合并最新 `origin/main`（`6b6dcc3`，包含 Static 团队的 `ed89a10`、`b6c2891`、`6b6dcc3`）+ PR #43。本地 merge commit 为 `a28bb9e`，**尚未 push**。
- 方法：在本 worktree 实际运行 sidecar（37731）和前端（1421），用测试账号走完整条用户路径。同时读代码，定位每个问题的根因。
- 上一轮（不含 Static）的评审见 [QA_SYSTEM_REVIEW_2026-10-28.md](QA_SYSTEM_REVIEW_2026-10-28.md)。

---

## 一、实测路径（端到端）

| 步骤 | 实际操作 | 结果 |
|---|---|---|
| 1 | 侧边栏 Review → Start a Review | 项目没有 source，页面提示 “Open project sources” |
| 2 | 进入 Source → 上传 `REQUIREMENTS.md`（REQ-1…5）和 `todo-app.html`（demo app） | 上传成功，自动分类为 Requirements / Code ✅ |
| 3 | Action → Start Review，填写名称和目标，点 Start | **15 秒后失败**：“Model Provider unavailable; deterministic results retained.” ❌ |
| 4 | Settings → 为 Codex 选择模型 → Use for Review | Review 改为使用 Codex · gpt-6.1-sol |
| 5 | 回到 Review → Retry review → Retry saved sources | 生成子 Review `(Retry)`，**4 分 22 秒后进入 Need Approval**，共 7 个 finding ✅ |
| 6 | 查看 Overview / Findings / Finding 详情 / Traceability | 结论和证据质量很好；Traceability 为空 ❌ |
| 7 | Approve review | 详情页显示 Completed ✅；但项目页和 Home 显示的状态是错的 ❌ |
| 8 | Project → Assessment / Findings / Readiness Retry | Readiness 约 2 分钟完成，但 Coding standards 显示 “Completed”，是误判 ❌ |

**模型质量是亮点**：我在 demo 里埋的 3 个真实缺陷，模型全部准确找出：
- 硬编码登录凭据（REQ-2）→ Critical
- innerHTML XSS（REQ-3）
- todo 不持久化（REQ-4）

每个 finding 都有 “What to do / What is wrong / Where and why”，以及 100% 匹配的源码行。Overview 已经改成 “Changes needed + 三条下一步”，团队自己的 UX audit 里提出的问题，大部分已经落实。

---

## 二、总评

| 维度 | 评分 | 一句话 |
|---|---|---|
| Review 结果质量 | 8/10 | 发现准确，证据可核对，Overview 以行动为先 |
| Review 上手 flow | 4/10 | 没有 provider 预检；requirements 无法建立，导致 traceability 永远为空 |
| 跨模块一致性 | 3/10 | 同一个 Review 在详情页、项目页、Home 是三种状态 |
| Dynamic | 5/10 | P0-1 已修（PR #43）；P0-2（默认不能交互）和 P0-3（mock）仍在 |
| 仓库与工程卫生 | 4/10 | 一个 commit 加了 22 万行，大部分是验收 JSON；根目录有调试预览文件 |

**一句话结论**：Static 的“引擎和结果页”已经达到可演示的质量，但从“第一次进来”到“看到可信结果”的路上有 3 个断点；Review 和 Dynamic 之间仍然没有连接。

---

## 三、P0：阻断性问题

### P0-A 没有任何入口可以建立 “confirmed requirements”，Traceability 和需求检查永远为空
- **现象**：上传的 `REQUIREMENTS.md` 被识别为 “Attached requirement”，但 Review entry 的 Requirements 区显示 “No project requirements are available”。结果中：
  - Activity 显示 “I couldn’t confirm the business requirements, so that part of the review is limited.”
  - Findings 出现 “Unconfirmed Business Requirements”
  - Traceability 显示 “No requirement records were captured for this review.”
- **根因**：
  - orchestrator 只从 `groundingRepository.listConfirmedRequirements` 读取已确认的 requirement 记录（[orchestrator.ts:761](../../sidecar/src/review/orchestrator.ts:761)）。
  - 创建 requirement、确认候选 requirement 的 UI 只存在于 `RequirementsScreen`，而这个页面**在整个应用里没有任何入口**（`name: 'requirements'` 只出现在 `types.ts`）。
- **影响**：系统给出的修复建议是 “Add or confirm the business requirements, then start a new review”，用户在 UI 里根本做不到。PRD 的核心卖点 “requirement traceability” 在正常流程里无法实现。
- **建议**：在 Project 的 Source 或 Findings 里提供 “Confirm requirements” 入口，把 requirement 文档中抽取的候选 requirement 列出来，让用户一键确认。至少要把 RequirementsScreen 挂到 Project tab 上。

### P0-B Review 的状态在不同页面不一致：已批准的 Review 显示为 “Need Approval” 或 “Failed”
- **现象**（同一个 Review `#7a6cdde2`，已 Approve）：
  - Review 详情页：**Completed**
  - Project → Recent activity：**Need Approval**
  - Home → Recent projects：**Failed**
  - Home → Action required：仍然要求 Inspect 失败的父 Review `#17ee2500`，尽管它的 Retry 已经完成并获批
  - Project → Assessment：“No completed Review snapshot available”
- **根因**：
  1. 列表接口现在返回 `status: "approved"`，但**不带 `currentDecision`**；详情接口带。共享的 `projectActivityLifecycle` 只认 `currentDecision.decision === 'approved'`（[reviewViewModel.ts:141](../../centinel/src/reviewViewModel.ts:141)）。`StaticSessionStatus` 新增的 `approved / completed / changes_requested / pending_approval / prepared`（[types.ts:229](../../centinel/src/types.ts:229)）都没有被映射，全部落入默认的 “Need Approval”。
  2. `getStaticAction` 不考虑 retry 链。失败的父 Review 在子 Review 成功后仍然会触发 Action required。Home 的 “Current state” 取自这个 action，于是显示 Failed。这和 Dynamic 的 P0-1 是同一类问题。
- **建议**：在共享 mapper 里映射新的 status；列表接口带上 decision，或者直接用 status 判断；父 Review 被同一链上更新的 attempt 覆盖。这是 Static 改了数据契约，但没有同步共享 mapper。

### P0-C Review 可以在没有可用模型的情况下启动，失败后也不告诉用户怎么修
- **现象**：Settings 中 Review 显示 “Not configured”，Review entry 却照常允许 Start。15 秒后失败，提示 “Model Provider unavailable … Address the issue listed above, then retry the review.”，没有提到 Settings，也没有链接。
- 同时，Home 的 “Complete provider setup” 推荐**一直存在**，即使 Review 和 Dynamic 都已经配置了 Codex。原因是它只检查 API key（[DashboardScreen.tsx:76-78](../../centinel/src/screens/DashboardScreen.tsx:76)）。真正需要提醒的时候，它和平时的误报没有区别，用户已经学会忽略它。
- **建议**：Review entry 提交前检查 Review provider；失败信息直接给出 “Open Settings → Use for Review” 按钮；Dashboard 的判断改用实际的 workflow provider 状态。

---

## 四、P1：严重问题

### Review flow
1. **“Open project sources” 会丢掉已经填写的内容**：Review entry 在没有 source 时跳到 Project → Source，名称和目标没有保存（`ReviewEntryScreen` 没有草稿机制），回来也没有返回入口。
2. **没有 Review 列表页**：侧边栏 “Review” 永远打开新建表单。查看过去的 Review 只能通过 Project → Recent activity（每页 5 条）。
3. **Approve 没有任何阻拦**：Review 自己的建议是 “Changes needed”，并且有一个 Critical 的 confirmed blocker，Approve 仍然一键通过。Help 页写着 “A verified unresolved Critical or High finding blocks readiness for handover”，两者矛盾。至少要二次确认，并要求填写理由。
4. **同一个问题出现两次**：deterministic rule 的 “Unsafe HTML Assignment”（info，3 处）和模型的 “Todo HTML Injection”（medium）指向同样的代码行，却是两个 issue type，严重度也不同。
5. **项目层面的重复计数**：同一份冻结源码被父 Review 和 Retry 各扫一次，项目 Findings 中 “Unsafe HTML Assignment” 变成 “6 affected occurrences”，项目共 10 项，而 Review 内只有 7 项。
6. **展示的是内部存储路径**：finding 位置显示为 `uploads/02eee232-05de-…-todo-app.html:131`，而不是 `todo-app.html:131`。finding ID 中还出现了 `#document`。
7. **HTML 内联脚本不在解析范围内**：Feature map 显示 “0 possible features in 0 of 1 source files”，Overview 显示 “0 of 0 mapped features assessed across all four domains”。对普通用户来说，这些数字没有意义，反而像是什么都没检查。
8. **Queued 状态文案错误**：Retry 排队时显示 “The detailed activity wasn’t saved for this review”。这是给旧数据用的文案，不是 “尚未开始”。
9. **长时间运行没有阶段内进度**：“Review the behaviour” 跑了 3 分 27 秒，界面只显示 “I’m working through this part now.”

### Readiness
10. **Coding standards 被误判为 “Completed”**：项目里没有任何编码规范文档，checks 3/3 全部 pass（`sourceCount: 1`）。Design 也被拿同样两个文件评成 Incomplete。Readiness 会把不相关的文档当作某一类文档来评分，产生虚假的信心。
11. **旧的失败原因一直留着**：配置 provider 之后，卡片仍然显示 “No Model Provider is configured”（10-29 那次失败的原因）。source 变化后也不会自动重跑，必须手动 Retry。
12. **运行中按钮仍然显示 “Start”**：服务端 `status: running`，按钮没有变成 disabled 或 “Checking”。
13. **结果无法展开查看原因**：criteria 的 pass / gap 没有任何说明（`reason` 为空），UI 里也展不开。

### 跨模块
14. **Review 和 Dynamic 之间仍然没有桥接**：Finding 详情里 “How to verify resolution: No verification steps … were recorded” 的位置，正适合放一个 “Verify with Dynamic Testing” 按钮，用 finding 生成测试目标和 check。目前两个模块的唯一交集只是同一张 activity 列表。
15. **Help 页只覆盖 Review**：Dynamic Testing、Projects、Settings 都没有说明。
16. **Need attention 噪音太大**：一个只有两份文件的小项目，Need attention 就有 12 项、4 页。每个历史 Dynamic Run、文档缺口、Readiness 结果都在里面，用户无法分辨优先级。

---

## 五、P2：体验瑕疵

- 新上传的文件显示 “Updated time unavailable”。
- Review entry 把 HTML 代码文件标为 “Attached document”，而 Source 页标为 “Code”，两边说法不一致。
- Findings 表里 Severity 是小写（high），Priority 是首字母大写（High）。
- Review 页的浮动 toast 覆盖在面包屑上方。
- Settings 的 Codex 模型列表在加载时显示 “The live account catalog is unavailable”，需要等待才能选择；Review 模型默认没有选中值。
- Overview 里 “Traceability attention —” 和下面的数字排版容易误读。

---

## 六、仓库与工程卫生

- **`ed89a10` 一个 commit 增加约 22 万行**，主要来自 `docs/PUBLIC_REPO_ACCEPTANCE_*`、`docs/LOCAL_REPOSITORY_INDEX_*` 等验收 JSON，单个文件 2–3.7 万行（例如 `review-docusaurus-verification.json` 有 36,708 行）。这会让 clone、diff、code review 都变慢。建议移到 release artifact，或者用 Git LFS。
- **`centinel/` 根目录提交了十几个调试预览文件**：`.batch-cache-preview.tsx`、`.index-backup.ts`、`.outcome-evaluation.ts` 及对应的 `.html`。它们看起来是本地 harness，不属于产品代码。
- `AGENTS.md` 中加入了大量实现细节（PowerShell 时间戳解析、索引保留策略等），已经变成 changelog，不再是给 agent 的工作说明。
- **测试**（本机负载极高，load average 40–220，结果仅供参考）：
  - 前端：`tsc` 通过；默认 5 秒超时下有大量超时；超时放宽到 20 秒后 **518/520 通过**，剩下 2 个是 `DynamicWorkspaceScreen.test.tsx` 的超时（这个文件本次没有改动）。
  - Sidecar 全量（超时 30 秒）：22 个失败，都集中在会 spawn 子进程的测试上（git、workspace、Vitest runner、uploads 等）。只重跑这 9 个失败文件后剩 **4 个失败 / 123 个通过**：
    - `activeHttpAuth.test.ts`：非成员访问 Dynamic 资源返回 500 而不是 403（日志里有 “Supabase unavailable”）。10-28 的评审就已经发现，Static 推送之前就存在。
    - `dynamicHooks.test.ts`：得到 `runner_error`，期望 `passed`。同样在 10-28 就已经存在。
    - `dynamicVitestRunner.test.ts` 2 个：超时和取消相关的断言，很可能是本机负载过高导致的。

---

## 七、修复优先级建议

1. **P0-B 状态一致性**（改动最小、收益最大）：共享 mapper 映射新的 status；retry 链覆盖父 Review。Home、Project、Assessment 一次修好。
2. **P0-A requirements 入口**：把 RequirementsScreen（或候选 requirement 确认）挂到 Project 上，打通 Traceability。
3. **P0-C provider 预检**：Review entry 检查 provider，失败时给出 Settings 链接；修好 Dashboard 的误报。
4. Readiness 的文档类别误判，以及运行中的按钮状态。
5. Approve 的阻拦和二次确认；去重 deterministic 和模型的同类 finding。
6. Review ↔ Dynamic 桥接（从 finding 生成 Dynamic 测试）。
7. 清理仓库中的验收 JSON 和调试预览文件。

---

## 八、本次在共享 Supabase 项目 “Memos Web Testing” 中留下的数据

- **上传的 source**：`REQUIREMENTS.md`、`todo-app.html`
- **Review**：`QA demo todo review 20261030`（`#17ee2500`，Failed）及其 Retry（`#7a6cdde2`，**已 Approve**）
- **Readiness**：手动 Retry 一次（10-30 15:56 完成）
- **测试账号设置变更**：Settings → Model Provider → Review 模型设为 **Codex · gpt-6.1-sol**（之前是 Not configured）。需要时可改回。
- 以上运行都使用了已连接的 ChatGPT（Codex）账号额度。

## 九、未覆盖

- GitHub / Google Drive / Slack 连接与同步（需要外部 OAuth）
- 大型 repository 导入，以及 source 浏览器在数百个文件时的表现
- Request changes 的完整提交流程（只打开了面板，没有提交）
- 统一项目报告导出
- Tauri 桌面壳和打包产物
