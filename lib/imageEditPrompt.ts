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
    "charactersInPanel": [
      { "ocId": "string", "name": "string", "appearanceNotes": "string，仅用于核对，不要在指令里复述外观细节" }
    ],
    "dialogue": "string，这一格的台词/独白，可能为空"
  },
  "style": { "id": "string", "label": "string", "referenceImageKey": "string，该画风的参考图标识，可能为空" },
  "layout": { "template": "4格 | 9格 | 条漫", "aspectRatio": "string" }
}

【硬性规则】
1. 最多分配 4 个图片槽位（slot 1-4），按优先级填充：① 本格出现的 OC 角色（每人一张参考图）
   ② 画风参考图（若 style.referenceImageKey 存在）③ 本格出现的 OC 角色（每人一张参考图）④ 次要角色/道具参考图
   若本格角色数 + 画风参考图 超过 4 张，按"先保证画风参考图，再按重要性保留人物"的原则
   裁剪，被裁掉的角色改为在 editPrompt 里用一句极简外观词补充（如"black-haired boy"），
   不占图片槽位。
2. editPrompt 必须用"图1""图2"…明确指代每个 imageSlots 里的图，不能只描述外观而不引用
   编号——这是该模型的合成逻辑决定的，缺少编号引用会导致模型不知道该用哪张图。
3. 【画面依据】editPrompt 必须严格以 panel.visualPromptHint（分镜师的英文视觉提示词）为画面基准：
   场景、动作、情绪、光影、镜头、构图、画风均以它为准，不得忽略或另行想象画面内容。
   editPrompt 的结构 = 图片编号引用与合成关系（简短，如"将图1人物置于以下场景"）+ visualPromptHint
   的画面描述（保留英文原文，可删去与参考图冲突的发型/瞳色/服装等外观词）。
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
  styleReferenceImageKey?: string;
  aspectRatio: string;
  layoutTemplate: string;
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
      charactersInPanel: input.characters.map((c) => ({
        ocId: c.id,
        name: c.name,
        appearanceNotes: c.canon,
      })),
      dialogue: input.panel.dialogue,
    },
    style: {
      id: input.styleLabel,
      label: input.styleLabel,
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
    [input.panel.scene, input.panel.characterAction, input.panel.visualPromptHint, input.panel.dialogue].join("\n")
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
  return {
    panelId: String(input.panel.panelId),
    blocked: false,
    imageSlots: slots,
    editPrompt: input.panel.visualPromptHint.slice(0, 120) || input.panel.scene.slice(0, 60),
    negativePrompt: "多余肢体、文字错乱、风格混杂、水印",
    aspectRatio: input.aspectRatio,
    notes: "offline fallback",
  };
}
