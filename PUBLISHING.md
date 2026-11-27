# 发布到 DSH 插件市场

> 目标市场：**dshmarket**（你已安装的那个"插件市场"）。
> 它自己不存插件列表，列表来自精选仓库 **`awesome-dsh-plugin/awesome-dsh-plugin`**。
> 本文所有要求都来自该仓库的 `contributing.md` 与本机 `dshmarket` 的实际行为，不是推测。

## 零、适用范围（先看这条）

**强制拦截仅 native 会话可用**；PTC（`run_code`）会话里卡片与按钮可用，但闸门无法强制拦截——`run_code` 必须放行，否则会话死锁。详见 README「PTC 会话：卡片支持，拦截不支持」。

## 一、准入要求（官方原话归纳）

| 要求 | 含义 |
|---|---|
| 能用 `dsh plugin add` 装上 | 包必须是**可安装的 npm/GitHub 包**，不能是 `link:` 本地目录 |
| 声明了 `dsh.bundle` 清单 | `package.json` 里要有 `dsh.bundle.patch`（本包已有） |
| 描述属实、分类正确 | 维护者会对照源码核对描述里的每一句话 |
| 在维护 | 仓库消失或长期不维护会被移出列表 |

## 二、当前包的七个缺口（本次已修 5 个）

| 项 | 状态 |
|---|---|
| `private: true` | ✅ 已移除（npm 会拒发私有包） |
| `license` | ✅ 已填 `MIT` —— **需你确认协议**，并补 `LICENSE` 文件与版权人 |
| `keywords` | ✅ 已补（含 `dsh-plugin`） |
| `engines.dsh` | ✅ 已填 `>=0.2.2-rc.5`（市场靠它做兼容筛选） |
| 位图图标 | ✅ 已生成 `assets/icon-180.png`（180×180 PNG；市场**不收 SVG**） |
| **`repository`** | ❌ 缺——必须先有公开 GitHub 仓库才能填 |
| **公开仓库** | ❌ 当前目录**不是 git 仓库**，市场按仓库地址收录 |

## 三、发布步骤（按顺序执行）

### 1. 先把它变成一个公开仓库

```bash
cd ~/deepseek/dsh-task-align
git init -b main
printf 'node_modules/\n*.tgz\n' > .gitignore
git add -A && git commit -m "feat: task-align plugin v0.1.0"
# 在 GitHub 建空仓库 owner/dsh-task-align，然后：
git remote add origin git@github.com:zzr1iu008/dsh-task-align.git
git push -u origin main
```

仓库**根目录就是包根**（`package.json` 在最外层），不要放进子目录——放子目录也能收录，但条目要写 `#subname`，多一层麻烦。

### 2. 回填 `repository`（否则 npm 与市场都会缺信息）

```bash
npm pkg set repository.type=git \
         repository.url=git+https://github.com/zzr1iu008/dsh-task-align.git \
         homepage=https://github.com/zzr1iu008/dsh-task-align
```

### 3. （可选）发 npm

市场对 npm 包支持最好（可检测版本、一键更新）。若发了 npm，条目里的 `npm` 字段会被自动识别。

```bash
npm publish --access public
```

> 名字 `dsh-task-align` 若已被占用，需先在 `package.json` 改名，并同步 `cordis.patch.yml` 里两行的 `name`。

### 4. 提 PR 到收录仓库（这就是"上架"）

只加**一个文件**：`data/plugins/zzr1iu008__dsh-task-align.yml`

```yaml
url: https://github.com/zzr1iu008/dsh-task-align
name: zzr1iu008/dsh-task-align
category: ui
description:
  en: Pauses a multi-step task before it starts — the model restates the goal and a 3-5 step plan in a card above the composer, and in native sessions every other tool stays blocked until you confirm; the same card then tracks the current step and a ticked-off checklist.
  zh: 多步任务动手前先停一下：模型把目标与 3–5 步计划复述在输入框上方的卡片里，native 会话里确认之前其余工具全部被拦下；确认后同一张卡片显示当前第几步与逐条清单进度。
icon: https://raw.githubusercontent.com/zzr1iu008/dsh-task-align/main/assets/icon-180.png
```

