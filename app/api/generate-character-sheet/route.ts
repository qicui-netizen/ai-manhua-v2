import { NextResponse } from "next/server";
import { resolveImageUrl } from "@/lib/siliconflow";
import { generateImageWithRetry, hasImageProviderKey } from "@/lib/imageProvider";
import { rateLimit } from "@/lib/apiGuard";

// 角色黄金参考图生成(P1-1)。以用户上传的首张真实照片为依据(图生图),生成一张标准化设定图:
// 纯白底、正面全身、统一成人比例、无水印/文字/背景杂物。之后每格生图优先用它当锚,
// 把"角色长什么样"从每格现场发挥变成照抄标准答案,从源头稳住画风/比例/一致性。
//
// 供应商分叉(评审校正):
// - Seedream(ark):原生支持出图尺寸(3:4 全身像),negative_prompt 折进正向,约束用正向表述。
// - Qwen(siliconflow):不指定尺寸(跟随参考图比例),负向词走独立 negative_prompt 字段。
// 建卡时异步调用、可跳过、消耗 1 格额度(前端明示),仅当用户上传了真实照片时才调用。

// Seedream:约束折进正向 prompt,不塞长串英文负向词(其"三视图看似多人"会与"multiple people"负向打架)
const ARK_PROMPT = `以图1中的人物为唯一依据,严格保持其面部长相、发型发色、五官比例、服装、整体气质完全不变,
为该角色生成一张干净的标准设定图:人物正面全身站立像,居中构图,纯白背景(#ffffff),均匀柔和的打光,
自然的成人身材比例(约7到7.5头身,头身比正常,绝不是大头萌系Q版比例),清晰干净的动漫线稿与上色。
这是同一个人,只是换成标准的正面全身姿势。画面绝对不要出现:水印、logo、文字、字幕、签名、二维码、
边框、任何背景杂物或多余的人物。`;

// Qwen:正向描述 + 独立负向词
const QWEN_PROMPT = `以图1中的人物为唯一依据,保持面部长相/发型发色/五官比例/服装完全不变,生成该角色的
标准设定图:正面全身站立像,纯白背景,均匀柔光,自然成人比例(约7头身),干净的动漫线稿上色。这是同一个人的正面标准像。`;
const QWEN_NEGATIVE =
  "watermark, logo, text, caption, signature, qr code, frame, border, background clutter, extra people, big head small body, chibi proportions, super-deformed, oversized head, multiple people";

export async function POST(req: Request) {
  // 与生图同口径:消耗 1 格额度、按格限流(黄金图是一次真金白银的生图)
  const limited = rateLimit(req, "image", 1);
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });

  const body = (await req.json()) as { imageDataUrl?: string; aspectRatio?: string };
  if (!body.imageDataUrl?.startsWith("data:image/")) {
    return NextResponse.json({ error: "imageDataUrl 必须是图片 data URL" }, { status: 400 });
  }
  if (body.imageDataUrl.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "图片过大" }, { status: 413 });
  }
  if (!hasImageProviderKey()) {
    return NextResponse.json({ error: "未配置生图 API Key" }, { status: 503 });
  }

  const isArk = process.env.IMAGE_PROVIDER === "ark";
  const image = await resolveImageUrl(body.imageDataUrl);
  const gen = await generateImageWithRetry({
    editPrompt: isArk ? ARK_PROMPT : QWEN_PROMPT,
    negativePrompt: isArk ? undefined : QWEN_NEGATIVE,
    images: [image],
    // 黄金图统一 3:4 全身像(Seedream 原生出该尺寸;Qwen 忽略此参数跟随参考图比例)
    aspectRatio: body.aspectRatio || "3:4",
  });
  if (!gen.url) {
    return NextResponse.json({ error: gen.error || "黄金参考图生成失败" }, { status: 502 });
  }
  return NextResponse.json({ url: gen.url });
}
