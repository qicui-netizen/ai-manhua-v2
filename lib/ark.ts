// 火山方舟(Volcengine ARK)Seedream 图像生成封装。
// 实测结论(2026-07-03,doubao-seedream-4-5-251128):
// - 角色一致性:参考图人物的发色/瞳色/服装/画风保持优秀,优于 Qwen-Image-Edit 基线;
//   注意参考图必须是真实角色图——占位剪影图标会被模型忠实还原成剪影(垃圾进垃圾出)。
// - 原生支持出图尺寸(size 传"宽x高"),3:4 直接出 1728x2304,不再依赖裁剪+构图安全区兜底。
// - image 字段:单图传字符串、多图传数组(最多14张),支持 URL 或 data URL(格式名需小写)。
// - 不支持 negative_prompt / seed / guidance_scale(文档明确 4.5/4.0/5.0-lite 不支持)。
// - 返回的图片 URL 24小时过期,沿用 persistImage 立即转存机制(proxy-image 不限外部域名)。
// - key 权限踩坑:方舟 API Key 可限定可调用模型范围,新开通模型后旧 key 可能仍 403,
//   需在控制台给 key 补授权(AccessDenied ≠ 未开通,ModelNotOpen 才是未开通)。
import type { GenerateImageInput, GenerateImageResult } from "./siliconflow";

const ARK_BASE = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const ARK_IMAGE_MODEL = process.env.ARK_IMAGE_MODEL || "doubao-seedream-4-5-251128";

// 平台比例 → Seedream 官方推荐宽高档位(2K 档)。exporter 全部布局的单格比例只有 3:4 与 1:1。
function arkSizeForRatio(ratio?: string): string {
  if (ratio === "1:1") return "2048x2048";
  if (ratio === "4:3") return "2304x1728";
  if (ratio === "3:4" || ratio === "竖向长图") return "1728x2304";
  return "2048x2048";
}

export async function generateImageArk(input: GenerateImageInput): Promise<GenerateImageResult> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) return { error: "未配置 ARK_API_KEY" };
  if (input.images.length > 14) {
    throw new Error(`Seedream 最多支持 14 张参考图,实际传入 ${input.images.length} 张`);
  }

  // Seedream 无 negative_prompt 参数,负向约束折叠进正向提示词表达
  const prompt = input.negativePrompt
    ? `${input.editPrompt}。画面中避免出现:${input.negativePrompt}`
    : input.editPrompt;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    model: ARK_IMAGE_MODEL,
    prompt,
    sequential_image_generation: "disabled", // 单格单图,组图能力暂不使用
    response_format: "url",
    size: arkSizeForRatio(input.aspectRatio),
    // 模型级水印关闭:每格素材带水印会在 4/9 格拼图里重复出现;
    // AI 生成显式标识由导出层 aiBadge 统一加盖(lib/exporter.ts),合规口径不变
    watermark: false,
  };
  if (input.images.length === 1) body.image = input.images[0];
  else if (input.images.length > 1) body.image = input.images;

  try {
    const r = await fetch(`${ARK_BASE.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok || !data?.data?.length || !data.data[0]?.url) {
      console.error("[ark] generate failed", r.status, JSON.stringify(data).slice(0, 500));
      const code = data?.error?.code || "";
      const friendly =
        code === "ModelNotOpen"
          ? "火山方舟账号未开通该图像模型,请在方舟控制台开通"
          : code === "AccessDenied"
            ? "方舟 API Key 无权调用该模型,请在控制台给 Key 补授权"
            : `生成接口错误:${data?.error?.message || `HTTP ${r.status}`}`;
      return { error: friendly };
    }
    return { url: data.data[0].url };
  } catch (e) {
    console.error("[ark] generate error", e);
    return { error: "网络异常，请求生图服务失败" };
  }
}
