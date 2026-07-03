import { NextResponse } from "next/server";
import { runPlotAndStoryboard, offlinePlotAndStoryboard, type PlotAndStoryboardInput } from "@/lib/plotAndStoryboard";
import { hasKey, PLOT_STORYBOARD_MODEL } from "@/lib/llm";
import { moderateText } from "@/lib/moderation";
import { rateLimit } from "@/lib/apiGuard";

export async function POST(req: Request) {
  const limited = rateLimit(req, "llm", 1);
  if (limited) return NextResponse.json({ status: "error", clarifyMessage: limited }, { status: 429 });

  const body = (await req.json()) as PlotAndStoryboardInput;

  if (!body.synopsis || body.synopsis.trim().length === 0) {
    return NextResponse.json({ status: "insufficient_input", clarifyMessage: "请先输入一句话故事梗概" }, { status: 400 });
  }

  // 输入侧防火墙:梗概+调整方向+角色设定先过审,违禁内容不触达生成模型
  const moderationInput = [
    body.synopsis,
    body.adjustHint || "",
    ...(body.characters || []).map((c) => `${c.name} ${c.canon}`),
    body.lockedExpandedPlot?.plot || "",
  ]
    .filter(Boolean)
    .join("\n");
  const mod = await moderateText(moderationInput);
  if (mod.decision === "BLOCK") {
    return NextResponse.json({ status: "blocked", reason: mod.reason, safeRewrite: mod.safeRewrite });
  }

  if (!hasKey(PLOT_STORYBOARD_MODEL)) {
    return NextResponse.json(offlinePlotAndStoryboard(body));
  }

  const result = await runPlotAndStoryboard(body);
  if (!result) {
    // 调用失败(网络/解析错误),退回离线兜底,保证链路不中断
    return NextResponse.json(offlinePlotAndStoryboard(body));
  }
  return NextResponse.json(result);
}
