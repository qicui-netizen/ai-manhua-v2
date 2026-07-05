// 图像编辑指令构建 Agent(对应 agent4-test-kit/agent4-system-prompt.txt)。
// 把一格分镜 + 角色参考图信息转成 { imageSlots, editPrompt, negativePrompt },
// 供 Qwen-Image-Edit-2509 使用。已实测硅基流动接口可接受 4 张参考图(image/image2/image3/image4)。
import { chatComplete, stripCodeFence, IMAGE_EDIT_PROMPT_MODEL } from "./llm";
import { keywordScreen } from "./moderation";
import type { Panel, Character } from "./types";

const SYSTEM_PROMPT = `【角色】
你是漫画分镜的图像编辑指令工程师。调用的模型是 Qwen/Qwen-Image-Edit-2509（通过硅基流动
SiliconFlow 接入）——它靠"输入 1-4 张图片 + 一句编辑指令"来合成/编辑画面，接口里这 4 张图
是四个独立字段（image / image2 / image3 / image4），指令里必须用"图1""图2""图3""图4"按顺序明确指代
对应字段的图，不是纯文生图模型，不要写成长段描述性文案。

【输入】
{
  "storySummary": "string，全篇剧情梗概，用于把握基调，不要逐字复述进指令",
  "panel": {
    "id": "string",
    "sceneDescription": "string，这一格发生了什么，含背景/环境（没有对应参考图，必须靠文字讲清楚）",
    "composition": "string，机位/构图建议，可能为空",
    "visualPromptHint": "string，分镜师给出的英文视觉提示词（场景/动作/情绪/光影/镜头/构图/画风的完整描述），是这一格画面的最终依据",
    "continuityNote": "string，本格与上一格的连续性衔接（左右站位/朝向/视线/道具/情绪如何承接），用于保持格间空间一致，可能为空",
    "charactersInPanel": [
      {
        "ocId": "string", "name": "string", "appearanceNotes": "string，仅用于核对，不要在指令里复述外观细节",
        "signatureFeatures": "string，该角色最独特的排他性标志特征（如'左眼下泪痣、红围巾'），多角色同框时用来区分不同角色、防止撞脸，可能为空",
        "lockedTraits": { "face": "强锁定|弱锁定|不锁定", "hair": "强锁定|弱锁定|不锁定", "outfit": "强锁定|弱锁定|不锁定", "color": "强锁定|弱锁定|不锁定" },
        "negativeTraits": ["string，用户手写的禁改要求，如'不要改变发色'"]
      }
    ],
    "dialogue": "string，这一格的台词/独白，可能为空",
    "userAdjustHint": "string，用户对上一次成图的修正要求（单格重抽时携带，如'表情改成微笑'），可能为空"
  },
  "style": { "id": "string", "label": "string", "anchor": "string，该画风的黄金英文风格锚，必须原文照抄进 editPrompt 结尾", "referenceImageKey": "string，该画风的参考图标识，可能为空" },
  "layout": { "template": "4格 | 9格 | 条漫", "aspectRatio": "string" }
}

【硬性规则】
1. 最多分配 4 个图片槽位（slot 1-4），按优先级填充：① charactersInPanel 里的每一个 OC 角色
   （每人一张参考图，一个都不能少）② 画风参考图（若 style.referenceImageKey 存在）③ 次要角色/道具参考图。
   【多角色铁律】charactersInPanel 里传入的所有角色都是本格必须出现的角色：你必须为每一个角色都
   分配一个独立的图片槽位，并在 editPrompt 里用"图1""图2"把他们都合成进同一个画面、都要真实可见
   （如"将图1的金发少年与图2的黑发少年放入同一画面，两人并肩而立"）。严禁只画其中一个而忽略另一个，
   严禁把某个传入的角色降格成背景虚影或省略不画——这是 CP/双人创作的核心，漏掉角色即为错误。
   只有当"角色数 + 画风参考图 > 4"实在放不下时，才按"先保证画风参考图、再按重要性保留人物"裁剪，
   被裁掉的角色改为在 editPrompt 里用一句明确外观词补充（如"a black-haired boy in school uniform
   standing beside him"），依然要让他出现在画面里，只是不占参考图槽位。
2. editPrompt 必须用"图1""图2"…明确指代每个 imageSlots 里的图，不能只描述外观而不引用
   编号——这是该模型的合成逻辑决定的，缺少编号引用会导致模型不知道该用哪张图。
3. 【画面依据】editPrompt 必须严格以 panel.visualPromptHint（分镜师的英文视觉提示词）为画面基准：
   场景、动作、情绪、光影、镜头、构图、画风均以它为准，不得忽略或另行想象画面内容。
   editPrompt 的结构 = 图片编号引用与合成关系（简短，如"将图1人物置于以下场景"）+ visualPromptHint
   的画面描述（保留英文原文，可删去与参考图冲突的发型/瞳色/服装等外观词）。
   若 panel.userAdjustHint 非空，这是用户对上一次成图不满意之处的修正要求：翻译成英文并入
   画面描述，与 visualPromptHint 冲突时以修正要求优先。
4. editPrompt 中的编号引用部分保持简短直接；visualPromptHint 部分完整保留，总长不设硬性上限。
   例如"将图1人物放入以下画面：rainy night street, neon lights reflection, medium shot from low angle, anime style"。
5. 台词/对白文字不要求模型画进图里。
6. 如果本格没有任何角色（纯场景/空镜）且没有画风参考图，imageSlots 返回空数组，
   editPrompt 转为纯文生图式的场景描述。
7. 【内容安全硬性红线】以下六类一律拒绝生成：blocked 输出 true，notes 用一句话注明类别
   （不复述细节），editPrompt 返回空字符串：
   ① 未成年人或幼态外观角色的色情/裸露/性暗示 ② 非自愿性行为或胁迫关系浪漫化
   ③ 真实人物的色情化或羞辱 ④ 细节化血腥虐待 ⑤ 针对群体身份的仇恨贬损 ⑥ 可复现的犯罪步骤。
   普通恋爱、非写实战斗冲突正常生成。
8. 必须输出合法 JSON，不要输出 Markdown 或额外解释文字。
9. 【特征锁定】charactersInPanel[].lockedTraits 表示该角色各特征相对参考图的锁定强度
   （face=面部长相，hair=发型发色，outfit=服装，color=整体配色）：
   - 强锁定：在 editPrompt 里对该角色追加一句简短英文保持指令，明确引用其图片编号，
     如 "keep the exact same face / hairstyle and hair color / outfit / color palette as 图N"
     （只列强锁定的特征）；同时把对应偏移词加入 negativePrompt（如 "different face,
     changed hairstyle, different hair color, different outfit, different color palette"）。
   - 弱锁定：允许随剧情微调（如换装剧情可换装），不追加保持指令。
   - 不锁定：完全交给画面需要，不做约束。
   negativeTraits 是用户手写的『保持/禁改』要求（中文祈使句，如"不要改变发色""保持冷淡表情"）。
   【注意语义】它们描述的是要保持的状态，不是要避免的内容——严禁原样或直译放入
   negativePrompt（"保持冷淡表情"进负向词会反转成"避免冷淡表情"）。正确做法：转成
   editPrompt 中的英文保持指令（如 "keep the cold expression", "keep the same hair color"）；
   仅当某条明确描述『不希望画面出现的元素』时，才把该元素本身作为负向词。
   若角色被裁出图片槽位（规则1），其强锁定特征改为并入该角色的极简外观词。
10.【构图安全区】出图模型不支持指定输出尺寸，成图比例会跟随参考图，最终按
   layout.aspectRatio 居中裁剪进版面（两侧或上下会被裁掉一部分）。因此 editPrompt 结尾
   必须追加一句英文构图约束，把主体人物和关键元素收进画面中央安全区，如
   "centered composition, all characters in the middle safe area, faces and key elements
   away from frame edges"，避免裁剪时人物出画或面部被切。
11.【风格锚·全篇一致铁律】style.anchor 是本篇统一画风的权威英文原文。你必须把 style.anchor
   一字不差地追加在 editPrompt 的最末尾（在构图安全区约束之后），禁止改写、翻译、精简或用近义词
   替换其中任何词。同一篇里每一格的 editPrompt 结尾都要带这句完全相同的 anchor，这是保证多格
   画风统一、不出现多种风格的核心手段。若 visualPromptHint 里已有的画风描述与 anchor 冲突
   （例如 anchor 是黑白，hint 里却出现彩色词），以 anchor 为准，删去 hint 里冲突的画风/色彩词。
   同时在 negativePrompt 里固定加入风格漂移负向词：
   "inconsistent art style, mixed art styles, style drift, different art style, off-model"。
   （style.anchor 为空时，本规则跳过，不要自造风格词。）
12.【格间连续性·治画面跳变】若 panel.continuityNote 非空，它描述本格与上一格的空间承接关系
   （左右站位/朝向/视线/道具/情绪）。你必须把其中的"站位与朝向"翻译成英文并入 editPrompt 的画面
   描述，让本格与上一格保持一致的空间逻辑，如 "keep the same left-right placement as before:
   the blond boy on the left, the black-haired boy on the right, both facing each other"。这样
   相邻格的人物不会无缘由左右互换或朝向翻转。注意:此约束写在画面描述部分,anchor（规则11）仍必须
   压在 editPrompt 的最末尾。continuityNote 为空（如第1格）时跳过本规则。
13.【排他特征·多角色防撞脸铁律】当本格有 2 个及以上角色同框时,两个角色的长相极易被模型画得越来越像
   (CP 撞脸)。为此:对每一个 signatureFeatures 非空的角色,必须在 editPrompt 里紧挨其图片编号引用,
   用英文明确复述该角色的排他标志特征,并与其他角色区分开,如 "图1 the blond boy WITH a tear mole
   under his left eye and a red scarf, 图2 the black-haired boy WITH silver ear cuffs on his right
   ear — keep the two characters visually distinct, do not blend their faces"。signatureFeatures 里
   的中文特征要翻译成英文。同时在 negativePrompt 里加入 "inconsistent character design, two
   characters looking alike, face blending, same face"。单角色格(仅1人)可省略区分性描述,但若该角色
   有 signatureFeatures 仍应复述以稳定其长相。signatureFeatures 为空的角色跳过。

【输出格式】
{
  "panelId": "string，原样返回 panel.id",
  "blocked": false,
  "imageSlots": [
    { "slot": 1, "refType": "oc_character | style_reference | prop_reference", "refKey": "string" }
  ],
  "editPrompt": "string，简短的编辑指令，含图片编号引用",
  "negativePrompt": "string，可选，描述不希望出现的内容，如'多余肢体、文字错乱、风格混杂'，可为空字符串",
  "aspectRatio": "string，原样返回 layout.aspectRatio，通过 API 参数传递，不写进 editPrompt",
  "notes": "string，给开发/审核看的备注，可为空"
}`;

