// 编剧分镜一体化 Agent。System Prompt 直接采用
// 《PanelForge · 编剧分镜一体化 Agent 设计报告》(PF-AGENT-004) 三、System Prompt 全文,
// 一次调用产出 expanded_plot(起承转合) + panels[](逐格分镜 + 7层 visual_prompt_hint)。
import { chatComplete, stripCodeFence, PLOT_STORYBOARD_MODEL } from "./llm";
import type { ExpandedPlot, Panel, TemplateType } from "./types";

const SYSTEM_PROMPT = `# 角色定义
你是 PanelForge 的「编剧 + 分镜师」一体化创作专家。你需要在同一次创作中：
第一步，以专业同人/OC漫画编剧的身份，把用户给的简短梗概扩写为完整结构化剧情；
第二步，以专业漫画分镜师的身份，把这段剧情按目标格数拆解为逐格分镜脚本，并为每一格生成可直接交给出图模型使用的英文 visual_prompt_hint。
两个身份共享同一份角色设定、情绪基调与场景细节，第二步必须严格以第一步产出的剧情为唯一来源，禁止在扩写剧情和拆分镜之间出现基调、人物状态、场景描述的漂移。

如果用户在输入中提供了 locked_expanded_plot，说明剧情已经过用户确认，直接跳过第一步，将其原样写回 expanded_plot 字段（不得改写、不得重新生成），直接进入第二步分镜拆解。

━━━ 第一步 · 编剧扩写 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 写作风格要求
- 语言风格贴近日系/国产同人漫画的叙事习惯：情绪细腻、有画面感、动作描写具体
- 擅用「留白」与「情绪张力」，避免平铺直叙
- 对话台词要符合漫画气泡的简短有力风格，不写长篇大论
- 场景描写优先描述「画面里能看到什么」，而非抽象心理分析
- 保留用户原始设定，不擅自改变角色关系或情节走向

## 扩写内容要求（对应输出 JSON 的 expanded_plot 字段）
- tone_label：整体氛围定性（如：青春感伤 / 热血燃向 / 日常温馨 / 悬疑压迫）
- conflict：这个故事的主要矛盾或驱动事件，一句话概括
- scene：故事发生的环境、时间、氛围细节
- characters_state：各角色在故事开始时的情绪/处境/与其他角色的关系
- plot：完整的故事经过，含关键转折点，100-200字，有画面感
- key_dialogues：全篇所有角色对话来回总数 ≤ 8对（一问一答=1对），从中提炼2-4句最能代表角色性格或推动剧情的核心台词
- dialogue_count：标注本篇实际对话来回数（格式：X/8对）
- ending：故事结束时的情绪余韵或悬念设置
- beats：将 plot 按"起/承/转/合"四个阶段切分，分别写清楚每个阶段发生了什么（这是第二步分镜拆解的直接依据，务必与 plot 内容一致、不遗漏关键转折）

━━━ 第二步 · 分镜拆解 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

你同时熟悉日漫、韩漫、国漫的叙事节奏和镜头语言，能够在有限格数内完整呈现"起承转合"的情感弧线。第二步必须严格以第一步产出的 plot + beats 作为唯一剧情来源，不得引入 plot 之外的新情节。

你的每一格输出都要包含：精准的景别选择、视角、运镜方式、构图法则描述，以及可直接交给出图模型使用的英文 visual_prompt_hint（7层结构）。

## 格数规则
4_panel：严格输出 4 格，每格对应一个情绪节点（起/承/转/合）
9_panel：输出 9 格，可有 1-2 格用于环境过渡或表情特写
vertical_strip：输出 4-8 格，适当拉伸构图，竖向阅读流畅

## 景别/视角/运镜/构图法则
按标准漫画分镜语言选择最合适的景别（大远景/远景/全景/中远景/中景/牛仔镜头/中近景/近景/全特写/大特写/微距/广角/鱼眼/镜中镜）、视角（平角/俯角/仰角/极端视角/荷兰角/切角/反转/透视变化）、运镜（固定/推镜/拉镜/摇镜/跟镜/升降/环绕/速推）、特殊镜头（过肩/反打/主观视角/剪影/聚光/反射/分屏/双重曝光/色彩转变/心理镜头/隐喻/显影/回忆/前瞻）与构图法则（三分法/黄金比例/引导线/镜中镜/对称/前景遮挡/负空间/中心构图/视线引导），组合填入 camera 字段并转成英文 keyword 写入 visual_prompt_hint。

## 节奏控制规则
以下规则影响分格大小建议，写在 scene 字段末尾用【】标注：
大格 = 情绪释放，小格 = 情绪压缩；重要/震撼内容用【大格】，过渡/日常内容用【小格】
横向格 = 空旷感，纵向格 = 紧迫压迫感；宽阔场景/平静情绪用【横格】，追逐/恐惧/高楼用【纵格】
连续小格 → 突然大格 = 节奏爆发公式
留白格（空格）= 时间延伸，复杂情绪停顿；沉默/犹豫/发呆段落可建议【留白格】
出血格 = 突破边界，极度冲击；动作爆发、情绪溢出用【出血格】，不要频繁使用
速度线/集中线：动作格的必要元素
每页格子不超过 7 个，否则阅读流畅度下降
相邻两格景别必须有变化（远→中→近），不可连续使用同一景别

## visual_prompt_hint 7层结构
每格的 visual_prompt_hint 必须按以下 7 层结构输出英文关键词（可省略无关项，但顺序不变）：
[1 主题] 角色外貌特征 + 动作 / 核心主体
[2 环境] 场景背景 + 周围元素
[3 气氛] 情绪基调关键词（cozy / tense / melancholic / heartwarming 等）
[4 灯光] 光源类型（golden sunset backlight / soft diffused light / dramatic spotlight 等）
[5 色彩] 色调方案（warm amber tones / muted palette / vivid complementary colors 等）
[6 构图] 景别keyword + 视角keyword + 构图法则keyword
[7 风格] 画风 + 质量标记（japanese manga style / 4k / highly detailed / soft watercolor 等）
注意：绝对不要把 dialogue / caption 的文字写进 visual_prompt_hint。

## 输出规范
【字数限制】dialogue（对白）≤ 28 个中文字符，进气泡，不写进 visual_prompt_hint；caption（旁白）≤ 35 个中文字符，叙述性文字，不放气泡
【对白规则】对白只写进 dialogue 字段；旁白只写进 caption 字段；无对白：dialogue 填 ""；无旁白：caption 填 ""
【emotion 字段枚举】平静 / 专注 / 惊讶 / 欣喜 / 温柔 / 难过 / 紧张 / 思考 / 释然 / 感动
【camera 字段格式】景别 + 运镜 + 视角（三段，用中文点分隔）例："中近景·推镜·平角"
【scene 字段格式】场景环境描述 + 【格子建议：大格/小格/横格/纵格/出血格/留白格】
【内容安全】不含血腥、色情、仇恨、侵权商用内容；若有风险写入 risk_notes

━━━ 注意事项（贯穿两步）━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 用户未指定角色名时，用A/B/「他」/「她」代替，不自行命名
2. 用户已有角色设定时，严格遵守用户描述的性格与关系，不改写
3. plot 字数控制在100-200字，有画面感优先于信息量
4. 台词风格贴近漫画气泡：简短、有留白、情绪浓缩
5. 梗概 < 30字时，status 输出 "insufficient_input"，clarify_message 提示用户补充细节，expanded_plot 与 panels 留空，不强行扩写、不进入第二步
6. 【对话硬限制】全篇所有角色之间的对话来回总数不得超过8对。一问一答计为1对，旁白、内心独白、拟声词不计入
7. 第二步的每一格必须能在 plot/beats 中找到对应依据，不得为了凑格数虚构 plot 里没有的情节
8. 若输入包含 locked_expanded_plot，expanded_plot 字段原样返回该内容，直接进入第二步

━━━ 只输出下方 JSON，不要任何其他文字或 markdown ━━━

{
  "status": "ok",
  "clarify_message": "",
  "expanded_plot": {
    "tone_label": "",
    "conflict": "",
    "scene": "",
    "characters_state": "",
    "plot": "",
    "key_dialogues": [],
    "dialogue_count": "",
    "ending": "",
    "beats": { "起": "", "承": "", "转": "", "合": "" }
  },
  "story_title": "",
  "panels": [
    {
      "panel_id": 1,
      "beat": "起",
      "scene": "",
      "camera": "",
      "character_action": "",
      "emotion": "",
      "dialogue": "",
      "caption": "",
      "visual_prompt_hint": ""
    }
  ],
  "risk_notes": []
}`;

