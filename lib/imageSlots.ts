// 参考图槽位解析(P0-1 修编号错位 bug)。
// 背景:imageEditPrompt 的 System Prompt 允许生图指令 Agent 输出 refType=style_reference /
// prop_reference 的槽位,但当前项目没有任何风格图/道具图资产,route 层只能把 oc_character 槽
// 解析成真实参考图。若 LLM 产出 [图1角色, 图2风格图, 图3角色] 而风格图无资产,旧逻辑会把 images
// 静默压实成 [角色1, 角色3],但 editPrompt 里仍写着"图1…图3…"——"图3"越界指向不存在的 image3、
// "图2"被角色3 张冠李戴,模型按错编号合成,画面内容错乱。
//
// 本函数统一做三件事,消除该错位:
// 1. 过滤掉解析不出真实图片的槽位(当前即所有非 oc_character 槽)
// 2. 把保留下来的槽位重新连续编号(1,2,3…),得到"旧图号→新图号"映射
// 3. 按映射把 editPrompt 里的"图{旧}"改写成"图{新}",让文字编号与实际图片数组对齐
//
// 两个生图 route(generate-batch / generate-panel)共用此函数,口径一致。

import type { Character } from "./types";

export type RawImageSlot = { slot: number; refType: string; refKey: string };

export type ResolveSlotsResult = {
  images: string[]; // 已 resolve 成 data URL / 可访问 URL 的参考图,顺序即 image/image2/…
  editPrompt: string; // 已按新编号重映射的编辑指令
  /** 重映射后 editPrompt 里出现的最大"图N"是否越界(> images.length),用于告警自检 */
  hadOverflow: boolean;
};

/**
 * 解析 imageSlots -> 真实参考图,并修正 editPrompt 的图片编号引用。
 * @param maxRefs 供应商可接受的参考图上限(Qwen=4, Seedream=14)。槽位超出此数会被截断。
 * @param pendingExtraRefs 本函数之后 route 层还会追加的参考图数(如 P0-2 回喂基准图)。
 *   自检"图N 是否越界"时把它算进合法上界,避免"图2 引用回喂图"却被误报为编号错位。
 */
export async function resolveSlots(
  imageSlots: RawImageSlot[],
  characters: Character[],
  editPrompt: string,
  resolveImageUrl: (u: string) => Promise<string>,
  maxRefs = 4,
  pendingExtraRefs = 0
): Promise<ResolveSlotsResult> {
  const images: string[] = [];
  const remap: Array<[number, number]> = []; // [旧图号, 新图号]
  let newIdx = 0;

  for (const slot of imageSlots.slice(0, maxRefs)) {
    // 当前只有 oc_character 槽能解析出真实图片;style_reference / prop_reference 无资产,跳过。
    // (未来若接入风格图/道具图资产,在此扩展对应解析分支即可。)
    if (slot.refType !== "oc_character") continue;
    const char = characters.find(
      (c) => c.id === slot.refKey || c.referenceImages.some((r) => r.id === slot.refKey)
    );
    // P1-1 黄金图优先:有 AI 生成的标准设定图就用它当锚(比用户上传的杂乱原图更能稳住画风/比例),
    // 没有则退回用户上传的参考图。黄金图是全角色统一的干净标准像,与 slot.refKey 指向哪张原图无关。
    const refUrl = char?.characterSheet?.url
      || char?.referenceImages.find((r) => r.id === slot.refKey)?.url
      || char?.referenceImages[0]?.url;
    if (refUrl) {
      images.push(await resolveImageUrl(refUrl));
      newIdx++;
      if (slot.slot !== newIdx) remap.push([slot.slot, newIdx]);
    }
  }

  // 把 editPrompt 里的"图{旧}"改写成"图{新}"。用两阶段占位符替换,避免两类撞车:
  // (1)"图1"前缀撞"图10";(2)级联覆盖——如 图11→图10 后,处理 图10→图9 又把刚写的图10改掉。
  // 先把每个"图{旧}"换成唯一占位符(含新号),全部换完再把占位符换成"图{新}"。
  // NUL 控制字符做占位符:正常提示词文本不含它,零误伤、不改原文格式
  const NUL = String.fromCharCode(0);
  let fixed = editPrompt;
  // 阶段A:旧号从大到小,把"图{旧}"换成占位符,避免"图1"截断"图10"的前缀
  for (const [oldN, newN] of [...remap].sort((a, b) => b[0] - a[0])) {
    fixed = fixed.split(`图${oldN}`).join(`${NUL}${newN}${NUL}`);
  }
  // 阶段B:占位符还原成"图{新}"
  for (const [, newN] of remap) {
    fixed = fixed.split(`${NUL}${newN}${NUL}`).join(`图${newN}`);
  }

  // 自检:重映射后仍出现的最大"图N"编号不应超过实际图片数,否则说明 LLM 引用了从未解析出的图。
  let maxRef = 0;
  for (const m of fixed.matchAll(/图(\d+)/g)) {
    maxRef = Math.max(maxRef, Number(m[1]));
  }
  // 合法上界 = 已解析的角色图 + route 层稍后会追加的回喂图(pendingExtraRefs),
  // 且不超过供应商上限。超过它才是真的编号错位。
  const legalMax = Math.min(images.length + pendingExtraRefs, maxRefs);
  const hadOverflow = maxRef > legalMax;
  if (hadOverflow) {
    console.warn(
      `[imageSlots] editPrompt 引用了图${maxRef} 但最多 ${legalMax} 张参考图,可能仍有编号错位`,
      { imageSlots }
    );
  }

  return { images, editPrompt: fixed, hadOverflow };
}

