// API 护栏:公网部署前的最低防线(评审风险表 #1:接口裸奔,key 余额公开可刷)。
// 纯内存滑动窗口限流,适配当前单实例部署;上多实例/Serverless 冷启动分裂实例时,
// 换 Redis/Upstash 等共享存储(接真实账号体系后应改为按用户限额,本文件仅防脚本滥刷)。

const WINDOW_MS = 60_000;

// 每 IP 每分钟成本上限。image 按"格"计(一次 9 格批量 = 9),llm 按次计。
// 上限取"正常重度用户不可能碰到、脚本刷量立刻撞墙"的量级:
// 30 格/分 ≈ 连续提交 3 篇九宫格;12 次/分 LLM ≈ 每 5 秒改一次剧情。
const LIMITS = { image: 30, llm: 12 } as const;

// 单次批量生成的格数上限:最大模板是 9 格,条漫 Agent 上限 8 格,12 已含余量。
export const MAX_PANELS_PER_BATCH = 12;

type Kind = keyof typeof LIMITS;
type Bucket = { cost: number; windowStart: number };
const buckets = new Map<string, Bucket>();

function clientIpOf(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}

// 返回 null = 放行;返回字符串 = 拒绝原因(直接可展示给用户)
export function rateLimit(req: Request, kind: Kind, cost = 1): string | null {
  // 防 Map 无界增长:超过 5000 个 IP 桶时清掉过期窗口
  if (buckets.size > 5000) {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now - b.windowStart >= WINDOW_MS) buckets.delete(k);
    }
  }
  const key = `${kind}:${clientIpOf(req)}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { cost, windowStart: now });
    return null;
  }
  bucket.cost += cost;
  if (bucket.cost > LIMITS[kind]) {
    return "请求太频繁了，请一分钟后再试";
  }
  return null;
}
