# WanderStar Image Pool (漫游星图) - 高性能随机图片 API 聚合器

## 项目概述
漫游星图 是一个基于 Node.js + Express + SQLite 的高性能随机图片 API 聚合与分发系统。它旨在统一管理各种随机图床 API，提供自动熔断、权重优先级排序、统一鉴权、以及优雅的对内对外界面，将分散的图片 API 聚合成单一、高可用的大型图片服务。

---

## 核心架构设计

项目采用前后端分离结构：
1. **服务端 (Backend)**: 负责所有核心逻辑、数据库交互、接口请求与重试（熔断机制）。
2. **管理后台 (Admin UI)**: `public/admin` 目录。一个纯静态的单页应用，提供给管理员配置分类、API 接口、系统参数和状态管理。
3. **对外开放首页 (Public Site)**: `public/site` 目录。面向用户的静态聚合页，展示系统提供的所有分类及其调用地址，采用高端拟态玻璃质感设计，并提供一键复制功能。

### 目录结构
```text
rand-pic/
├── src/
│   ├── index.ts           # 应用入口、路由控制、自动熔断与重试逻辑
│   ├── dataManager.ts     # SQLite 数据库持久化层、SQL CRUD 操作
│   └── store.ts           # 内存级别的 API 状态管理 (记录自动熔断与封禁状态)
├── public/
│   ├── admin/             # 管理员后台前端文件
│   └── site/              # 对外展示的首页前端文件
├── data.sqlite            # SQLite 本地数据库文件 (自动生成)
```

---

## 核心功能模块详细解释

### 1. 数据库与数据持久化 (`src/dataManager.ts`)

`dataManager.ts` 是系统的持久化数据交互层，采用 `sqlite3` 操作 `data.sqlite` 文件。涵盖分类配置、API 清单和系统参数（例如域名与密码）。

- `hashPassword(password)` / `verifyPassword(password)`: 使用 `crypto.scryptSync` 对管理员密码进行安全加盐哈希校验。
- `updatePassword(newPassword)`: 存储或更新后台管理员密码（存入 `settings` 表）。
- `getSetting(key)` / `updateSetting(key, value)`: 负责通用的系统设置读写，目前支持记录对外主页展示的正式域名 (`public_domain`)。
- `initDB()`: 初始化整个 SQLite 数据库，自动建表 (`settings`, `categories`, `apis`)，并在表缺失时自动执行结构更新（例如添加 priority 列），同时读取环境变量初始化密码。如果存在旧的 JSON 格式数据 (`data.json`)，则自动将其迁移到 SQLite 并兼容。
- `getCategories()`: 从数据库拉取所有的图片分类及对应的 API 列表，将每个分类下的 API 按照优先级 (`priority`) 升序排列并返回，用作聚合的核心路由数据源。
- `addCategory(name)` / `deleteCategory(name)`: 分类的增删方法，删除分类时会依靠外键联级删除 (CASCADE) 清除该分类下属的所有 API。
- `addApi(categoryName, api)` / `deleteApi(categoryName, id)`: 管理具体分类下的接口。
- `setApiBanState(categoryName, id, isBanned)`: 手动开关 API 状态，用于管理后台强制封禁某些长期不可用的源。
- `clearAllManualBans()`: 一键清除数据库内所有记录的手动封禁状态。
- `reorderApis(categoryName, apiIds)`: 接收前端传来的新顺序，使用 SQLite 事务批量更新特定分类下各 API 的 `priority`，实现拖拽排序持久化。

### 2. 内存状态与自动熔断中心 (`src/store.ts`)

为了提升性能，系统避免了在每次发起对外图片请求时频繁修改数据库状态，而是把“临时失效/自动熔断”的状态存储在内存中。

