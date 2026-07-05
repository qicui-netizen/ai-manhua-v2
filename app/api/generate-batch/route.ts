import { NextResponse } from "next/server";
import { runImageEditPrompt, offlineImageEditPrompt } from "@/lib/imageEditPrompt";
import { mapWithConcurrencyLimit, resolveImageUrl } from "@/lib/siliconflow";
import { generateImageWithRetry } from "@/lib/imageProvider";
import { hasKey, IMAGE_EDIT_PROMPT_MODEL } from "@/lib/llm";
import { rateLimit, MAX_PANELS_PER_BATCH } from "@/lib/apiGuard";
import type { Panel, Character } from "@/lib/types";

type GenerateBatchBody = {
  storySummary: string;
  panels: Panel[];
  characters: Character[]; // 项目里涉及的全部角色(按 characterIds 解析出来的)
  styleLabel: string;
  styleAnchor: string; // 黄金英文风格锚,透传给生图指令 Agent 钉在每格结尾
  // 剧情提到但用户未建角色卡的人物(如凭空出现的女主),带固定外貌锚,透传给生图指令 Agent 规则14
  unmatchedCharacters?: { name: string; appearanceAnchor: string }[];
  styleReferenceImageKey?: string;
  aspectRatio: string;
  layoutTemplate: string;
};

// 并发度先按约一半跑(9格先试4-5路),后续依硅基流动实际限流表现调整。
const CONCURRENCY_LIMIT = 4;

export async function POST(req: Request) {
  const body = (await req.json()) as GenerateBatchBody;
  const { storySummary, panels, characters, styleLabel, styleAnchor, unmatchedCharacters, styleReferenceImageKey, aspectRatio, layoutTemplate } = body;

  if (!Array.isArray(panels) || panels.length === 0) {
    return NextResponse.json({ error: "panels 不能为空" }, { status: 400 });
  }
  // 生图是全站唯一真金白银的出口:格数上限 + 每 IP 按格限流,防一个 POST 烧光余额
  if (panels.length > MAX_PANELS_PER_BATCH) {
    return NextResponse.json({ error: `单次最多生成 ${MAX_PANELS_PER_BATCH} 格` }, { status: 400 });
  }
  const limited = rateLimit(req, "image", panels.length);
  if (limited) {
    return NextResponse.json({ error: limited }, { status: 429 });
  }

  const hasLLM = hasKey(IMAGE_EDIT_PROMPT_MODEL);
  const hasImageKey = !!process.env.SILICONFLOW_API_KEY;

  const results = await mapWithConcurrencyLimit(panels, CONCURRENCY_LIMIT, async (panel) => {
    // 阶段一:图像编辑指令构建(便宜且快)。
    // 【多角色同框·CP刚需】曾用 characterAction.includes(name) 逐格筛角色,导致分镜写成单人
    // 镜头的格子只传1人参考图→第二个角色在该格消失/长相跑飞。改为:角色总数≤生图槽位(3人,
    // slot 上限4含画风)时,把全部选中角色的参考图都传给生图指令 Agent,由它按画面决定主次构图,
    // 而非在 route 层就把没被点名的角色硬丢掉——参考图多给不出错,丢角色才出错。
    // 仅当角色数>3(超出可用槽位)才回退到按点名裁剪,保留最相关的。
    const MAX_REF_CHARS = 3;
    const named = characters.filter((c) => panel.characterAction.includes(c.name));
    const inPanel =
      characters.length <= MAX_REF_CHARS
        ? characters // 全传:双人/三人同框稳定保持每个角色长相
        : named.length > 0
        ? named.slice(0, MAX_REF_CHARS) // 超员时按本格点名裁剪
        : characters.slice(0, MAX_REF_CHARS);
    const promptInput = {
      storySummary,
      panel,
      characters: inPanel.length > 0 ? inPanel : characters.slice(0, MAX_REF_CHARS),
      unmatchedCharacters,
      styleLabel,
      styleAnchor,
      styleReferenceImageKey,
      aspectRatio,
      layoutTemplate,
    };
    const editResult = hasLLM
      ? (await runImageEditPrompt(promptInput)) || offlineImageEditPrompt(promptInput)
      : offlineImageEditPrompt(promptInput);

    if (editResult.blocked || !editResult.editPrompt) {
      return { panelId: panel.panelId, status: "error" as const, notes: editResult.notes || "内容未通过安全审核" };
    }

    if (!hasImageKey) {
      // 无图像 key:返回占位状态,前端可展示"离线预览"提示
      return { panelId: panel.panelId, status: "error" as const, notes: "未配置 SILICONFLOW_API_KEY" };
    }

    // 阶段二:解析 imageSlots -> 真实图片(角色参考图/画风参考图),按顺序传入。
    // Qwen-Image-Edit-2509 要求至少 1 张参考图(image 字段必填),不支持零参考图纯文生图,
    // 因此角色若没有任何 referenceImages(既未上传照片、也未分配占位头像)会直接判失败。
    const images: string[] = [];
    for (const slot of editResult.imageSlots.slice(0, 4)) {
      const char = characters.find((c) => c.id === slot.refKey || c.referenceImages.some((r) => r.id === slot.refKey));
      const refImg = char?.referenceImages.find((r) => r.id === slot.refKey) || char?.referenceImages[0];
      if (refImg?.url) images.push(await resolveImageUrl(refImg.url));
    }
    if (images.length === 0 && promptInput.characters.length > 0) {
      const missing = promptInput.characters.filter((c) => c.referenceImages.length === 0).map((c) => c.name);
      return {
        panelId: panel.panelId,
        status: "error" as const,
        notes: missing.length ? `角色缺少参考图: ${missing.join("、")}(请上传照片或使用系统默认头像)` : "无可用参考图",
      };
    }
    if (images.length === 0) {
      return { panelId: panel.panelId, status: "error" as const, notes: "本格无角色且无画风参考图,暂不支持纯文生图" };
    }

    const gen = await generateImageWithRetry({
      editPrompt: editResult.editPrompt,
      negativePrompt: editResult.negativePrompt,
      images,
      aspectRatio,
    });
    if (!gen.url) return { panelId: panel.panelId, status: "error" as const, notes: gen.error || "生成失败(已重试)" };
    return { panelId: panel.panelId, status: "done" as const, imageUrl: gen.url, editPrompt: editResult.editPrompt };
  });

  return NextResponse.json({ results });
}
