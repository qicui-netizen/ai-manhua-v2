import { NextResponse } from "next/server";
import { stripCodeFence } from "@/lib/llm";

// 角色参考图智能解析:用视觉模型提取"画风 + 人物外貌特征",
// 自动填充角色卡的外貌描述,省去用户手写人设(可编辑)。
// 用小尺寸 VLM(Qwen3-VL-8B),单次约几分钱,仅在用户上传主图时调用一次。
const VLM_MODEL = process.env.MODERATION_VL_MODEL || "Qwen/Qwen3-VL-8B-Instruct";
const SILICONFLOW_BASE = process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1";

const ANALYZE_PROMPT = `你是漫画角色设定师。分析这张角色参考图,提取可用于AI绘画保持角色一致性的信息。
只输出 JSON(不要代码块围栏):
{
  "style": "画风归类,一句话(如:日系动漫/写实照片/水彩插画/3D渲染/像素风等)",
  "appearance": "人物外貌特征,60字内中文:发色发型、瞳色、服装、年龄感、气质;若图中无人物则描述画面主体",
  "gender_age": "性别与年龄感,如'少女,16-18岁',无人物则空字符串"
}`;

import { rateLimit } from "@/lib/apiGuard";

export async function POST(req: Request) {
  const limited = rateLimit(req, "llm", 1);
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });

  const body = (await req.json()) as { imageDataUrl?: string };
  if (!body.imageDataUrl?.startsWith("data:image/")) {
    return NextResponse.json({ error: "imageDataUrl 必须是图片 data URL" }, { status: 400 });
  }
  if (body.imageDataUrl.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "图片过大" }, { status: 413 });
  }
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "未配置 SILICONFLOW_API_KEY" }, { status: 503 });

  try {
    const r = await fetch(`${SILICONFLOW_BASE.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: VLM_MODEL,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: body.imageDataUrl } },
              { type: "text", text: ANALYZE_PROMPT },
            ],
          },
        ],
      }),
    });
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!r.ok || typeof raw !== "string") {
      console.error("[analyze-image] vlm failed", r.status, JSON.stringify(data).slice(0, 300));
      return NextResponse.json({ error: "图片解析暂不可用" }, { status: 502 });
    }
    const parsed = JSON.parse(stripCodeFence(raw));
    return NextResponse.json({
      style: typeof parsed.style === "string" ? parsed.style : "",
      appearance: typeof parsed.appearance === "string" ? parsed.appearance : "",
      genderAge: typeof parsed.gender_age === "string" ? parsed.gender_age : "",
    });
  } catch (e) {
    console.error("[analyze-image] error", e);
    return NextResponse.json({ error: "图片解析失败" }, { status: 502 });
  }
}
