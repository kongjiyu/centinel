# Centinel 演示流程（约 15 分钟）

主线只有一条：**需求 → 静态 Review 找到问题 → 把同一条需求交给 Dynamic Testing 在运行中的应用里验证 → 团队共享并导出报告。**

## 被测对象：Cypress Real World App（RWA）

[cypress-io/cypress-realworld-app](https://github.com/cypress-io/cypress-realworld-app) 是一个开源的转账 Demo（MIT 许可证），固定在 commit `9dfcb98`。它是一个“正常写法”的应用，**不是**漏洞靶场。下面这些问题都是上游代码里真实存在的，不是我们埋的，所以模型不可能事先背过答案。

| 需求 | RWA 上游代码中的真实问题 | 位置 | 核实方式 |
|---|---|---|---|
| REQ-2 只能改自己的账号 | `PATCH /users/:userId` 没有检查是不是本人。而同一个文件里的 `GET /users/:userId` 有检查，前后不一致 | `backend/user-routes.ts:81` | 2026-10-31 实测：Heath93 改掉了另一个用户的名字（HTTP 204），之后已改回 |
| REQ-5 只有交易双方能改交易 | `PATCH /transactions/:transactionId` 没有检查归属 | `backend/transaction-routes.ts:171` | 只看了代码 |
| REQ-6 银行账户归属 | `DELETE /bankAccounts/:bankAccountId` 没有检查归属 | `backend/bankaccount-routes.ts:51` | 只看了代码 |
| REQ-7 会话密钥 | session secret 写死为 `"session secret"` | `backend/app.ts:60` | 只看了代码 |
| REQ-8 退出登录 | `POST /logout` 重定向到后端不存在的 `/`，返回 404（上游 issue #1592） | `backend/auth.ts:49` | 2026-10-31 实测。前端不受影响 |

这张表就是演示的**标准答案**：Review 结束后，可以逐条对照它找到了哪些、漏了哪些。
- Review 只导入 `backend/`（19 个文件，约 1900 行），速度快，而且问题都在这里。
- Dynamic 测的是前端的正常业务流程（REQ-1、3、4、8）。上面的越权问题只能通过直接调用 API 触发，界面上点不出来，所以留在 Static 里讲。

素材：
- 需求文档：`docs/qa/rwa-demo/REQUIREMENTS.md`（REQ-1 到 REQ-8，只描述应有的行为，不提缺陷）。
- RWA 已经装在 `centinel-test-targets/cypress-realworld-app`（依赖和 Node 22.20.0 都已就绪）。
- 种子账号：`Heath93` / `s3cret`。这是 RWA README 里公开的测试密码，只存在于本机的种子数据库中。

---

## 一、演示前准备（提前 30 分钟完成）

> 一次 Review 大约 5–10 分钟，**一定要提前跑好**。现场只演示启动界面，然后打开已跑完的结果。

1. 启动 Centinel：
   ```bash
   pnpm dev
   ```
2. 启动 RWA（启动时会恢复种子数据；前端 `localhost:3000`，后端 `localhost:3001`）：
   ```bash
   cd /Users/kongjy/Documents/School/FYP/centinel-test-targets/cypress-realworld-app && PATH=/Users/kongjy/Documents/School/FYP/centinel-test-targets/runtime/node-v22.20.0-darwin-arm64/bin:$PATH corepack yarn dev
   ```
3. 登录 Centinel → **Settings → Connect Codex**，用 ChatGPT 账号登录；Review 和 Dynamic testing 都选好模型。Home 上不应再出现 “Complete provider setup”。
4. **Projects → Create project**：`RWA Payments Demo`。
5. 项目 → **Source → Add source**：
   - 选择 Repository，指向 `centinel-test-targets/cypress-realworld-app/backend`；
   - 上传 `docs/qa/rwa-demo/REQUIREMENTS.md`。
6. **Source → Manage requirements**：对 `REQUIREMENTS.md` 点 **Extract candidates**，逐条 **Confirm**（REQ-1 到 REQ-8）。
7. **Review → Start a Review**：
   - 名称：`RWA backend pre-release review`
   - 目标：`Check the payment backend against REQ-1…REQ-8, especially that users can only read or change their own account, transactions and bank accounts, and that sessions are protected.`
   - 确认 8 条需求都勾选了 → **Start review**，等它进入 **Need Approval**。
8. 用标准答案表核对 Review 结果，记下它找到了哪几条，演示时如实说明。
9. 提前建好 Dynamic 环境（见第三部分第 2 步）并**保存登录会话**，现场可以省下 2–3 分钟。

---

## 二、静态 Review（约 6 分钟）

| # | 操作 | 要讲的点 |
|---|---|---|
| 1 | 打开 **Home** | Action required 只列真正需要处理的事项。 |
| 2 | 进入 `RWA Payments Demo` → **Source** | Repository 是 `backend/` 的固定快照；打开 `REQUIREMENTS.md`，点 **Confirm still current**，讲文档时效确认和版本审批的区别。 |
| 3 | **Manage requirements** | 需求先由 AI 抽取为“候选”，人工确认后才算数。 |
| 4 | **Review → Start a Review** | 页面上的 Recent Reviews 列表；模型没有配置好时，Start 会被禁用。演示到这里即可。 |
| 5 | 打开提前跑好的 Review → **Overview** | 结论是 “Changes needed”，下一步按 confirmed blocker → remaining risk → evidence gap 排列。 |
| 6 | **Findings** → 打开越权修改用户资料（REQ-2）的 finding | 引用了 `user-routes.ts` 的具体行。重点讲：**同一个文件里 GET 有归属检查、PATCH 没有**，这正是跨位置一致性分析的价值。然后对照标准答案表，说明它还找到了哪些。 |
| 7 | **Traceability** | 8 条需求分别是 Complete / Incomplete / Missing。 |
| 8 | 点 **Approve review** | 有未解决的 Critical/High blocker 时，必须写理由并勾选确认。**点 Cancel。** |
| 9 | **Export report** → Download PDF | Review report 包含范围、源文件版本、findings、traceability 和决定历史。 |

---

## 三、从 Review 到 Dynamic Testing（约 6 分钟）

| # | 操作 | 要讲的点 |
|---|---|---|
| 1 | 在 Review 页点 **Test in Dynamic Testing** | 测试草稿已预填，Criteria source 是 “Requirements from a Review”，用的是 Review **冻结时**的需求。 |
| 2 | **Manage environments → New environment**：名称 `RWA local`，网址 `http://localhost:3000/` → 保存后，用环境的 session 功能登录 `Heath93` 并保存会话 → 展开 **Browser action permissions**，在 “Also scan these pages” 里填 `/user/settings` 和 `/transaction/new` → **Find controls** | 只读扫描，带着保存的会话能扫到登录后的页面：侧边栏、My Account 的姓名和邮箱输入框、Save 按钮等。勾选后点 **Allow selected controls**，再 **Save environment**。AI 只能操作这些控件。 |
| 3 | 测试目标：`Open My Account, change First Name to "Demo", save, reload the page and confirm the first name is still Demo.` Check 1：criterion 选 **REQ-3 Profile changes persist**，Verify 选 Field value，selector `#user-settings-firstName-input`，Expected 填 `Demo` | 运行中显示 “Running · up to N steps”。 |
| 4 | **Run saved test** → **Passed** | 结果页先给结论，再给 check 结果和截图证据；Coverage 显示 REQ-3 已验证，其他需求是 Not tested（不会被算成通过）。 |
| 5 | （可选）再建一个 check：criterion 选 **REQ-8 Sign out**，目标为退出登录后打开 `/transaction/new`，Page address 期望 `/signin` | 说明 Dynamic 验证的是界面上看得到的行为；REQ-2 的越权只能通过 API 触发，所以由 Static 负责。两个模块各自覆盖不同的证据。 |

---

## 四、协作（约 2 分钟）

| # | 操作 | 要讲的点 |
|---|---|---|
| 1 | 项目 → **Collaborators** → Project members → 输入队友的 Centinel 账号邮箱 → **Add member** | 只有 owner 能添加或移除成员。 |
| 2 | 点该成员的 **Remove** | 移除后立即失去访问权（数据库层 RLS 生效）。 |
| 3 | 项目页 **Action → Export report** | 项目报告同时包含 Review 和最新的 Dynamic Run 结果。 |

---

## 五、收尾时主动说明的限制

- Review 是基于证据的静态分析：对照标准答案表，它找到了什么、漏了什么，都要如实说。
- Dynamic 只验证配置了的 check；没有 check 的需求显示为 Not tested。
- Project Assessment 的风险分数只来自 Review findings；Dynamic 的结果单独呈现。
- Readiness 的 Coding standards 在没有专门规范文档时，可能仍被评为 Completed（已知问题）。

---

## 六、现场出问题时的备用方案

| 情况 | 处理 |
|---|---|
| Codex 响应慢或失败 | 直接打开提前跑好的 Review 和 Dynamic Run。 |
| RWA 没启动或数据乱了 | 重新执行第一部分第 2 步的启动命令，会恢复种子数据。 |
| Find controls 扫不到登录后的页面 | 结果里会提示哪些页面被重定向到了 `/signin`：先为环境保存登录会话，再扫描一次。 |
| 需要一个更简单的被测对象 | 备用 Todo demo：`pnpm --filter @centinel/sidecar demo`（`localhost:37702`），需求文档是 `sidecar/demo/REQUIREMENTS.md`。 |
