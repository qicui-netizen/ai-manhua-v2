"use client";
// 生成图是硅基流动的临时签名 URL(数小时后过期),不转存的话隔天项目里的图全部失效,
// 导出页也会因为图片加载失败而合成不出稿件。生成成功后立即经 /api/proxy-image
// 拉回来压缩成 JPEG data URL 持久化进 localStorage。

export async function persistRemoteImage(url: string): Promise<string> {
  if (!url.startsWith("http")) return url; // 已经是 data URL 等本地形态
  try {
    const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
    if (!res.ok) return url;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const MAX = 1080;
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return url; // 转存失败保留远程 URL,短期内仍可用
  }
}
