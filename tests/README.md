# 测试脚本说明

运行前提:dev server 已在 3001 端口运行(`npm run dev`),且本机装有 playwright(`npm i playwright && npx playwright install chromium`,可装在任意目录)。

| 脚本 | 用途 | 是否花钱 |
|---|---|---|
| `persona-test.js` | **十种用户画像全流程模拟**(小白/创作者/自写党/条漫/九宫格/反悔型/气泡玩家/违禁试探/管理型/回访),剧情与生图全部 mock,输出卡点清单 | 否(P8 违禁测试走真实词库拦截,词库层免费) |
| `e2e-mock.js` | 单用户全流程(真实 LLM 剧情 + mock 生图),验证链路与分镜提示词传递 | 剧情一次约几厘钱 |
| `e2e-full.js` | 全真实链路(真实剧情+真实生图4格+导出下载),发版前终验用 | 约 0.3-0.5 元/次 |

```bash
node tests/persona-test.js   # 日常回归首选
node tests/e2e-mock.js       # 链路验证
node tests/e2e-full.js       # 发版前终验(花真钱)
```
