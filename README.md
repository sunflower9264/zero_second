# 零秒特工 / ZERO SECOND

一款纯手机触控的单指 H5 动作游戏。拖向目标进入子弹时间，松手瞬移突袭；击破守卫会立即刷新冲刺，形成连续决策与连击得分。

- **99 关一条主线**，分为 12 个章节。不区分手工与生成：前 20 关手工编写并逐一教授机制，其余由
  `scripts/gen-levels.mjs` 生成，**每一关都在真实游戏循环里验证过可无伤通关**才允许入场。
- 生成的关卡会故意让墙横切最短路线，逼迫玩家重新排序，而不是沿着显而易见的路线一路走到底。
- **匿名埋点**：关卡开始/失败/通关/退出与死因上报到自建收集端，用来定位流失点。
- 首次触摸才开始行动；仅第一关及新敌人、新道具首次出现的关卡显示教学，炮塔开火前锁定方向并显示预警线。
- 冷却期间可以继续瞄准，提前松手会在恢复后执行；重甲回退落点与瞄准预览一致。
- 被墙挡住的方向会明确提示，不会静默吞掉一次操作。
- 关卡选择、逐关解锁与本地三星记录，不必每次从第一关开始。
- 星级只看有效移动次数和受伤次数：通关 1 星、达成目标移动数 +1 星、无伤 +1 星。
- 结算显示最高连击与用时；失败时显示死因分布并对症给出提示。
- 护盾、EMP、医疗包三类可选道具；道具不会成为开门条件，避免关卡软锁。
- 所有冲刺、受击击退和出生位置共用墙体安全约束，运行时保持玩家不进入墙体。

## 本地运行

```bash
npm install
npm run dev
```

## 生产构建

```bash
npm run build
```

`dist/` 可部署到任意静态站点服务。游戏无后端依赖，也没有外部运行时素材请求（字体加载失败时自动使用系统字体）。

### 本机 Nginx

本机部署使用宿主机统一的 `nginx.service`（`/usr/sbin/nginx`），监听 `18080`，站点配置为 `/etc/nginx/sites-available/zero-second`，静态目录为本项目 `dist/`。

访问地址保持 `http://64.83.41.39:18080/`；执行 `npm run build` 更新静态文件。修改站点配置后执行：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

旧的 `.nginx/` 独立实例目录已删除；配置统一维护在 `/etc/nginx/sites-available/zero-second`。

## 操作

- 触屏：单指按住游戏区域瞄准，拖向目标，松手突袭。
- 暂停和声音通过画面右上角的触控按钮操作。

## 自动检查接口

```bash
npm test                  # 物理、存档，以及全部 99 关的真实游戏循环重放
npx playwright install chromium  # 首次运行浏览器验证时安装
npm run test:browser      # 自动启动本地服务，真实触控重放、截图与错误检查
npm run audit:levels      # 搜索手工关卡的无伤通关路线，输出至 output/level-audit/
npm run gen:levels        # 生成第 21-99 关，写入 src/generated-levels.js
npm run port:check        # 检查规则层模块是否仍然不依赖浏览器
npm run report -- --funnel  # 读取埋点数据库：--funnel/--pacing/--deaths/--retention/--sessions
```

## 数据收集端

`server/collector.mjs` 是单文件、零 npm 依赖的匿名事件收集端（`node:http` + 内置 `node:sqlite`），
只监听 `127.0.0.1:18099`，由 nginx 的 `/api/` 反代暴露。它以 user 级 systemd 服务常驻：

```bash
systemctl --user status zero-second-collector
systemctl --user restart zero-second-collector
```

数据库在 `~/zero-second-analytics/events.db`。健康检查只允许本机访问。


逐关记录与验收边界见 [关卡与品质审查](LEVEL_REVIEW.md)。浏览器测试截图位于 `output/browser-review/`。

- `window.render_game_to_text()`：返回当前可玩状态 JSON。
- `window.advanceTime(ms)`：以固定 60 Hz 步进游戏。
