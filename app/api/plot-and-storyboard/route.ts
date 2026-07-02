import { NextResponse } from "next/server";
import { runPlotAndStoryboard, offlinePlotAndStoryboard, type PlotAndStoryboardInput } from "@/lib/plotAndStoryboard";
import { hasKey, PLOT_STORYBOARD_MODEL } from "@/lib/llm";

export async function POST(req: Request) {
  const body = (await req.json()) as PlotAndStoryboardInput;

  if (!body.synopsis || body.synopsis.trim().length === 0) {
    return NextResponse.json({ status: "insufficient_input", clarifyMessage: "请先输入一句话故事梗概" }, { status: 400 });
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