- `apiStates`: 内存对象，结构为 `CategoryName_ApiID: { isDisabled: boolean, disabledAt?: Date }`，实时记录哪些 API 无法连接。
- `syncStore()`: 同步函数。它会在启动或后台配置变更时读取数据库，确保内存中存在的 API 结构树是最新且完整的，但不覆盖已有的失效状态。
- `getAvailableApis(category)`: **最关键的路由查找方法**。它会在处理用户请求前，拉取目标分类下所有的接口，剔除**被手动封禁**（来自数据库）以及**处于自动熔断状态**（来自内存）的 API。
- `disableApi(category, id)`: **自动熔断触发器**。当 `index.ts` 尝试向某个 API 发送请求但超时、返回 404/5xx，或响应类型错误时被调用。该 API 将被立刻加入内存熔断名单，接下来的请求会直接忽略它，避免流量浪费。
- `enableApi(category, id)`: 用于从管理后台强制或手动解除某一个 API 的熔断状态。
- `enableAllApis()`: 管理后台提供的功能：一键清空所有因为网络波动导致的自动熔断。

### 3. 应用核心入口与请求分发 (`src/index.ts`)

负责暴露所有 RESTful 端点和代理用户真实发起的图像请求。核心流程高度集成了熔断、重试与回退机制。

- **前台页面服务**:
  - `app.use('/admin', ...)`: 提供后台前端文件服务。
  - `app.use(express.static(...))` (映射根目录): 提供对外首页的前端文件服务。
- **后台控制 API (`/api/admin/...`)**:
  - 拥有一个集成的 `authMiddleware` 用于验证 JWT Token。
  - 提供数据拉取、设置开关、添加/删除分类及 API、清除熔断记录等所有与 `dataManager.ts` 和 `store.ts` 映射的控制接口。
- **公共 API (`/api/public/config`)**:
  - 向外部系统或者 `public/site` 的前端暴露当前所有的激活分类与设定好的 `public_domain`（如果没设定，则智能读取请求头 Host），用于页面上的卡片渲染和链接组装。
- **图片分发与回退核心路由 (`/:category`)**:
  - 拦截比如 `/pc`, `/mobile` 这种请求，这是核心引擎。
  - 首先使用 `getAvailableApis(category)` 获取按优先级排好的可用接口清单。
  - 使用 `for (const api of apisToTry)` 结合 `axios` 进行按顺序请求尝试：
    - **直接直连类型 (`direct`)**: 请求其原始 URL，检测 HTTP 状态码并阻止过长重定向，一旦目标是 200，立刻执行 302 重定向把图片吐给客户端。
    - **JSON 类型 (`json`)**: 发起 GET 请求，解析响应的 JSON 体，通过 `getNestedValue` 按照设定的 JSON Path（例如 `data.img_url`）提取真实 URL，验证该目标链接后进行 302 重定向。
  - **自动熔断判决**: 如果在 `axios` 试探中抛出超时、DNS 错误、404 或者检测到的 Content-Type 居然是一个 HTML 网页或为空，则立即触发 `disableApi`，并将请求循环至优先级下一个可用的源。
  - 当这个分类下的所有源全部失效时，对调用方返回 `502 / 503` 错误提示。

### 4. 前端应用层 (`public/`)

- **管理后台 (`public/admin/`)**:
  - **`index.html`**: 使用经典左侧边栏导航、右侧数据管理面板布局。
  - **`style.css`**: 基于 CSS Variables 构建的拟态玻璃质感界面设计。
  - **`app.js`**: 处理 JWT 获取与本地存储、侧边栏 Tab 切换路由、与 `adminRouter` 进行 Fetch 交互。此外，它通过引用 `SortableJS` 对右侧的分类 API 列表进行 DOM 绑定，在拖拽放下 (`onEnd`) 时提取最新顺序数组提交到服务端，完成优先级重排。
- **对外主页 (`public/site/`)**:
  - **`index.html`**: 展现极具现代感和品牌感的公开首页骨架。
  - **`app.js`**: `DOMContentLoaded` 后异步调用 `/api/public/config`，自动渲染拥有剪贴板功能的 API 接口分类列表。

---

## 项目设计亮点
1. **高性能熔断与故障转移 (Failover)**: API 失败后直接进入内存的隔离区，确保之后的高并发请求不会因此阻塞。
2. **高度可扩展的解析器**: 支持解析返回纯图片的 API（重定向追踪）与返回 JSON 且图片路径嵌套极深的复杂 API（JSON Path 解析）。
3. **极简而高级的视觉**: 去除了所有冗杂的操作界面，无论是系统设置、域名的映射还是自动回退配置，所有管理皆在一个流畅的玻璃面板风格 Web 端完成。
