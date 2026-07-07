import { NextResponse } from "next/server";
import { runImageEditPrompt, offlineImageEditPrompt } from "@/lib/imageEditPrompt";
import { resolveImageUrl } from "@/lib/siliconflow";
import { generateImageWithRetry, hasImageProviderKey, providerRefLimit } from "@/lib/imageProvider";
import { resolveSlots, appendFeedbackRef } from "@/lib/imageSlots";
import { hasKey, IMAGE_EDIT_PROMPT_MODEL } from "@/lib/llm";
import { rateLimit } from "@/lib/apiGuard";
import type { Panel, Character } from "@/lib/types";

type GeneratePanelBody = {
  storySummary: string;
  panel: Panel;
  characters: Character[];
  styleLabel: string;
  styleAnchor: string; // 黄金英文风格锚,单格重抽同样钉在结尾,保证与全篇一致
  // 剧情提到但用户未建角色卡的人物,带固定外貌锚,单格重抽同样传给生图指令 Agent 规则14
  unmatchedCharacters?: { name: string; appearanceAnchor: string }[];
  styleReferenceImageKey?: string;
  aspectRatio: string;
  layoutTemplate: string;
  adjustHint?: string; // 用户对上一次成图的修正要求(可选,≤50字)
  // P0-3(预留):第1格成图的已 persist data URL,前端从 project.panels[0].imageUrl 取。
  // 传入则回喂作全篇画风基准(规则16),让重抽的格也与全篇画风对齐;不传则维持现状。
  baseAnchorImageUrl?: string;
};

// 单格重抽,对应"重新生成"按钮。
export async function POST(req: Request) {
  const limited = rateLimit(req, "image", 1);
  if (limited) {
    return NextResponse.json({ status: "error", notes: limited }, { status: 429 });
  }
  const body = (await req.json()) as GeneratePanelBody;
  const { storySummary, panel, characters, styleLabel, styleAnchor, unmatchedCharacters, styleReferenceImageKey, aspectRatio, layoutTemplate, baseAnchorImageUrl } = body;
  const adjustHint = (body.adjustHint || "").trim().slice(0, 50);

  const refLimit = providerRefLimit();
  // 有回喂基准图时,基准图排在角色图之后;角色图数以选中角色数估算(与 batch 同口径)
  const hasFeedback = !!baseAnchorImageUrl;
  const estimatedCharSlots = Math.min(characters.length, refLimit);
  const feedbackBaseSlot = hasFeedback ? estimatedCharSlots + 1 : 0;

  const promptInput = {
    storySummary,
    panel,
    characters,
    unmatchedCharacters,
    styleLabel,
    styleAnchor,
    styleReferenceImageKey,
    aspectRatio,
    layoutTemplate,
    adjustHint,
    feedbackBaseSlot,
  };
  const hasLLM = hasKey(IMAGE_EDIT_PROMPT_MODEL);
  const editResult = hasLLM
    ? (await runImageEditPrompt(promptInput)) || offlineImageEditPrompt(promptInput)
    : offlineImageEditPrompt(promptInput);

  if (editResult.blocked || !editResult.editPrompt) {
    return NextResponse.json({ panelId: panel.panelId, status: "error", notes: editResult.notes || "内容未通过安全审核" });
  }
  // 门禁按供应商检查对应 key(走 ark 就查 ARK_API_KEY)
  if (!hasImageProviderKey()) {
    return NextResponse.json({ panelId: panel.panelId, status: "error", notes: "未配置生图 API Key" });
  }

  // 解析角色参考图并修正 editPrompt 图片编号(P0-1 修编号错位)
  const { images: charImages, editPrompt } = await resolveSlots(
    editResult.imageSlots,
    characters,
    editResult.editPrompt,
    resolveImageUrl,
    refLimit,
    baseAnchorImageUrl ? 1 : 0 // 稍后会追加的回喂基准图数,让自检不误报
  );
  if (charImages.length === 0) {
    const missing = characters.filter((c) => c.referenceImages.length === 0).map((c) => c.name);
    return NextResponse.json({
      panelId: panel.panelId,
      status: "error",
      notes: missing.length ? `角色缺少参考图: ${missing.join("、")}` : "无可用参考图",
    });
  }

  // 回喂基准图拼在角色图之后 + 校正 editPrompt 里规则16 的图号
  const feedbackImages = baseAnchorImageUrl ? [await resolveImageUrl(baseAnchorImageUrl)] : [];
  const { images, editPrompt: finalEditPrompt } = appendFeedbackRef(charImages, feedbackImages, editPrompt, feedbackBaseSlot, refLimit);

  const gen = await generateImageWithRetry({ editPrompt: finalEditPrompt, negativePrompt: editResult.negativePrompt, images, aspectRatio });
  if (!gen.url) return NextResponse.json({ panelId: panel.panelId, status: "error", notes: gen.error || "生成失败(已重试)" });
  return NextResponse.json({ panelId: panel.panelId, status: "done", imageUrl: gen.url, editPrompt: finalEditPrompt });
}
