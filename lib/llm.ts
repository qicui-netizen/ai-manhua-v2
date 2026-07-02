// LLM 抽象层。当前统一走硅基流动(SiliconFlow)的 OpenAI 兼容协议,
// 通过 LLMProviderConfig 显式传入 baseUrl/model,而不是隐式从某个 env 名称推断——
// 这样未来切换模型(如换成 deepseek-v4-flash)只改配置,不改调用代码。

export type LLMProviderConfig = {
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
};

export function hasKey(config: LLMProviderConfig): boolean {
  return !!process.env[config.apiKeyEnv];
}

export const PLOT_STORYBOARD_MODEL: LLMProviderConfig = {
  baseUrl: process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1",
  apiKeyEnv: "SILICONFLOW_API_KEY",
  model: process.env.PLOT_STORYBOARD_MODEL || "deepseek-ai/DeepSeek-V3",
  temperature: 0.85,
  maxTokens: 4096,
};

// 图像编辑指令构建 Agent(agent4)用的文本模型,可与主 Agent 不同,便于分别调优成本。
export const IMAGE_EDIT_PROMPT_MODEL: LLMProviderConfig = {
  baseUrl: process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1",
  apiKeyEnv: "SILICONFLOW_API_KEY",
  model: process.env.IMAGE_EDIT_PROMPT_MODEL || "deepseek-ai/DeepSeek-V3",
  temperature: 0.4,
  maxTokens: 1024,
};

export async function chatComplete(
  config: LLMProviderConfig,
  system: string,
  user: string
): Promise<string | null> {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) return null;
  try {
    const r = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: config.temperature ?? 0.7,
        max_tokens: config.maxTokens ?? 2048,
      }),
    });
    if (!r.ok) {
      console.error("[llm] request failed", r.status, await r.text().catch(() => ""));
      return null;
    }
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" ? text : null;
  } catch (e) {
    console.error("[llm] request error", e);
    return null;
  }
}

// 剥掉 LLM 偶尔加的 ```json 代码块围栏,尽量拿到纯 JSON 文本。
export function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}
