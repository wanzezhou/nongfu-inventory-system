# UI 重设计（红墨留白·沉稳版）实施计划

> **Goal:** 将系统全局 UI 重设计为「红墨留白·沉稳版」风格，配色沉稳、卡片有质感、动效精致。

**Architecture:** 通过重写全局 CSS 变量和 Element Plus 样式覆盖实现全站视觉统一，局部调整 Dashboard.vue 适配新卡片规范。不改业务逻辑和布局结构。

**Tech Stack:** Vue 3 + Element Plus + CSS Variables

---

### Task 1: 引入字体 + 全局设计 Token

**Files:**
- Modify: `frontend/index.html`
- Rewrite: `frontend/src/style.css`

- [ ] **Step 1: index.html 引入 Google Fonts**

在 `<head>` 中添加：
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&family=Noto+Serif+SC:wght@400;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: 重写 style.css**

更新 `:root` CSS 变量（沉稳版配色）+ body 字体 + Element Plus 组件覆盖（按钮/表格/输入框/对话框/标签等）+ 通用动画（inkSpread 墨滴晕染）。

---

### Task 2: 重写布局样式（侧边栏 + 顶栏）

**Files:**
- Rewrite: `frontend/src/styles/main-layout.css`

- [ ] **Step 1: 侧边栏改为白底风格**

背景 `#FFFFFF` + 细边框；菜单项激活态用主色文字 + 左侧红竖线 + 主色浅底（非红底白字）。

- [ ] **Step 2: 顶栏半透明白 + 衬线标题**

页面标题用 Noto Serif SC；用户头像主色渐变 + 衬线首字。

- [ ] **Step 3: 内容区暖灰背景**

`--bg: #F5F4F0`，保留滚动条美化。

---

### Task 3: 重写 Dashboard 统计卡片

**Files:**
- Modify: `frontend/src/views/Dashboard.vue`

- [ ] **Step 1: 适配新卡片样式**

卡片右上角加类型色晕染角标；数值用衬线字体；底部加趋势进度条；移除旧的 card-blue/green/orange/red 渐变背景，改用细边框 + 微阴影。

- [ ] **Step 2: 图表卡片加山水装饰**

底部叠加山水 SVG；趋势图配色改为沉稳红→墨绿渐变。

---

### Task 4: 构建验证 + 文档同步

- [ ] **Step 1: 前端构建**

`cd frontend && node node_modules/vite/bin/vite.js build`

- [ ] **Step 2: 更新项目概览变更记录**

在 `docs/项目概览.md` 〇节追加 UI 重设计记录。
