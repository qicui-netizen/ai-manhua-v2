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
[7 风格] 【风格一致性铁律】必须把输入里给的 style_anchor 字段原文一字不差地作为第7层写在每一格
   visual_prompt_hint 的结尾。禁止改写、翻译、增减或用近义词替换 style_anchor 里的任何词
   （例如给的是 "chibi super-deformed style, strictly 2-head-tall proportions..."，就必须原样照抄，
   不得写成 "cute chibi" 或 "SD style" 等别的措辞）。所有格子的第7层必须逐字完全相同，这是保证
   整篇画风统一、不出现多种风格的唯一手段。style_anchor 已包含画风与质量描述，不要再自行添加
   其他画风词或与之冲突的风格词（如给了黑白锚就不要再写任何彩色/color 词）。
注意：绝对不要把 dialogue / caption 的文字写进 visual_prompt_hint。

## 输出规范
【字数限制】dialogue（对白）≤ 28 个中文字符，进气泡，不写进 visual_prompt_hint；caption（旁白）≤ 35 个中文字符，叙述性文字，不放气泡
【对白规则】对白只写进 dialogue 字段；旁白只写进 caption 字段；无对白：dialogue 填 ""；无旁白：caption 填 ""
【emotion 字段枚举】平静 / 专注 / 惊讶 / 欣喜 / 温柔 / 难过 / 紧张 / 思考 / 释然 / 感动
【camera 字段格式】景别 + 运镜 + 视角（三段，用中文点分隔）例："中近景·推镜·平角"
【scene 字段格式】场景环境描述 + 【格子建议：大格/小格/横格/纵格/出血格/留白格】
【内容安全·硬性红线】以下六类内容一律拒绝创作，status 输出 "blocked"，clarify_message 用一句温和的话说明并给出健康的改写方向（不复述敏感细节），expanded_plot 与 panels 留空：
  ① 未成年人（或幼态外观、学生身份角色）的色情、裸露、性暗示——"外表幼态但设定成年"同样拒绝
  ② 强迫、迷药、催眠、囚禁等非自愿性行为，或把胁迫关系浪漫化
  ③ 真实人物（明星/网红/普通人）的色情化、羞辱或伪造
  ④ 肢解、酷刑、虐杀等细节化血腥，对弱势者或动物的残忍虐待，自杀自残的方法细节
  ⑤ 基于民族、种族、宗教、性别、残障等身份的贬损或煽动
  ⑥ 可复现的犯罪操作步骤（武器/毒品制作、诈骗方法等）
【内容安全·一般尺度】普通恋爱、接吻、拥抱正常创作；战斗冲突用非写实、不渲染痛苦细节的方式表现；其余轻度风险写入 risk_notes

━━━ 注意事项（贯穿两步）━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 用户未指定角色名时，用A/B/「他」/「她」代替，不自行命名
2. 用户已有角色设定时，严格遵守用户描述的性格与关系，不改写
3. plot 字数控制在100-200字，有画面感优先于信息量
4. 台词风格贴近漫画气泡：简短、有留白、情绪浓缩
5. 梗概 < 30字时，status 输出 "insufficient_input"，clarify_message 提示用户补充细节，expanded_plot 与 panels 留空，不强行扩写、不进入第二步
6. 【对话硬限制】全篇所有角色之间的对话来回总数不得超过8对。一问一答计为1对，旁白、内心独白、拟声词不计入
7. 第二步的每一格必须能在 plot/beats 中找到对应依据，不得为了凑格数虚构 plot 里没有的情节
8. 若输入包含 locked_expanded_plot，expanded_plot 字段原样返回该内容，直接进入第二步
9. 【多角色同框优先·CP/双人刚需】角色信息给出多个角色时：
   (a) 剧情 plot 与分镜要主动、频繁地把这些角色安排在同一画面里互动（对视/并肩/肢体接触/一递一接
       等），这是同人/CP 创作的核心诉求。绝不允许把故事写成只有一个主角、其他角色沦为背景板或缺席
       的独角戏。
   (b) 【同框配额】以 4 格为例，至少 3 格必须是两人（或多人）同框；单人特写格全篇最多 1 格，且只用于
       确有必要的情绪特写。9 格 / 条漫按同比例放宽，但单人格占比不得超过 1/4。
   (c) 每格 character_action 必须用角色名点名本格画面里实际出现的**所有**角色（如"云绯伸手去拿布丁，
       墨白同时按住了盒子"），不得只用代词、不得遗漏任何在场角色——下游按角色名为每格匹配参考图，
       漏名字会导致该角色形象无法保持一致。哪怕某角色在本格是次要位置（如背景、侧身），只要画面里
       有他，就必须在 character_action 里点到他的名字。
   (d) visual_prompt_hint 第1层也要相应体现同框的多个角色（如"two boys, a blond boy and a
       black-haired boy, facing each other"），不要只描述一个人。
