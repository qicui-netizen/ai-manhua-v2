import { NextResponse } from "next/server";

// 把远程生成图代理回同源,供前端 canvas 压缩转存。
// 背景:硅基流动返回的图片是带时效的签名 URL(数小时后过期),且其 CDN 不带 CORS 头,
// 前端无法直接 fetch/canvas 读取,必须经服务端代理。
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url || !url.startsWith("https://")) {
    return NextResponse.json({ error: "无效的图片地址" }, { status: 400 });
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return NextResponse.json({ error: "无效的图片地址" }, { status: 400 });
  }
  // 禁止内网地址,避免被当作任意代理使用
  if (/^(localhost$|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    return NextResponse.json({ error: "不允许的地址" }, { status: 400 });
  }
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return NextResponse.json({ error: "图片获取失败" }, { status: 502 });
  return new Response(r.body, {
    headers: {
      "content-type": r.headers.get("content-type") || "image/png",
      "cache-control": "no-store",
    },
  });
}