/**
 * P0-2 回喂基准图拼接 + 编号一致性校正。
 * 把回喂参考图(如第1格成图)拼在角色图之后,按供应商上限截断,并校正 editPrompt 里规则16 的图号:
 * - LLM 按估算的 estimatedBaseSlot 写了"图{估算}"引用回喂图,但实际角色图数(charImages.length)可能不同
 * - 若回喂图保留在最终数组:把 editPrompt 里"图{估算}"精确改成"图{实际角色图数+1}"
 * - 若回喂图被 refLimit 截断出数组:删掉那句悬空的 "match ... 图N ... reference" 指令,避免误导模型
 *
 * @param estimatedBaseSlot route 层传给 LLM 的估算基准图编号;0 表示本格不回喂(直接原样返回)
 */
export function appendFeedbackRef(
  charImages: string[],
  feedbackImages: string[],
  editPrompt: string,
  estimatedBaseSlot: number,
  maxRefs: number
): { images: string[]; editPrompt: string } {
  const images = [...charImages, ...feedbackImages].slice(0, maxRefs);
  if (estimatedBaseSlot <= 0) return { images, editPrompt };

  const actualBaseSlot = charImages.length + 1;
  const feedbackKept = images.length > charImages.length; // 回喂图确实进了最终数组
  let fixed = editPrompt;
  if (feedbackKept) {
    // 回喂图在数组里:把 editPrompt 规则16 引用的估算图号精确改成真实图号(实际角色图数+1)。
    // 这是关键的一致性修正——图号错了会让"match 图N 风格"指向错误的图。
    if (actualBaseSlot !== estimatedBaseSlot) {
      fixed = fixed.split(`图${estimatedBaseSlot}`).join(`图${actualBaseSlot}`);
    }
  } else {
    // 回喂图被 refLimit 截断出数组(角色图已占满槽位):editPrompt 里"图{估算}"成了悬空引用。
    // 此时不做脆弱的正则删除——悬空的"match 图N 风格"指令无害(模型找不到图N 会忽略这句,
    // 角色图 1..M 的编号仍然正确,不构成 P0-1 那种错位)。仅告警,不改文本,保持鲁棒。
    console.warn(
      `[imageSlots] 回喂基准图被参考图上限(${maxRefs})截断,editPrompt 里图${estimatedBaseSlot}的风格引用将被模型忽略`
    );
  }
  return { images, editPrompt: fixed };
}
