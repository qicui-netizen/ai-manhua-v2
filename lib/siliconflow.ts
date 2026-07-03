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
  // 目标平台比例("3:4"/"1:1"/"竖向长图")。硅基流动路径忽略(见下方已验证事实),
  // 方舟 Seedream 路径用它映射原生出图尺寸(lib/ark.ts)
  aspectRatio?: string;
};

// ⚠️ 出图比例的已验证事实(2026-07-02 实测 + 官方文档,不要盲目重加 image_size):
// - image_size 参数对 Qwen-Image-Edit-2509 不支持(docs.siliconflow.cn 原文
//   "Qwen/Qwen-Image-Edit-2509 and Qwen-Image-Edit not support this field"),传了会被静默忽略;
// - 出图比例跟随输入参考图比例(512x512 入→1024x1024 出;768x1024 入→880x1176 出);
// - 把参考图垫白边成目标比例不可行:实测边框会被当作画面内容复刻进成图。
// 当前缓解:生图指令 Agent 在 editPrompt 里追加构图安全区约束(见 imageEditPrompt 规则10),
// 让居中裁剪不切人。结构性解法(支持尺寸的模型/出图后外扩)列入路线图。

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

// 带重试的调用入口已上移到 lib/imageProvider.ts(供应商切换层),本文件只保留硅基流动的裸实现。

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
