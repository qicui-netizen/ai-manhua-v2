// 常量数据:模板 / 画风 / 发布平台预设。
import type { Character, TemplateType, TargetPlatform } from "./types";

export type Style = { id: string; name: string; prompt: string; bg: [string, string]; referenceImageUrl?: string };

export type Template = { id: TemplateType; name: string; panels: number; layout: string; desc: string; est: string };

export type Platform = {
  id: TargetPlatform;
  name: string;
  width: number;
  height?: number;
  ratio: string;
  note: string;
  grid?: number;
};

// ── 种子角色(演示用,用户可另建自己的角色卡) ──────────────────
// 出图模型(Qwen-Image-Edit)要求至少 1 张参考图,不支持零参考图纯文生图。
// 种子角色配系统预设占位头像兜底,用户上传真实照片后会替换为 primary 参考图。
export const CHARACTERS: Character[] = [
  {
    id: "yun-fei",
    name: "云绯",
    ownershipType: "original_oc",
    source: "text_only",
    ageFeel: "17岁 / 元气高中生",
    canon: "云绯,17岁少女,粉色蓬松长发,红色大眼,活泼开朗,笑起来有梨涡。",
    outfit: "白色校服配蝴蝶结领",
    referenceImages: [{ id: "yun-fei-default", url: "/placeholders/yun-fei.png", role: "primary" }],
    visual: { hair: "#ec4899", hairStyle: "long", skin: "#ffe7d6", eye: "#e11d48", accent: "#f9a8d4" },
    lockedTraits: { face: "强锁定", hair: "强锁定", outfit: "弱锁定", color: "强锁定" },
    negativeTraits: ["不要改变发色", "不要换主服装"],
    createdAt: Date.parse("2026-06-01"),
  },
  {
    id: "mo-bai",
    name: "墨白",
    ownershipType: "original_oc",
    source: "text_only",
    ageFeel: "18岁 / 冷淡校草",
    canon: "墨白,18岁少年,黑色短发,冷淡疏离气质,身形高瘦。",
    outfit: "深色校服外套",
    referenceImages: [{ id: "mo-bai-default", url: "/placeholders/mo-bai.png", role: "primary" }],
    visual: { hair: "#1f2937", hairStyle: "short", skin: "#ffe0cf", eye: "#374151", accent: "#3b82f6" },
    lockedTraits: { face: "强锁定", hair: "强锁定", outfit: "弱锁定", color: "强锁定" },
    negativeTraits: ["保持冷淡表情", "不要换发型"],
    createdAt: Date.parse("2026-06-01"),
  },
];

// 用户新建角色卡时,若不上传照片,系统随机分配一张占位头像兜底(保证可出图)。
export const DEFAULT_AVATAR_POOL = ["/placeholders/default-1.png", "/placeholders/default-2.png"];

export const STYLES: Style[] = [
  { id: "jp-anime", name: "日漫", prompt: "japanese manga style, clean lineart, cel shading", bg: ["#fbe9ec", "#e7eefb"] },
  { id: "guofeng", name: "国漫", prompt: "chinese guofeng comic style, ink accents, elegant linework", bg: ["#f4f1e8", "#e3ece4"] },
  { id: "kr-manhwa", name: "韩漫", prompt: "korean manhwa style, glossy skin, soft lighting", bg: ["#f3eefb", "#fbeef6"] },
  { id: "chibi", name: "Q版", prompt: "chibi style, two-head-tall, big eyes, flat colors", bg: ["#fff3d6", "#ffe0e8"] },
  { id: "thick-paint", name: "厚涂", prompt: "thick paint CG style, volumetric lighting, painterly texture", bg: ["#2a2440", "#3d3a52"] },
  { id: "bw", name: "黑白", prompt: "black and white manga, screentone, high contrast", bg: ["#efefef", "#d8d8d8"] },
];

export const TEMPLATES: Template[] = [
  { id: "4_panel", name: "4格", panels: 4, layout: "2×2", desc: "经典四格,最轻量", est: "~3分钟" },
  { id: "9_panel", name: "9格", panels: 9, layout: "3×3", desc: "完整起承转合", est: "~6分钟" },
  { id: "vertical_strip", name: "条漫", panels: 6, layout: "纵向长图", desc: "竖屏滚动阅读", est: "~8分钟" },
];

export const PLATFORMS: Platform[] = [
  { id: "xhs_vertical", name: "小红书·竖图", width: 1080, height: 1440, ratio: "3:4", note: "首图建议 3:4" },
  { id: "xhs_square", name: "小红书·方图", width: 1080, height: 1080, ratio: "1:1", note: "方图笔记" },
  { id: "xhs_grid9", name: "小红书·九宫格", width: 1080, height: 1080, ratio: "1:1", note: "九宫格切图", grid: 9 },
  { id: "kuaikan_strip", name: "快看·条漫长图", width: 800, ratio: "竖向长图", note: "宽800,纵向自动分段" },
  { id: "moments_grid9", name: "朋友圈·九宫格", width: 1080, height: 1080, ratio: "1:1", note: "3×3 自动切图", grid: 9 },
];

export const TONES = ["搞笑", "治愈", "甜宠", "悬疑", "热血", "日常"] as const;

export const SYNOPSIS_EXAMPLES = [
  "下雨天她躲在屋檐下，发现旁边站着一只流浪猫",
  "误打误撞坐在了他旁边，两人的耳机线缠在一起了",
  "考试前夕，她发现复习笔记被人悄悄补全了",
  "深夜便利店只剩最后一个布丁，两人同时伸手",
];

export function templateOf(id: TemplateType): Template {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}
export function styleOf(id: string): Style {
  return STYLES.find((s) => s.id === id) || STYLES[0];
}
export function platformOf(id: TargetPlatform): Platform {
  return PLATFORMS.find((p) => p.id === id) || PLATFORMS[0];
}

// 画风 id → 合并 Agent 输入的 visual_style 分类(日漫/国漫/韩漫/Q版/黑白/厚涂)
export function visualStyleOf(styleId: string): string {
  const map: Record<string, string> = {
    "jp-anime": "日漫", guofeng: "国漫", "kr-manhwa": "韩漫", chibi: "Q版", "thick-paint": "厚涂", bw: "黑白",
  };
  return map[styleId] || "日漫";
}