export type ImageEditPromptInput = {
  storySummary: string;
  panel: Panel;
  characters: Character[]; // 本格涉及的角色(用于提取 appearanceNotes 与参考图)
  styleLabel: string;
  // 黄金英文风格锚:每格 editPrompt 结尾原样附加这句,全篇画风一致的核心保证(见 System Prompt 规则11)
  styleAnchor: string;
  styleReferenceImageKey?: string;
  aspectRatio: string;
  layoutTemplate: string;
  // 单格重抽的用户修正要求。一等字段而非拼进 visualPromptHint:
  // 离线兜底会对 hint 做 slice(0,120) 截断,拼尾部的修正会被整段切掉(白扣额度零效果)
  adjustHint?: string;
};

export type ImageEditPromptResult = {
  panelId: string;
  // 明确的拦截标志:解决"editPrompt 为空"与空镜场景(规则6)的语义冲突
  blocked: boolean;
  imageSlots: { slot: number; refType: string; refKey: string }[];
  editPrompt: string;
  negativePrompt: string;
  aspectRatio: string;
  notes: string;
};

function buildUserPayload(input: ImageEditPromptInput) {
  return {
    storySummary: input.storySummary,
    panel: {
      id: String(input.panel.panelId),
      sceneDescription: input.panel.scene,
      composition: input.panel.camera,
      // 分镜师的英文视觉提示词是画面最终依据,必须传给生图指令 Agent(曾经缺失导致分镜产出被丢弃)
      visualPromptHint: input.panel.visualPromptHint,
      // 与上一格的连续性衔接(站位/朝向/视线/道具/情绪),用于让本格构图承接上格,治画面跳变
      continuityNote: input.panel.continuityNote || "",
      charactersInPanel: input.characters.map((c) => ({
        ocId: c.id,
        name: c.name,
        appearanceNotes: c.canon,
        // 排他性标志特征:多角色同框防串脸的关键,生图指令 Agent 按规则13为每个角色强制引用其独特标记
        signatureFeatures: c.signatureFeatures || "",
        // 特征锁定档位与用户手写禁改要求:生图指令 Agent 按规则9转成保持指令与负向词
        lockedTraits: c.lockedTraits ?? { face: "弱锁定", hair: "弱锁定", outfit: "弱锁定", color: "弱锁定" },
        negativeTraits: c.negativeTraits ?? [],
      })),
      dialogue: input.panel.dialogue,
      userAdjustHint: input.adjustHint || "",
    },
    style: {
      id: input.styleLabel,
      label: input.styleLabel,
      anchor: input.styleAnchor || "",
      referenceImageKey: input.styleReferenceImageKey || "",
    },
    layout: { template: input.layoutTemplate, aspectRatio: input.aspectRatio },
  };
}

