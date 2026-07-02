// 硅基流动图像生成封装。实测确认 Qwen/Qwen-Image-Edit-2509 接口可接受
// image/image2/image3/image4 四个独立参考图字段(见开发记录:传4张返回200正常)。
import { readFile } from "node:fs/promises";
import path from "node:path";

const SILICONFLOW_BASE = process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1";
const IMAGE_MODEL = process.env.IMAGE_EDIT_MODEL || "Qwen/Qwen-Image-Edit-2509";
const DEFAULT_GUIDANCE_SCALE = 4;
const DEFAULT_INFERENCE_STEPS = 20;

export type GenerateImageInput = {
  editPrompt: string;
  negativePrompt?: string;
  images: string[]; // data URL 或可访问 URL,最多 4 张,按顺序映射 image/image2/image3/image4
  seed?: number;
};

export type GenerateImageResult = { url?: string; seed?: number; error?: string };

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) return { error: "未配置 SILICONFLOW_API_KEY" };
  if (input.images.length > 4) {
    throw new Error(`最多支持 4 张参考图,实际传入 ${input.images.length} 张`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    model: IMAGE_MODEL,
    prompt: input.editPrompt,
    num_inference_steps: DEFAULT_INFERENCE_STEPS,
    guidance_scale: DEFAULT_GUIDANCE_SCALE,
  };
  if (input.negativePrompt) body.negative_prompt = input.negativePrompt;
  if (input.seed !== undefined) body.seed = input.seed;
  const fieldNames = ["image", "image2", "image3", "image4"];
  input.images.forEach((img, i) => {
    body[fieldNames[i]] = img;
  });

  try {
    const r = await fetch(`${SILICONFLOW_BASE.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok || !data?.images?.length) {
      console.error("[siliconflow] generate failed", r.status, JSON.stringify(data).slice(0, 500));
      // 把 API 的真实原因透传给用户界面,而不是笼统的"生成失败"
      const friendly =
        data?.code === 30001
          ? "硅基流动账户余额不足，请充值后重试"
          : `生成接口错误：${data?.message || `HTTP ${r.status}`}`;
      return { error: friendly };
    }
    return { url: data.images[0].url, seed: data.seed };
  } catch (e) {
    console.error("[siliconflow] generate error", e);
    return { error: "网络异常，请求生图服务失败" };
  }
}

// 带 1 次重试的单格生成(对齐 PRD "失败自动重试1次,不扣额度" 的设计精神,
// 这里简化为 HTTP/超时失败重试,不做 ArcFace 一致性检测,该能力列为 P1)。
export async function generateImageWithRetry(
  input: GenerateImageInput,
  maxRetries = 1
): Promise<GenerateImageResult> {
  let last: GenerateImageResult = { error: "生成失败(已重试)" };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await generateImage(input);
    if (result.url) return result;
    last = result;
    // 余额不足/缺key这类确定性错误,重试也不会成功
    if (result.error?.includes("余额不足") || result.error?.includes("API_KEY")) break;
  }
  return last;
}

// 把参考图 URL 统一解析成硅基流动接口可用的形式:
// - data: URL(用户上传照片,浏览器 FileReader 转的 base64)-> 原样透传
// - http(s):// 绝对地址(将来接对象存储后)-> 原样透传
// - "/xxx" 本地相对路径(public/ 下的系统占位头像)-> 服务端直接读文件转 base64,
//   因为硅基流动服务端访问不到 localhost,不能简单拼 origin 当绝对 URL。
export async function resolveImageUrl(url: string): Promise<string> {
  if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  if (url.startsWith("/")) {
    const filePath = path.join(process.cwd(), "public", url);
    const buf = await readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase() || "png";
    const mime = ext === "jpg" ? "jpeg" : ext;
    return `data:image/${mime};base64,${buf.toString("base64")}`;
  }
  return url;
}

// 简单并发限制器:限制同时在途请求数,避免打满硅基流动限流。
export async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