要点：

- **文件名必须由 `url` 推出**：`owner__repo.yml`（CI 会检查，不一致直接红叉）
- `category` 必须取自固定枚举，本插件属于 `ui`（备选：`tools`、`workflow`）
- `description.en` 必填、单行、**以句号结尾**；`zh` 可选（不写维护者会补）
- `icon` 必须是 **GitHub 图床上的位图**（png/jpg/webp），指向 `main/assets/icon-180.png`
- **不要在 YAML 里写注释**（注释会被当成数据）
- 不要手工改 README（由 `data/plugins/*.yml` 自动生成）

### 5. 如果你不想发 npm，也不想进列表

还有一条更简单的路：发布 GitHub Release 并挂上本目录已生成的 tarball

```bash
npm pack                       # 生成 dsh-task-align-0.1.0.tgz（已验证 27.9KB）
gh release create v0.1.0 dsh-task-align-0.1.0.tgz --title "v0.1.0" --notes "首个版本"
```

用户可直接 `dsh plugin --profile <name> add https://github.com/zzr1iu008/dsh-task-align/releases/download/v0.1.0/dsh-task-align-0.1.0.tgz`。
条目里对应可选字段 `tarball:`（同样必须托管在 GitHub）。

## 四、版本与升级规则

- 语义化版本：修 bug → `0.1.1`；新增能力 → `0.2.0`；改坏兼容 → `1.0.0`（在 1.0 之前，`0.x` 每次 minor 都可以不兼容，但市场用户会按 `@latest` 升级，请别静默破坏配置）
- 升级后同步改 `engines.dsh`（若用到了更新宿主的 API）
- 市场的更新检测：npm 版本 / 锁定 commit 对比 HEAD；从 tarball 装的只认自己的来源

## 五、发布前必须过的检查

```bash
npm pack --dry-run                  # 看内容，别把调试文件带出去
tar -xzf dsh-task-align-*.tgz -C /tmp/x && node --check /tmp/x/package/index.js
```

本包已通过：11 个文件、`exports` 与 `bundle.patch` 全部指向存在的文件、三个 JS 文件语法通过。

## 六、还没做的事（诚实清单）

- `LICENSE` 文件与版权人**尚未创建**——`package.json` 写了 MIT，但法律文本得你补
- 图标是 `icon.svg` 栅格化来的，带一点留白；要更好的观感请替换 `assets/icon-180.png`
- 我没有替你推送、建仓库、提 PR

## 七、与 dsh-progress-nudge 的关系（写进 PR 描述）

市场里已有 [buaaflyaway/dsh-progress-nudge](https://github.com/buaaflyaway/dsh-progress-nudge)（`agi` 分类，2 stars）。
照着它的 README 逐条核对后，两者**不重叠、是互补的**：

| 维度 | dsh-progress-nudge | 本插件 |
|---|---|---|
| 介入时机 | 运行**中**（沉默 N 轮后） | 开工**前** |
| 机制 | 注入一条提醒消息，要求模型输出进展 | **闸门**：确认前除确认工具外所有工具被拒 |
| 对"确认"的态度 | 明确要求模型**不要**停下来等用户确认 | 明确要求模型**必须**停下来等确认 |
| 输出物 | 一段文字汇报 | 卡片：复述 + 编号计划 + 逐条状态 + 摘要行 |
| 钩子 | `agent/pre-step`、`agent/turn-stopping` | `tools.guard`、`tools.register`、`agent/pre-step`、`agent/status`、`commands` |

一句话：**它让沉默的循环开口，我们让开口之前的计划先被批准。** 同时装两者不冲突——它的提醒不会触发闸门，我们的闸门也不会打断它的计数。

PR 描述里建议直接贴这段表格的结论，并注明"已核对 dsh-progress-nudge，两者机制与时机不同"。