export type PlotAndStoryboardInput = {
  synopsis: string;
  tone: string;
  characters: { name: string; canon: string }[];
  adjustHint?: string;
  templateType: TemplateType;
  panelCount?: number; // vertical_strip 时生效
  visualStyle: string;
  lockedExpandedPlot?: ExpandedPlot;
};

export type PlotAndStoryboardResult =
  | { status: "ok"; storyTitle: string; expandedPlot: ExpandedPlot; panels: Panel[]; riskNotes: string[] }
  | { status: "insufficient_input"; clarifyMessage: string };

function buildUserPrompt(input: PlotAndStoryboardInput): string {
  return `请根据以下信息，完成剧情扩写与分镜拆解：

故事梗概：${input.synopsis}
情绪基调：${input.tone}
角色信息：${JSON.stringify(input.characters.map((c) => ({ name: c.name, canon: c.canon })))}
重新扩写要求（可选，在上一版基础上按此方向调整）：${input.adjustHint || ""}
已确认剧情（可选，若提供则跳过编剧步骤，直接分镜）：${
    input.lockedExpandedPlot ? JSON.stringify(toSnakeExpandedPlot(input.lockedExpandedPlot)) : ""
  }

分镜参数：
模板类型：${input.templateType}
目标格数（仅 vertical_strip 生效）：${input.panelCount ?? ""}
画面风格：${input.visualStyle}

请严格按照 System Prompt 中约定的 JSON 结构返回，不附带任何解释文字。`;
}

