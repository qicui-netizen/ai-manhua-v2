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
  "gender_age": "性别与年龄感,如'少女,16-18岁',无人物则空字符串",
  "signature_features": "最能把这个角色和别人区分开的1-3个独特标记,越具体越好(如'左眼下方一颗泪痣、总戴红色围巾、右耳三个耳骨钉、左脸一道疤')。挑真正有辨识度、别的角色不太会撞的细节,不要写'黑头发'这种大众特征。用中文,逗号分隔;若图中无人物或无明显特征则空字符串",
  "identity": "用于判断多张图是不是同一个人的身份指纹,一句话:性别+大致年龄+脸型+发型发色+最显著的辨识特征(如'男性,30多岁,方脸,黑色背头,浓眉');无人物则空字符串"
}`;

import { rateLimit } from "@/lib/apiGuard";

export async function POST(req: Request) {
  const limited = rateLimit(req, "llm", 1);
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });

  const body = (await req.json()) as { imageDataUrl?: string; compareWith?: string };
  if (!body.imageDataUrl?.startsWith("data:image/")) {
    return NextResponse.json({ error: "imageDataUrl 必须是图片 data URL" }, { status: 400 });
  }
  // compareWith:已上传首图的身份指纹。传入时让 VLM 顺带判断本图与首图是否同一人,
  // 用于建角色页提示"你可能把不同的人塞进了一个角色卡"(做CP应分别建角色)
  const compareWith = typeof body.compareWith === "string" ? body.compareWith.trim().slice(0, 200) : "";
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
              {
                type: "text",
                text: compareWith
                  ? `${ANALYZE_PROMPT}\n\n另外,已有一张参考图里的人物特征是:「${compareWith}」。请判断本图中的人物与这个特征描述是否是同一个人,在 JSON 里追加字段 "same_as_compare": true 或 false(明显不是同一个人时为 false,如性别不同、年龄段差很大、脸型发型完全不同;拿不准时为 true 从宽)。`
                  : ANALYZE_PROMPT,
              },
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
      signatureFeatures: typeof parsed.signature_features === "string" ? parsed.signature_features : "",
      identity: typeof parsed.identity === "string" ? parsed.identity : "",
      // 仅在传入 compareWith 时有意义:false=本图与首图明显不是同一人。默认 true 从宽,避免误伤
      sameAsCompare: compareWith ? parsed.same_as_compare !== false : true,
    });
  } catch (e) {
    console.error("[analyze-image] error", e);
    return NextResponse.json({ error: "图片解析失败" }, { status: 502 });
  }
}
