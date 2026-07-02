"use client";
// 导出合成器:纯前端 canvas,把多格图 + 气泡合成成目标平台尺寸的 PNG,免费层打水印。
import type { Project } from "./types";
import type { Platform } from "./data";
import { layoutBubbles } from "./bubbles";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
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

function drawWrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const chars = [...text];
  let line = "";
  let yy = y;
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = ch;
      yy += lh;
    } else line += ch;
  }
  if (line) ctx.fillText(line, x, yy);
  return yy;
}

function drawBubbles(ctx: CanvasRenderingContext2D, project: Project, panelIdx: number, ox: number, oy: number, cell: number) {
  const panel = project.panels[panelIdx];
  const bubbles = layoutBubbles(panel);
  for (const b of bubbles) {
    const fs = Math.round(cell * 0.045);
    ctx.font = `600 ${fs}px "PingFang SC", system-ui, sans-serif`;
    const bw = b.w * cell;
    const padX = cell * 0.025;
    if (b.type === "caption") {
      const h = cell * 0.085;
      ctx.fillStyle = "rgba(20,18,32,0.78)";
      roundRect(ctx, ox + b.x * cell, oy + b.y * cell, bw, h, h * 0.25);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(b.text.slice(0, 24), ox + b.x * cell + padX, oy + b.y * cell + h / 2);
    } else {
      const lines = Math.ceil(ctx.measureText(b.text).width / (bw - padX * 2)) || 1;
      const h = fs * 1.5 * lines + padX * 2;
      const bx = ox + b.x * cell;
      const by = oy + b.y * cell;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.strokeStyle = "#2a2540";
      ctx.lineWidth = Math.max(2, cell * 0.004);
      roundRect(ctx, bx, by, bw, h, cell * 0.04);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx + bw * 0.2, by + h - 1);
      ctx.lineTo(bx + bw * 0.12, by + h + cell * 0.05);
      ctx.lineTo(bx + bw * 0.32, by + h - 1);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fill();
      ctx.fillStyle = "#2a2540";
      ctx.textBaseline = "top";
      drawWrapped(ctx, b.text, bx + padX, by + padX, bw - padX * 2, fs * 1.5);
    }
  }
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

export async function composeExport(
  project: Project,
  platform: Platform,
  opts: { hd: boolean; watermark: boolean }
): Promise<string> {
  const validPanels = project.panels.filter((p) => p.imageUrl);
  const imgs = await Promise.all(validPanels.map((p) => loadImage(p.imageUrl!)));
  const scale = opts.hd ? 1 : 0.5;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  if (platform.grid) {
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
      if (imgs[i]) ctx.drawImage(imgs[i], ox, oy, cell, cell);
      drawBubbles(ctx, project, panelIdx, ox, oy, cell);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4;
      ctx.strokeRect(ox, oy, cell, cell);
    }
  } else {
    const width = Math.round(platform.width * scale);
    const cell = width;
    const n = validPanels.length;
    canvas.width = width;
    canvas.height = cell * n;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, canvas.height);
    for (let i = 0; i < n; i++) {
      const oy = i * cell;
      const panelIdx = project.panels.indexOf(validPanels[i]);
      if (imgs[i]) ctx.drawImage(imgs[i], 0, oy, cell, cell);
      drawBubbles(ctx, project, panelIdx, 0, oy, cell);
    }
  }

  if (opts.watermark) watermark(ctx, canvas.width, canvas.height);
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
