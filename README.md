# PanelForge · AI 短篇漫画工具

面向 OC / 同人创作者的 AI 短篇漫画创作工具（移动端 H5）。输入一句故事梗概，自动完成 **编剧 → 分镜 → 生图 → 气泡台词 → 排版导出** 全流程，手机上即可产出可直接发布的短篇漫画。

## ✨ 功能特性

- **角色库**：创建自己的 OC 角色，上传参考图，AI 自动识别画风与人物外貌；支持特征锁定（强/弱/不锁）保持角色一致性
- **编剧分镜一体化**：一句话梗概自动扩写剧情并拆分分镜，每格附英文视觉提示词
- **AI 生图**：基于参考图的图像编辑生成（最多 4 张参考图），保持角色形象统一
- **气泡系统**：对话泡 / 爆炸泡 / 旁白框三种样式，九宫格定位 + 透明度调节，自动防重叠，编辑预览与导出所见即所得
- **多种排版导出**：方图 2×2 / 竖图 3:4 / 九宫格 3×3 / 条漫竖版，一键下载成图
- **内容防火墙**：零成本词库快筛 + 生成端系统提示词双层约束，拦截违规内容并提供一键改写建议
- **账号登录**：手机号 / 邮箱验证码登录页（演示版本机模拟发码，预留真实短信/邮件服务接入点），内置《用户协议》《隐私政策》页面
- **纯前端数据层**：作品与角色数据存于浏览器 localStorage，无需数据库即可运行

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

本项目默认使用 [硅基流动 SiliconFlow](https://cloud.siliconflow.cn) 的模型服务（剧情：DeepSeek-V3；生图：Qwen-Image-Edit；识图：Qwen3-VL）。注册后在控制台创建 API Key，然后：

```bash
cp .env.example .env.local
```

编辑 `.env.local`，填入你自己的 Key：

```
SILICONFLOW_API_KEY=你的API密钥
```

> ⚠️ `.env.local` 已被 `.gitignore` 忽略，请勿将真实 Key 提交到任何公开仓库。
> 💰 参考成本：完整生成一部 4 格漫画约 0.3–0.5 元人民币（硅基流动）/ 约 1–1.2 元（方舟 Seedream）。

**可选：切换生图模型为火山方舟 Doubao-Seedream-4.5**（角色一致性更强、原生支持 3:4/1:1 出图比例，单格约 0.25 元）：在 [方舟控制台](https://console.volcengine.com/ark) 开通 Seedream 模型并创建 API Key（注意给 Key 授权该模型），然后在 `.env.local` 追加：

```
IMAGE_PROVIDER=ark
ARK_API_KEY=你的方舟密钥
```

### 3. 启动

```bash
npm run dev
```

浏览器打开 http://localhost:3000 即可使用。本项目为移动端布局，建议用浏览器开发者工具切换手机视口，或让手机与电脑连接同一 Wi-Fi 后访问电脑的局域网地址体验。

## 🔧 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `SILICONFLOW_API_KEY` | ✅ | — | 硅基流动 API Key |
| `SILICONFLOW_BASE_URL` | | `https://api.siliconflow.cn/v1` | API 地址 |
| `PLOT_STORYBOARD_MODEL` | | `deepseek-ai/DeepSeek-V3` | 编剧分镜模型 |
| `IMAGE_EDIT_PROMPT_MODEL` | | `deepseek-ai/DeepSeek-V3` | 生图指令模型 |
| `IMAGE_EDIT_MODEL` | | `Qwen/Qwen-Image-Edit-2509` | 图像编辑生成模型 |
| `MODERATION_VL_MODEL` | | `Qwen/Qwen3-VL-8B-Instruct` | 参考图识别模型 |
| `IMAGE_PROVIDER` | | `siliconflow` | 生图供应商：`siliconflow` / `ark`(方舟 Seedream) |
| `ARK_API_KEY` | ark 时必填 | — | 火山方舟 API Key（需已授权 Seedream 模型） |
| `ARK_BASE_URL` | | `https://ark.cn-beijing.volces.com/api/v3` | 方舟 API 地址 |
| `ARK_IMAGE_MODEL` | | `doubao-seedream-4-5-251128` | 方舟生图模型 ID |

## 📁 项目结构

```
app/                    页面与 API 路由
├── api/
│   ├── plot-and-storyboard/   编剧分镜 Agent
│   ├── generate-batch/        批量生图
│   ├── generate-panel/        单格重抽
│   ├── analyze-image/         参考图 AI 识别
│   ├── moderate/              内容词库快筛
│   └── proxy-image/           生成图转存代理
├── characters/         角色库
├── create/             新建作品
├── login/              登录页(手机号/邮箱验证码,演示版)
├── terms/ · privacy/   用户协议 / 隐私政策(文案在 lib/legal.ts)
├── project/[id]/       分镜编辑 / 生图页
├── export/             导出中心
└── profile/            个人中心
lib/
├── plotAndStoryboard.ts   编剧分镜一体化 Agent
├── imageEditPrompt.ts     生图指令 Agent
├── siliconflow.ts         生图 API 封装
├── moderation.ts          内容防火墙(纯词库,零成本)
├── exporter.ts            导出合成 + 气泡渲染
├── bubbles.ts             气泡布局
├── persistImage.ts        生成图转存(远端 URL 24h 过期,须立即转存)
└── store.ts               localStorage 数据层
tests/                  回归测试脚本(用法见 tests/README.md)
```

## 🧪 测试

需先启动 dev server 并安装 playwright，详见 [tests/README.md](tests/README.md)。

```bash
node tests/persona-test.js   # 十种用户画像全流程模拟(mock,免费,日常回归首选)
node tests/e2e-mock.js       # 真实剧情 + mock 生图
node tests/e2e-full.js       # 全真实链路终验(消耗少量 API 费用)
```

## ⚠️ 开发注意事项

- **生成图必须转存**：硅基流动返回的图片 URL 24 小时过期，`persistImage` 转存逻辑不可移除
- **上传图必须压缩**：最长边 1024、JPEG、透明区域铺白底
- **生图模型限制**：Qwen-Image-Edit 必须至少 1 张参考图，不支持纯文生图
- **文件选择控件**：必须使用 `label` + `sr-only input` 方案，`display:none` + JS click 会被部分手机浏览器拦截

## 📄 License

[MIT](LICENSE)
