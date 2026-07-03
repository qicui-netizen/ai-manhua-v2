// 生图供应商切换层。环境变量 IMAGE_PROVIDER 决定走哪家:
// - "siliconflow"(默认):硅基流动 Qwen-Image-Edit-2509,单格约 0.06-0.10 元,
//   不支持指定出图尺寸(比例靠裁剪+构图安全区兜底)
// - "ark":火山方舟 Doubao-Seedream-4.5,单格约 0.25 元,角色一致性更强,
//   原生支持 3:4/1:1 出图尺寸(2026-07-03 实测对比见 lib/ark.ts 头注)
// 两家共用 GenerateImageInput/GenerateImageResult 契约,路由层无感知。
import { generateImage as generateImageSiliconflow, type GenerateImageInput, type GenerateImageResult } from "./siliconflow";
import { generateImageArk } from "./ark";

function pickProvider(): (input: GenerateImageInput) => Promise<GenerateImageResult> {
  return process.env.IMAGE_PROVIDER === "ark" ? generateImageArk : generateImageSiliconflow;
}

// 带 1 次重试的单格生成(对齐 PRD "失败自动重试1次,不扣额度" 的设计精神,
// 简化为 HTTP/超时失败重试,不做 ArcFace 一致性检测,该能力列为 P1)。
export async function generateImageWithRetry(
  input: GenerateImageInput,
  maxRetries = 1
): Promise<GenerateImageResult> {
  const generate = pickProvider();
  let last: GenerateImageResult = { error: "生成失败(已重试)" };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await generate(input);
    if (result.url) return result;
    last = result;
    // 余额不足/缺key/权限类确定性错误,重试也不会成功
    if (
      result.error?.includes("余额不足") ||
      result.error?.includes("API_KEY") ||
      result.error?.includes("未开通") ||
      result.error?.includes("补授权")
    ) {
      break;
    }
  }
  return last;
}