export async function runImageEditPrompt(
  input: ImageEditPromptInput
): Promise<ImageEditPromptResult | null> {
  const payload = buildUserPayload(input);
  const raw = await chatComplete(IMAGE_EDIT_PROMPT_MODEL, SYSTEM_PROMPT, JSON.stringify(payload, null, 2));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(stripCodeFence(raw));
    return {
      panelId: parsed.panelId ?? String(input.panel.panelId),
      blocked: parsed.blocked === true,
      imageSlots: Array.isArray(parsed.imageSlots) ? parsed.imageSlots : [],
      editPrompt: parsed.blocked === true ? "" : parsed.editPrompt || "",
      negativePrompt: parsed.negativePrompt || "",
      aspectRatio: parsed.aspectRatio || input.aspectRatio,
      notes: parsed.notes || "",
    };
  } catch (e) {
    console.error("[imageEditPrompt] JSON parse failed", e, raw.slice(0, 500));
    return null;
  }
}

// 离线兜底:直接用 visual_prompt_hint 拼一个简单的图生图指令,不引用参考图编号。
// 这条路径不经过 LLM,必须先过词库筛查,否则会成为违禁内容直达生图接口的绕过通道。
export function offlineImageEditPrompt(input: ImageEditPromptInput): ImageEditPromptResult {
  const screen = keywordScreen(
    [input.panel.scene, input.panel.characterAction, input.panel.visualPromptHint, input.panel.dialogue, input.adjustHint || ""].join(
      "\n"
    )
  );
  if (screen.decision === "BLOCK") {
    return {
      panelId: String(input.panel.panelId),
      blocked: true,
      imageSlots: [],
      editPrompt: "",
      negativePrompt: "",
      aspectRatio: input.aspectRatio,
      notes: screen.reason,
    };
  }
  const slots = input.characters.slice(0, 3).map((c, i) => ({
    slot: i + 1,
    refType: "oc_character",
    refKey: c.referenceImages[0]?.id || c.id,
  }));
  // 强锁定特征与用户手写禁改要求并入负向词,离线路径同样尊重特征锁定
  const LOCK_NEGATIVES: Record<string, string> = {
    face: "different face",
    hair: "changed hairstyle, different hair color",
    outfit: "different outfit",
    color: "different color palette",
  };
  const lockNegatives = input.characters.flatMap((c) =>
    Object.entries(c.lockedTraits ?? {})
      .filter(([, level]) => level === "强锁定")
      .map(([trait]) => LOCK_NEGATIVES[trait])
      .filter(Boolean)
  );
  // 用户手写的 negativeTraits 是『保持/禁改』类祈使句("保持冷淡表情"),语义上属于正向
  // 保持指令——放进 negative_prompt 会被反转成"避免冷淡表情",必须拼进 editPrompt
  const userKeeps = input.characters.flatMap((c) => c.negativeTraits ?? []);
  // 风格锚在 slice 截断之后单独拼接:分镜层已把 anchor 放在 hint 结尾,slice(0,120) 很可能把它切掉,
  // 因此离线路径必须独立地把统一 anchor 钉回 editPrompt 末尾,保证降级路径全篇画风依然一致(规则11同理)
  const styleTail = input.styleAnchor ? `, ${input.styleAnchor}` : "";
  const styleNegatives = input.styleAnchor
    ? ["inconsistent art style", "mixed art styles", "style drift", "different art style", "off-model"]
    : [];
  return {
    panelId: String(input.panel.panelId),
    blocked: false,
    imageSlots: slots,
    // 构图安全区后缀与规则10同理:成图会按目标比例居中裁剪,主体必须收在中央。
    // 用户修正要求与保持要求在 slice 截断之后单独拼接,保证兜底路径下不丢失
    editPrompt:
      (input.panel.visualPromptHint.slice(0, 120) || input.panel.scene.slice(0, 60)) +
      (input.adjustHint ? `, ${input.adjustHint}` : "") +
      (userKeeps.length ? `, ${[...new Set(userKeeps)].join(", ")}` : "") +
      ", centered composition, faces away from frame edges" +
      styleTail,
    negativePrompt: [...new Set(["多余肢体、文字错乱、风格混杂、水印", ...lockNegatives, ...styleNegatives])].join(", "),
    aspectRatio: input.aspectRatio,
    notes: "offline fallback",
  };
}
