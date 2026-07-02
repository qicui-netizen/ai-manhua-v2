// 图像编辑指令构建 Agent(对应 agent4-test-kit/agent4-system-prompt.txt)。
// 把一格分镜 + 角色参考图信息转成 { imageSlots, editPrompt, negativePrompt },
// 供 Qwen-Image-Edit-2509 使用。已实测硅基流动接口可接受 4 张参考图(image/image2/image3/image4)。
import { chatComplete, stripCodeFence, IMAGE_EDIT_PROMPT_MODEL } from "./llm";
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
3. editPrompt 只写这一格特有的信息：动作、表情、朝向、与其他图的合成关系、场景/背景描述、
   镜头视角。不要重复参考图里已经体现的发型/瞳色/服装等外观细节，避免和图片本身冲突。
4. editPrompt 保持简短直接，控制在 1-2 句、40 个中文字以内，语气像一条编辑指令，
   例如"将图1人物放入雨夜街道背景中，图2人物在其身后，两人对视，整体画风参照图3"。
5. 台词/对白文字不要求模型画进图里。
6. 如果本格没有任何角色（纯场景/空镜）且没有画风参考图，imageSlots 返回空数组，
   editPrompt 转为纯文生图式的场景描述。
7. 涉及暴力、色情、政治敏感内容时不生成，notes 里注明原因，editPrompt 返回空字符串。
8. 必须输出合法 JSON，不要输出 Markdown 或额外解释文字。

【输出格式】
{
  "panelId": "string，原样返回 panel.id",
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
      imageSlots: Array.isArray(parsed.imageSlots) ? parsed.imageSlots : [],
      editPrompt: parsed.editPrompt || "",
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
export function offlineImageEditPrompt(input: ImageEditPromptInput): ImageEditPromptResult {
  const slots = input.characters.slice(0, 3).map((c, i) => ({
    slot: i + 1,
    refType: "oc_character",
    refKey: c.referenceImages[0]?.id || c.id,
  }));
  return {
    panelId: String(input.panel.panelId),
    imageSlots: slots,
    editPrompt: input.panel.visualPromptHint.slice(0, 120) || input.panel.scene.slice(0, 60),
    negativePrompt: "多余肢体、文字错乱、风格混杂、水印",
    aspectRatio: input.aspectRatio,
    notes: "offline fallback",
  };
}
