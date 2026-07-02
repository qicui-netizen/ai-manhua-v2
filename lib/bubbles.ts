// 气泡自动布局。返回 0..1 归一化坐标,屏幕预览和导出 canvas 共用同一套布局。
import type { Panel } from "./types";

export type Bubble = { type: "caption" | "speech"; text: string; x: number; y: number; w: number };

export function layoutBubbles(panel: Panel): Bubble[] {
  const out: Bubble[] = [];
  if (panel.caption?.trim()) out.push({ type: "caption", text: panel.caption.trim(), x: 0.05, y: 0.05, w: 0.9 });
  if (panel.dialogue?.trim()) out.push({ type: "speech", text: panel.dialogue.trim(), x: 0.3, y: 0.66, w: 0.62 });
  return out;
}