10.【格间连续性·治画面跳变】漫画是连续的,相邻格之间人物的站位、朝向、视线、手里的道具、情绪必须
   自然承接,不能无缘由跳变(上一格坐着下一格不能凭空站起,上一格在门口下一格不能突然在桌边,
   上一格拿着杯子下一格杯子不能消失)。为此:
   (a) 从第2格起,每格必须输出 continuity_note,用一句话写明本格如何承接上一格——包括左右站位关系
       (谁在左谁在右)、身体朝向、视线落点、关键道具的延续、情绪的推进方向。例:"承接上格,云绯仍在
       画面左侧、墨白在右侧,云绯的视线从远处收回落到墨白脸上,情绪由紧张转为温柔"。第1格的
       continuity_note 写本格建立的初始站位基线(如"建立基线:云绯居左、墨白居右,面向彼此")。
   (b) 同一场景内的连续数格,人物的相对左右位置尽量保持稳定(符合漫画视线连贯原则),确需换位要在
       continuity_note 里说明原因。
   (c) 相邻两格的景别仍要有远近变化(见节奏规则),但站位/朝向的"空间逻辑"必须连续。
   (d) visual_prompt_hint 里的构图描述要与 continuity_note 的站位一致(如 continuity_note 说云绯在左,
       hint 的构图层不能把他放右边)。

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
      "continuity_note": "",
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
  // 黄金英文风格锚:每格 visual_prompt_hint 第7层必须原文照抄这句,保证全篇画风统一。
  // 与中文 visualStyle 并存——visualStyle 供 LLM 理解基调,styleAnchor 是写进出图提示词的权威原文。
  styleAnchor: string;
  lockedExpandedPlot?: ExpandedPlot;
};

export type PlotAndStoryboardResult =
  | { status: "ok"; storyTitle: string; expandedPlot: ExpandedPlot; panels: Panel[]; riskNotes: string[] }
  | { status: "insufficient_input"; clarifyMessage: string }
  | { status: "blocked"; reason: string; safeRewrite?: string };

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
style_anchor（画风锚·必须原文照抄进每格 visual_prompt_hint 的第7层，逐字相同，不得改写/翻译/替换）：${input.styleAnchor}

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
    continuityNote: raw?.continuity_note || "",
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
    if (parsed.status === "blocked") {
      // 生成中约束层:模型自身判定违禁
      return { status: "blocked", reason: parsed.clarify_message || "内容未通过安全审核，请调整后重试" };
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

  // 离线兜底也把统一风格锚拼在 hint 结尾,保证降级路径下全篇画风依然一致(anchor 兜底日漫)
  const anchor = input.styleAnchor || "japanese anime manga style, clean lineart, flat cel-shading";
  const panels: Panel[] = Array.from({ length: panelCount }, (_, i) => ({
    panelId: i + 1,
    beat: beats[Math.min(i, beats.length - 1)],
    scene: `${expandedPlot.scene}。【${i === panelCount - 1 ? "大格" : "小格"}】`,
    camera: i % 2 === 0 ? "中景·固定·平角" : "中近景·推镜·平角",
    characterAction: expandedPlot.plot.slice(0, 40),
    emotion: "平静",
    dialogue: i === 1 ? expandedPlot.keyDialogues[0]?.replace(/[「」]/g, "") || "" : "",
    caption: i === 0 ? expandedPlot.scene.slice(0, 20) : "",
    visualPromptHint: `two characters in a soft afternoon campus scene, gentle emotional atmosphere, warm sunlight backlight, warm pastel tones, medium shot eye level rule of thirds, ${anchor}`,
    status: "idle",
  }));

  return { status: "ok", storyTitle: "离线示例短篇", expandedPlot, panels, riskNotes: [] };
}
