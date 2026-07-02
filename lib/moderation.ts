// 内容安全审核模块(服务端)——轻量版,零成本。
// 设计取舍(2026-07,成本优先):只做【词库快筛】拦截用户输入里很明显的违禁场景,
// 不调用 LLM/VLM 付费审核;隐晦内容依靠两道免费防线兜底:
//   1. 生成 Agent 系统提示词里的六类硬线(见 plotAndStoryboard.ts / imageEditPrompt.ts)
//   2. 硅基流动模型侧自带的内容审核
// 将来要升级为模型审核,恢复 moderateText 的 LLM 分支即可(git 历史里有完整实现)。
// 硬线六类:未成年性化 / 非自愿性行为 / 真实人物色情 / 极端血腥虐待 / 仇恨煽动 / 犯罪教学。

export type ModerationDecision = "ALLOW" | "WARN" | "BLOCK";

export type ModerationResult = {
  decision: ModerationDecision;
  category: string[];
  reason: string;
  safeRewrite?: string;
  layer: "keyword";
};

const ALLOW_RESULT: ModerationResult = { decision: "ALLOW", category: [], reason: "", layer: "keyword" };

// ── 词库 ──────────────────────────────────────────────────────
// 线索词分组;单独出现不一定违禁(如"高中生"是正常校园题材),组合命中才硬拦。
// 注意:词只放"与违禁强相关"的表述,泛化词(如裸词"学生""开车")误伤率太高,
// 隐晦内容交给生成模型自身的安全约束与平台侧审核兜底。
const MINOR_WORDS = /小学生|初中生|幼女|幼童|萝莉|正太|童颜|未成年|学生妹|小女孩|小男孩|儿童/;
const SEXUAL_WORDS = /色情|裸体|裸露|性行为|做爱|性交|自慰|春宫|情色|性暗示|性感诱惑|挑逗姿势|脱衣|下体|私处|走光|福利姬|涩图/;
const SCHOOL_WORDS = /高中生|中学生|师生恋|老师和学生|寄宿学校/;
// 非自愿类:这些词本身已含强迫+性的复合含义,单独命中即拦
const NONCON_HARD = /强奸|迷奸|轮奸|迷晕后|下药后|囚禁后.{0,6}(发生|恋爱|关系)|性奴/;
const NONCON_SOFT = /强迫|不许拒绝|无法反抗|昏迷中|睡着时|催眠控制|绑架|调教/;
// 偷拍偷窥:强词单独拦,弱词与性词组合拦
const VOYEUR_HARD = /偷拍|偷窥|裙底|偷看.{0,4}(洗澡|换衣|更衣)/;
const VOYEUR_SOFT = /更衣室|浴室|厕所/;
// 极端血腥:细节化虐待词单独拦(战斗/动作类正常表达不在此列)
const GORE_HARD = /肢解|剥皮|开膛|虐杀|凌迟|活埋|血肉模糊|折磨致死|虐待(儿童|老人|动物)|处刑教程/;
// 犯罪教学:实操教程类
const CRIME_HARD = /(制作|自制|如何做)(炸弹|爆炸物|枪支|毒品)|制毒|贩毒(教程|方法)|如何洗钱|伪造(证件|身份证)|如何.{0,6}不被(警察|抓)/;
// 仇恨煽动:最明确的表述
const HATE_HARD = /种族清洗|劣等(民族|种族|人种)|(灭绝|消灭|清除).{0,6}(民族|种族|某国人)/;
// 规避审核的话术:本身就是高风险信号
const EVASION_WORDS = /合法萝莉|千岁幼女|外表(是|像)?(小孩|儿童|幼)但|别说.{0,4}未成年|看起来小但已成年|绕过(审核|限制)|不要审核|擦边一点|隐晦一点(?=.*(色情|裸露|裸体|性暗示|性感))/;

// 拒绝话术:不复述敏感细节
const REJECT_COPY: Record<string, { reason: string; safeRewrite: string }> = {
  minor_sexualization: {
    reason: "内容涉及未成年人相关的敏感描写，无法生成",
    safeRewrite: "可以改为成年角色之间的健康校园回忆或日常剧情",
  },
  non_consensual: {
    reason: "内容涉及非自愿或胁迫情节，无法生成",
    safeRewrite: "可以改写为悬疑、救援或反派被制止的正向剧情",
  },
  voyeurism: {
    reason: "内容涉及偷拍偷窥类情节，无法生成",
    safeRewrite: "可以改为正常的日常生活或误会喜剧场景",
  },
  extreme_gore: {
    reason: "内容涉及过度血腥或虐待细节，无法生成",
    safeRewrite: "战斗冲突可以保留，但请改为非写实、不渲染细节的表现方式",
  },
  crime_instruction: {
    reason: "内容涉及可操作的违法步骤，无法生成",
    safeRewrite: "犯罪题材可以保留戏剧冲突，但请模糊具体方法细节",
  },
  hate: {
    reason: "内容涉及对特定群体的贬损或煽动，无法生成",
    safeRewrite: "可以改为不针对真实群体的虚构阵营冲突",
  },
  evasion: {
    reason: "请求包含规避内容审核的表述，无法生成",
    safeRewrite: "请直接描述健康的剧情设定",
  },
};

function block(category: string): ModerationResult {
  const copy = REJECT_COPY[category] || { reason: "内容未通过安全审核", safeRewrite: "请调整为健康的创作内容" };
  return { decision: "BLOCK", category: [category], reason: copy.reason, safeRewrite: copy.safeRewrite, layer: "keyword" };
}

// 词库快筛(纯函数,零成本)。生成入口、角色卡保存、离线兜底共用。
export function keywordScreen(rawText: string): ModerationResult {
  const text = rawText.replace(/\s+/g, "");
  if (!text) return ALLOW_RESULT;

  if (EVASION_WORDS.test(text)) return block("evasion");
  const sexual = SEXUAL_WORDS.test(text);
  if (sexual && (MINOR_WORDS.test(text) || SCHOOL_WORDS.test(text))) return block("minor_sexualization");
  if (NONCON_HARD.test(text)) return block("non_consensual");
  if (sexual && NONCON_SOFT.test(text)) return block("non_consensual");
  if (VOYEUR_HARD.test(text)) return block("voyeurism");
  if (sexual && VOYEUR_SOFT.test(text)) return block("voyeurism");
  if (GORE_HARD.test(text)) return block("extreme_gore");
  if (CRIME_HARD.test(text)) return block("crime_instruction");
  if (HATE_HARD.test(text)) return block("hate");
  return ALLOW_RESULT;
}

// 文本审核入口:轻量版只跑词库(异步签名保留,方便将来无缝升级回模型审核)
export async function moderateText(text: string): Promise<ModerationResult> {
  return keywordScreen((text || "").trim());
}
