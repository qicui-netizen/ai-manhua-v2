import { NextResponse } from "next/server";
import { moderateText } from "@/lib/moderation";

// 内容审核入口(轻量版:纯词库,零成本)。当前仅供角色卡保存时审文本设定;
// 剧情生成的审核不走这里,直接在 /api/plot-and-storyboard 服务端入口拦截。
// 图片不做机器审核(成本考虑),由生成模型侧的内置审核兜底。
type ModerateBody = {
  text?: string;
  scene?: string; // 仅用于日志定位
};

export async function POST(req: Request) {
  const body = (await req.json()) as ModerateBody;
  if (!body.text?.trim()) {
    return NextResponse.json({ error: "text 必填" }, { status: 400 });
  }
  const result = await moderateText(body.text);
  if (result.decision !== "ALLOW") {
    console.warn(`[moderate] scene=${body.scene || "-"} decision=${result.decision} category=${result.category.join(",")}`);
  }
  return NextResponse.json(result);
}
