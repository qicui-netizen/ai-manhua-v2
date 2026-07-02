// 气泡布局与样式。返回 0..1 归一化参数,屏幕预览和导出 canvas 共用同一套规则,
// 保证"编辑时看到的"和"导出图里画的"一致。
import type { Panel, BubbleStyle, BubbleAnchor } from "./types";

export type Bubble = {
  type: "caption" | "speech";
  text: string;
  style: BubbleStyle;
};

// 对白默认:椭圆泡,下中,白底不透明度0.95;旁白默认:方框,上中,0.85(参考主流漫画排版)
export const DEFAULT_DIALOGUE_STYLE: BubbleStyle = { shape: "oval", anchor: 8, opacity: 0.95 };
export const DEFAULT_CAPTION_STYLE: BubbleStyle = { shape: "box", anchor: 2, opacity: 0.85 };

export function layoutBubbles(panel: Panel): Bubble[] {
  const out: Bubble[] = [];
  if (panel.caption?.trim()) {
    out.push({ type: "caption", text: panel.caption.trim(), style: panel.captionBubble || DEFAULT_CAPTION_STYLE });
  }
  if (panel.dialogue?.trim()) {
    out.push({ type: "speech", text: panel.dialogue.trim(), style: panel.dialogueBubble || DEFAULT_DIALOGUE_STYLE });
  }
  return out;
}

// 九宫格 anchor → 盒子左上角坐标(归一化)。bw/bh 为盒子归一化宽高,edge 为边距。
export function anchorToPos(
  anchor: BubbleAnchor,
  bw: number,
  bh: number,
  edge = 0.05
): { x: number; y: number } {
  const col = (anchor - 1) % 3; // 0左 1中 2右
  const row = Math.floor((anchor - 1) / 3); // 0上 1中 2下
  const x = col === 0 ? edge : col === 1 ? (1 - bw) / 2 : 1 - bw - edge;
  const y = row === 0 ? edge : row === 1 ? (1 - bh) / 2 : 1 - bh - edge;
  return { x, y };
}

export const ANCHOR_LABELS: Record<BubbleAnchor, string> = {
  1: "左上", 2: "中上", 3: "右上",
  4: "左中", 5: "居中", 6: "右中",
  7: "左下", 8: "中下", 9: "右下",
};

export const SHAPE_LABELS: Record<BubbleStyle["shape"], string> = {
  oval: "对话泡",
  burst: "爆炸泡",
  box: "方框",
};
