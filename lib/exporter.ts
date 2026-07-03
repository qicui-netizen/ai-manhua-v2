"use client";
// 导出合成器:纯前端 canvas,把多格图 + 气泡合成成目标平台尺寸的 PNG,免费层打水印。
import type { Project } from "./types";
import { platformOf, type Platform } from "./data";
import { layoutBubbles, anchorToPos } from "./bubbles";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// 按 cover 方式画图:居中裁剪填满格子,不拉伸变形(与页面上 object-cover 的 <img> 预览一致)
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  ox: number,
  oy: number,
  cellW: number,
  cellH: number
) {
  const scale = Math.max(cellW / img.width, cellH / img.height);
  const sw = cellW / scale;
  const sh = cellH / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, ox, oy, cellW, cellH);
}

// 导出时单个格子的高宽比(与 composeExport 的拼图规则一致),预览沿用保证所见即所得
function exportCellRatio(project: Project): number {
  const platform = platformOf(project.targetPlatform);
  if (platform.grid) return 1;
  if (platform.height) {
    const n = Math.max(1, project.panels.length);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return platform.height / rows / (platform.width / cols);
  }
  return 4 / 3; // 条漫竖格
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 按字符折行(中文无空格,逐字测量)
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const chars = [...text];
  const lines: string[] = [];
  let line = "";
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      lines.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

// 爆炸泡:锯齿星形路径
function burstPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  const spikes = 14;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (Math.PI * i) / spikes - Math.PI / 2;
    const k = i % 2 === 0 ? 1 : 0.78;
    const x = cx + Math.cos(angle) * rx * k;
    const y = cy + Math.sin(angle) * ry * k;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

type BubbleBox = { x: number; y: number; w: number; h: number };

function rectsOverlap(a: BubbleBox, b: BubbleBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// 气泡渲染:白底黑字黑描边,三种形状(方框/椭圆对话泡/爆炸泡),
// 位置按九宫格 anchor、白底透明度按用户设置,与编辑页预览同一套规则。
// 格子支持非正方形(cellW/cellH);多个气泡相交时后画的自动垂直让位。
function drawBubbles(
  ctx: CanvasRenderingContext2D,
  project: Project,
  panelIdx: number,
  ox: number,
  oy: number,
  cellW: number,
  cellH: number
) {
  const panel = project.panels[panelIdx];
  const bubbles = layoutBubbles(panel);
  const base = Math.min(cellW, cellH);
  const placed: BubbleBox[] = [];
  for (const b of bubbles) {
    const { shape, anchor, opacity } = b.style;
    const fs = Math.round(base * (b.type === "caption" ? 0.042 : 0.046));
    const lh = fs * 1.45;
    // 字体栈带安卓回退:安卓无 PingFang SC,缺回退会退到衬线默认体,跨端气泡观感不一致
    ctx.font = `600 ${fs}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif`;

    const maxTextW = cellW * (shape === "burst" ? 0.42 : shape === "oval" ? 0.5 : 0.72);
    const lines = wrapLines(ctx, b.text, maxTextW);
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const padX = fs * 0.9;
    const padY = fs * 0.6;
    let bw = textW + padX * 2;
    let bh = lines.length * lh + padY * 2;
    // 椭圆/锯齿边缘会吃掉内容区,整体放大保证文字不顶边
    if (shape === "oval") {
      bw *= 1.25;
      bh *= 1.5;
    } else if (shape === "burst") {
      bw *= 1.55;
      bh *= 1.9;
    }
    bw = Math.min(bw, cellW * 0.92);
    bh = Math.min(bh, cellH * 0.92);

    const pos = anchorToPos(anchor, bw / cellW, bh / cellH);
    const bx = ox + pos.x * cellW;
    let by = oy + pos.y * cellH;

    // 防重叠:与已放置气泡相交时,往格内空间更大的方向垂直推开(旁白先画占位,对白让位)
    const gap = base * 0.02;
    for (const other of placed) {
      if (rectsOverlap({ x: bx, y: by, w: bw, h: bh }, other)) {
        const pushDown = other.y + other.h + gap;
        const pushUp = other.y - bh - gap;
        if (pushDown + bh <= oy + cellH - gap) by = pushDown;
        else if (pushUp >= oy + gap) by = pushUp;
      }
    }
    placed.push({ x: bx, y: by, w: bw, h: bh });

    const cx = bx + bw / 2;
    const cy = by + bh / 2;

    ctx.save();
    ctx.fillStyle = `rgba(255,255,255,${opacity})`;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = Math.max(1.5, base * 0.006);

    if (shape === "oval" && b.type === "speech") {
      // 先画尾巴,椭圆随后覆盖连接处
      ctx.beginPath();
      ctx.moveTo(cx - bw * 0.12, cy + bh * 0.3);
      ctx.lineTo(cx - bw * 0.3, cy + bh * 0.5 + bh * 0.26);
      ctx.lineTo(cx + bw * 0.08, cy + bh * 0.34);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    if (shape === "box") {
      roundRect(ctx, bx, by, bw, bh, fs * 0.35);
    } else if (shape === "oval") {
      ctx.beginPath();
      ctx.ellipse(cx, cy, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    } else {
      burstPath(ctx, cx, cy, bw / 2, bh / 2);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const startY = cy - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lh));
    ctx.restore();
    ctx.textAlign = "left";
  }
}

// 「AI 生成」显式标识:全档位强制,与免费版营销水印解耦、付费不可去除。
// 依据《人工智能生成合成内容标识办法》(2025-09-01 生效),提供者义务不可约定转移;
// 元数据隐式标识(EXIF)需引库,列入路线图,先落显式角标。
function aiBadge(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const base = Math.min(w, h);
  const fs = Math.max(14, Math.round(base * 0.024));
  const text = "AI 生成";
  ctx.save();
  ctx.font = `600 ${fs}px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif`;
  const padX = fs * 0.7;
  const bw = ctx.measureText(text).width + padX * 2;
  const bh = fs * 1.8;
  const margin = fs * 0.8;
  const x = w - bw - margin;
  const y = h - bh - margin;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundRect(ctx, x, y, bw, bh, bh / 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + bw / 2, y + bh / 2 + fs * 0.05);
  ctx.restore();
  ctx.textAlign = "left";
}

function watermark(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#000";
  ctx.font = `700 ${Math.round(w * 0.04)}px system-ui`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 9);
  for (let i = -2; i <= 4; i++) ctx.fillText("PanelForge 免费版", 0, i * h * 0.16);
  ctx.restore();
  ctx.textAlign = "left";
}

// 气泡编辑页的实时预览:与导出用同一套 drawBubbles 和格子比例,保证"看到的=导出的"。
// opts.isStale:异步加载图片期间用户可能已切到别的格子,过期渲染不落笔(防竞态串图)。
export async function renderPanelWithBubbles(
  canvas: HTMLCanvasElement,
  project: Project,
  panelIdx: number,
  opts?: { isStale?: () => boolean; size?: number }
) {
  const panel = project.panels[panelIdx];
  const size = opts?.size ?? 720;
  const cellH = Math.round(size * exportCellRatio(project));

  let img: HTMLImageElement | null = null;
  if (panel.imageUrl) {
    try {
      img = await loadImage(panel.imageUrl);
    } catch {
      /* 旧远程图可能过期/无CORS,保留底色 */
    }
  }
  if (opts?.isStale?.()) return; // 已切走,放弃本次渲染

  canvas.width = size;
  canvas.height = cellH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, size, cellH);
  if (img) drawImageCover(ctx, img, 0, 0, size, cellH);
  drawBubbles(ctx, project, panelIdx, 0, 0, size, cellH);
}

export async function composeExport(
  project: Project,
  platform: Platform,
  opts: { hd: boolean; watermark: boolean }
): Promise<string> {
  const validPanels = project.panels.filter((p) => p.imageUrl);
  const imgs = await Promise.all(validPanels.map((p) => loadImage(p.imageUrl!)));
  // 免费档 0.75:0.5 时每格仅 270×360,发平台再被二压后不可用,劣化只伤害诚实用户
  // (评审摩擦点⑧裁决)。免费/会员的档位差保留在水印与 1x 高清上。
  const scale = opts.hd ? 1 : 0.75;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  if (platform.grid) {
    // 九宫格平台:固定 3×3 切图
    const n = Math.min(9, validPanels.length);
    const cell = Math.round((platform.width / 3) * scale);
    canvas.width = cell * 3;
    canvas.height = cell * 3;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < n; i++) {
      const ox = (i % 3) * cell;
      const oy = Math.floor(i / 3) * cell;
      const panelIdx = project.panels.indexOf(validPanels[i]);
      if (imgs[i]) drawImageCover(ctx, imgs[i], ox, oy, cell, cell);
      drawBubbles(ctx, project, panelIdx, ox, oy, cell, cell);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4;
      ctx.strokeRect(ox, oy, cell, cell);
    }
  } else if (platform.height) {
    // 有目标尺寸的平台(方图1:1/竖图3:4):按格数拼网格,整图保持平台比例
    // 4格→2×2,9格→3×3,6格→2列3行
    const n = validPanels.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellW = Math.round((platform.width / cols) * scale);
    const cellH = Math.round((platform.height / rows) * scale);
    canvas.width = cellW * cols;
    canvas.height = cellH * rows;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < n; i++) {
      const ox = (i % cols) * cellW;
      const oy = Math.floor(i / cols) * cellH;
      const panelIdx = project.panels.indexOf(validPanels[i]);
      if (imgs[i]) drawImageCover(ctx, imgs[i], ox, oy, cellW, cellH);
      drawBubbles(ctx, project, panelIdx, ox, oy, cellW, cellH);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4;
      ctx.strokeRect(ox, oy, cellW, cellH);
    }
  } else {
    // 条漫长图:竖排,3:4 竖格
    const cellW = Math.round(platform.width * scale);
    const cellH = Math.round((cellW * 4) / 3);
    const n = validPanels.length;
    canvas.width = cellW;
    canvas.height = cellH * n;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cellW, canvas.height);
    for (let i = 0; i < n; i++) {
      const oy = i * cellH;
      const panelIdx = project.panels.indexOf(validPanels[i]);
      if (imgs[i]) drawImageCover(ctx, imgs[i], 0, oy, cellW, cellH);
      drawBubbles(ctx, project, panelIdx, 0, oy, cellW, cellH);
    }
  }

  if (opts.watermark) watermark(ctx, canvas.width, canvas.height);
  // AI 生成显式标识:全档位强制加盖,不随会员/水印开关变化(提供者法定义务)
  aiBadge(ctx, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export async function downloadDataUrl(dataUrl: string, filename: string) {
  // data URL 直接塞 <a href> 在 Chrome/安卓上超约2MB会静默失败,转 Blob URL 下载
  const blob = await (await fetch(dataUrl)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