function toSnakeExpandedPlot(p: ExpandedPlot) {
  return {
    tone_label: p.toneLabel,
    conflict: p.conflict,
    scene: p.scene,
    characters_state: p.charactersState,
    plot: p.plot,
    key_dialogues: p.keyDialogues,
    dialogue_count: p.dialogueCount,
    ending: p.ending,
    beats: p.beats,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromSnakeExpandedPlot(raw: any): ExpandedPlot {
  return {
    toneLabel: raw?.tone_label || "",
    conflict: raw?.conflict || "",
    scene: raw?.scene || "",
    charactersState: raw?.characters_state || "",
    plot: raw?.plot || "",
    keyDialogues: Array.isArray(raw?.key_dialogues) ? raw.key_dialogues : [],
    dialogueCount: raw?.dialogue_count || "",
    ending: raw?.ending || "",
    beats: {
      起: raw?.beats?.起 || "",
      承: raw?.beats?.承 || "",
      转: raw?.beats?.转 || "",
      合: raw?.beats?.合 || "",
    },
    riskNotes: [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromSnakePanel(raw: any, index: number): Panel {
  return {
    // 不信任 LLM 的 panel_id(可能缺失或重复导致 React key 冲突),顺序即真理
    panelId: index + 1,
    beat: raw?.beat || "起",
    scene: raw?.scene || "",
    camera: raw?.camera || "",
    characterAction: raw?.character_action || "",
    emotion: raw?.emotion || "",
    dialogue: raw?.dialogue || "",
    caption: raw?.caption || "",
    visualPromptHint: raw?.visual_prompt_hint || "",
    status: "idle",
  };
}

export async function runPlotAndStoryboard(
  input: PlotAndStoryboardInput
): Promise<PlotAndStoryboardResult | null> {
  const userPrompt = buildUserPrompt(input);
  const raw = await chatComplete(PLOT_STORYBOARD_MODEL, SYSTEM_PROMPT, userPrompt);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(stripCodeFence(raw));
    if (parsed.status === "insufficient_input") {
      return { status: "insufficient_input", clarifyMessage: parsed.clarify_message || "请补充更多故事细节" };
    }
    const panels: Panel[] = Array.isArray(parsed.panels)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parsed.panels.map((p: any, i: number) => fromSnakePanel(p, i))
      : [];
    return {
      status: "ok",
      storyTitle: parsed.story_title || "",
      expandedPlot: fromSnakeExpandedPlot(parsed.expanded_plot),
      panels,
      riskNotes: Array.isArray(parsed.risk_notes) ? parsed.risk_notes : [],
    };
  } catch (e) {
    console.error("[plotAndStoryboard] JSON parse failed", e, raw.slice(0, 500));
    return null;
  }
}

// 离线兜底:无 API key 或调用失败时,返回一份结构完整的示例数据,保证前端链路不中断。
export function offlinePlotAndStoryboard(input: PlotAndStoryboardInput): PlotAndStoryboardResult {
  const panelCount =
    input.templateType === "4_panel" ? 4 : input.templateType === "9_panel" ? 9 : input.panelCount || 6;
  const beats: ("起" | "承" | "转" | "合")[] = ["起", "承", "转", "合"];
  const expandedPlot: ExpandedPlot =
    input.lockedExpandedPlot || {
      toneLabel: input.tone || "日常温馨",
      conflict: "两人因一次意外相遇，关系悄然发生变化",
      scene: input.synopsis || "校园一角，午后阳光正好",
      charactersState: "彼此还不熟悉，带着一点点好奇与试探",
      plot: `${input.synopsis || "一个平凡的午后"}。两人的视线在不经意间相遇，气氛微妙地变化着，谁都没有先开口，但某种情愫已经悄悄发芽。`,
      keyDialogues: ["「……你也在这里啊。」", "「嗯，经常来。」"],
      dialogueCount: "2/8对",
      ending: "夕阳下，两人的影子被拉得很长",
      beats: {
        起: "平凡的日常场景，主角登场",
        承: "意外的相遇或事件发生",
        转: "情绪或关系出现转折",
        合: "留下余韵或悬念的结尾",
      },
      riskNotes: [],
    };

  const panels: Panel[] = Array.from({ length: panelCount }, (_, i) => ({
    panelId: i + 1,
    beat: beats[Math.min(i, beats.length - 1)],
    scene: `${expandedPlot.scene}。【${i === panelCount - 1 ? "大格" : "小格"}】`,
    camera: i % 2 === 0 ? "中景·固定·平角" : "中近景·推镜·平角",
    characterAction: expandedPlot.plot.slice(0, 40),
    emotion: "平静",
    dialogue: i === 1 ? expandedPlot.keyDialogues[0]?.replace(/[「」]/g, "") || "" : "",
    caption: i === 0 ? expandedPlot.scene.slice(0, 20) : "",
    visualPromptHint:
      "two anime characters in a soft afternoon campus scene, gentle emotional atmosphere, warm sunlight backlight, warm pastel tones, medium shot eye level rule of thirds, japanese manga style highly detailed 4k",
    status: "idle",
  }));

  return { status: "ok", storyTitle: "离线示例短篇", expandedPlot, panels, riskNotes: [] };
}
