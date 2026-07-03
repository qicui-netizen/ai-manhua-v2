import { NextResponse } from "next/server";
import { runImageEditPrompt, offlineImageEditPrompt } from "@/lib/imageEditPrompt";
import { generateImageWithRetry, resolveImageUrl } from "@/lib/siliconflow";
import { hasKey, IMAGE_EDIT_PROMPT_MODEL } from "@/lib/llm";
import type { Panel, Character } from "@/lib/types";

type GeneratePanelBody = {
  storySummary: string;
  panel: Panel;
  characters: Character[];
  styleLabel: string;
  styleReferenceImageKey?: string;
  aspectRatio: string;
  layoutTemplate: string;
  adjustHint?: string; // 用户对上一次成图的修正要求(可选,≤50字)
};

// 单格重抽,对应"重新生成"按钮。
export async function POST(req: Request) {
  const body = (await req.json()) as GeneratePanelBody;
  const { storySummary, panel, characters, styleLabel, styleReferenceImageKey, aspectRatio, layoutTemplate } = body;
  const adjustHint = (body.adjustHint || "").trim().slice(0, 50);

  const promptInput = { storySummary, panel, characters, styleLabel, styleReferenceImageKey, aspectRatio, layoutTemplate, adjustHint };
  const hasLLM = hasKey(IMAGE_EDIT_PROMPT_MODEL);
  const editResult = hasLLM
    ? (await runImageEditPrompt(promptInput)) || offlineImageEditPrompt(promptInput)
    : offlineImageEditPrompt(promptInput);

  if (editResult.blocked || !editResult.editPrompt) {
    return NextResponse.json({ panelId: panel.panelId, status: "error", notes: editResult.notes || "内容未通过安全审核" });
  }
  if (!process.env.SILICONFLOW_API_KEY) {
    return NextResponse.json({ panelId: panel.panelId, status: "error", notes: "未配置 SILICONFLOW_API_KEY" });
  }

  const images: string[] = [];
  for (const slot of editResult.imageSlots.slice(0, 4)) {
    const char = characters.find((c) => c.id === slot.refKey || c.referenceImages.some((r) => r.id === slot.refKey));
    const refImg = char?.referenceImages.find((r) => r.id === slot.refKey) || char?.referenceImages[0];
    if (refImg?.url) images.push(await resolveImageUrl(refImg.url));
  }
  if (images.length === 0) {
    const missing = characters.filter((c) => c.referenceImages.length === 0).map((c) => c.name);
    return NextResponse.json({
      panelId: panel.panelId,
      status: "error",
      notes: missing.length ? `角色缺少参考图: ${missing.join("、")}` : "无可用参考图",
    });
  }

  const gen = await generateImageWithRetry({ editPrompt: editResult.editPrompt, negativePrompt: editResult.negativePrompt, images });
  if (!gen.url) return NextResponse.json({ panelId: panel.panelId, status: "error", notes: gen.error || "生成失败(已重试)" });
  return NextResponse.json({ panelId: panel.panelId, status: "done", imageUrl: gen.url, editPrompt: editResult.editPrompt });
}
