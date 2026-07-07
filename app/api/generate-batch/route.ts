import { NextResponse } from "next/server";
import { runImageEditPrompt, offlineImageEditPrompt, type ImageEditPromptResult } from "@/lib/imageEditPrompt";
import { mapWithConcurrencyLimit, resolveImageUrl } from "@/lib/siliconflow";
import { generateImageWithRetry, hasImageProviderKey, providerRefLimit } from "@/lib/imageProvider";
import { resolveSlots, appendFeedbackRef } from "@/lib/imageSlots";
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

type PanelResult = {
  panelId: number;
  status: "done" | "error";
  imageUrl?: string;
  editPrompt?: string;
  notes?: string;
  // 服务端内部持有的第1格原始成图 URL(签名 http URL),用于回喂后续格。不返回给前端。
  rawUrl?: string;
};

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
  // 门禁按供应商检查对应 key(走 ark 就查 ARK_API_KEY),避免只配了方舟 key 时被误判未配置
  const hasImageKey = hasImageProviderKey();
  const refLimit = providerRefLimit();

  // 单格生成闭包。feedbackImages 为第1格成图等回喂参考图(可空);
  // feedbackBaseSlot 告诉生图指令 Agent 回喂图在参考图数组里的编号(规则16),0 表示不回喂。
  async function genOnePanel(panel: Panel, feedbackImages: string[]): Promise<PanelResult> {
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
    const effectiveChars = inPanel.length > 0 ? inPanel : characters.slice(0, MAX_REF_CHARS);

    // 先解析角色图,才能算出回喂基准图的编号(排在角色图之后)。
    // 但 editResult 需要 feedbackBaseSlot 才能生成——存在鸡生蛋:回喂图编号依赖角色图数,
    // 角色图数依赖 editResult.imageSlots。解法:用"选中角色数"作为角色图数的稳妥上界估计,
    // resolveSlots 实际解析后若数量不同,再对齐(见下)。这里先按 effectiveChars 估算基准槽位。
    const estimatedCharSlots = Math.min(effectiveChars.length, refLimit);
    const feedbackBaseSlot = feedbackImages.length > 0 ? estimatedCharSlots + 1 : 0;

    const promptInput = {
      storySummary,
      panel,
      characters: effectiveChars,
      unmatchedCharacters,
      styleLabel,
      styleAnchor,
      styleReferenceImageKey,
      aspectRatio,
      layoutTemplate,
      feedbackBaseSlot,
    };
    const editResult: ImageEditPromptResult = hasLLM
      ? (await runImageEditPrompt(promptInput)) || offlineImageEditPrompt(promptInput)
      : offlineImageEditPrompt(promptInput);

    if (editResult.blocked || !editResult.editPrompt) {
      return { panelId: panel.panelId, status: "error", notes: editResult.notes || "内容未通过安全审核" };
    }

    if (!hasImageKey) {
      return { panelId: panel.panelId, status: "error", notes: "未配置生图 API Key" };
    }

    // 阶段二:解析 imageSlots -> 真实角色参考图,并修正 editPrompt 图片编号(P0-1 修编号错位)。
    const { images: charImages, editPrompt } = await resolveSlots(
      editResult.imageSlots,
      characters,
      editResult.editPrompt,
      resolveImageUrl,
      refLimit,
      feedbackImages.length // 稍后会追加的回喂基准图数,让自检不误报"图2越界"
    );

    if (charImages.length === 0 && effectiveChars.length > 0) {
      const missing = effectiveChars.filter((c) => c.referenceImages.length === 0).map((c) => c.name);
      return {
        panelId: panel.panelId,
        status: "error",
        notes: missing.length ? `角色缺少参考图: ${missing.join("、")}(请上传照片或使用系统默认头像)` : "无可用参考图",
      };
    }
    if (charImages.length === 0) {
      return { panelId: panel.panelId, status: "error", notes: "本格无角色且无画风参考图,暂不支持纯文生图" };
    }

    // 回喂图拼在角色图之后 + 校正 editPrompt 里规则16 的基准图编号(角色身份锚不可裁,回喂锚可裁)
    const { images, editPrompt: finalEditPrompt } = appendFeedbackRef(
      charImages,
      feedbackImages,
      editPrompt,
      feedbackBaseSlot,
      refLimit
    );

    const gen = await generateImageWithRetry({
      editPrompt: finalEditPrompt,
      negativePrompt: editResult.negativePrompt,
      images,
      aspectRatio,
    });
    if (!gen.url) return { panelId: panel.panelId, status: "error", notes: gen.error || "生成失败(已重试)" };
    return { panelId: panel.panelId, status: "done", imageUrl: gen.url, editPrompt: finalEditPrompt, rawUrl: gen.url };
  }

  // P0-2 编排:第1格串行先出(它是全篇画风基准,自身无回喂)→ 拿它的原始成图 URL →
  // 作为额外参考图回喂给第2..N格(并发)。第1格失败则后续格回落纯文字模式,不阻断整批。
  const first = await genOnePanel(panels[0], []);
  // resolveImageUrl 对 http URL 原样透传,第1格签名 URL 在几分钟生成窗口内不过期,可直接回喂。
  const baseAnchor = first.rawUrl ? [await resolveImageUrl(first.rawUrl)] : [];
  const rest =
    panels.length > 1
      ? await mapWithConcurrencyLimit(panels.slice(1), CONCURRENCY_LIMIT, (panel) => genOnePanel(panel, baseAnchor))
      : [];

  // 剥掉内部字段 rawUrl,只返回前端需要的形状(前端按 panelId 匹配,不依赖数组顺序)
  const results = [first, ...rest].map((r) => ({
    panelId: r.panelId,
    status: r.status,
    imageUrl: r.imageUrl,
    editPrompt: r.editPrompt,
    notes: r.notes,
  }));
  return NextResponse.json({ results });
}
