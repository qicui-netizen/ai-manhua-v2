// 核心数据类型。对齐《PanelForge · 编剧分镜一体化 Agent 设计报告》(PF-AGENT-004)
// 与 agent4-test-kit 的图像编辑指令 Schema。

export type LockLevel = "强锁定" | "弱锁定" | "不锁定";

export type CharacterSource = "photo_upload" | "library_character" | "text_only";

export type UploadedImage = {
  id: string;
  url: string; // 本地存储阶段为 data URL / object URL
  role: "primary" | "style_reference" | "secondary";
};

export type Character = {
  id: string;
  name: string;
  ownershipType: "original_oc" | "fanwork"; // 原创 OC / 同人(仅非商用),对齐 PRD D8
  source: CharacterSource;
  ageFeel: string;
  canon: string; // 人设「宪法」:锁定的外形特征描述
  // 排他性标志特征:最能把该角色和其他角色区分开的 1-3 个独特标记(如"左眼下泪痣、总戴红围巾、
  // 右耳三个耳骨钉")。与 canon(泛化外貌)不同,它专用于多角色同框防串脸——生图指令 Agent 强制
  // 让每个角色引用各自的 signatureFeatures,避免 CP 两张脸越画越像。AI 识图自动提取,用户可改。可选。
  signatureFeatures?: string;
  outfit: string;
  referenceImages: UploadedImage[]; // 用户上传的真实参考图(0-6张)
  visual: {
    hair: string;
    hairStyle: "short" | "long" | "ponytail";
    skin: string;
    eye: string;
    accent: string;
    mole?: boolean;
  };
  lockedTraits: { face: LockLevel; hair: LockLevel; outfit: LockLevel; color: LockLevel };
  negativeTraits: string[];
  createdAt: number;
};

// ── 合并 Agent(编剧+分镜)产物 ──────────────────────────────────
export type ExpandedPlot = {
  toneLabel: string;
  conflict: string;
  scene: string;
  charactersState: string;
  plot: string;
  keyDialogues: string[];
  dialogueCount: string;
  ending: string;
  beats: { 起: string; 承: string; 转: string; 合: string };
  riskNotes: string[];
};

// ── 气泡样式(用户可在气泡编辑页调整) ──────────────────────────
export type BubbleShape = "oval" | "burst" | "box"; // 椭圆对话泡 | 爆炸泡 | 方形旁白框
// 九宫格位置:1左上 2中上 3右上 4左中 5正中 6右中 7左下 8中下 9右下
export type BubbleAnchor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type BubbleStyle = {
  shape: BubbleShape;
  anchor: BubbleAnchor;
  opacity: number; // 白底透明度 0.3~1
};

export type ImageSlot = {
  slot: 1 | 2 | 3 | 4;
  refType: "oc_character" | "style_reference" | "prop_reference";
  refKey: string; // 映射到 Character.referenceImages[].id 或风格库图片 id
};

export type Panel = {
  panelId: number;
  beat: "起" | "承" | "转" | "合";
  scene: string;
  camera: string;
  characterAction: string;
  emotion: string;
  // 与上一格的连续性衔接(站位/朝向/视线/道具/情绪如何承接),供生图指令 Agent 保持格间一致,
  // 治"分格孤立生成导致站位朝向跳变、剧情不连贯"。可选:旧项目数据与首格无此字段
  continuityNote?: string;
  dialogue: string;
  caption: string;
  // 气泡样式,缺省时用 lib/bubbles.ts 的默认值(旧项目数据兼容)
  dialogueBubble?: BubbleStyle;
  captionBubble?: BubbleStyle;
  visualPromptHint: string;
  // 生图落地阶段追加字段
  imageSlots?: ImageSlot[];
  editPrompt?: string;
  negativePrompt?: string;
  imageUrl?: string;
  status: "idle" | "loading" | "done" | "error";
  retryCount?: number;
};

export type TemplateType = "4_panel" | "9_panel" | "vertical_strip";
export type TargetPlatform =
  | "xhs_vertical"
  | "xhs_square"
  | "xhs_grid9"
  | "kuaikan_strip"
  | "moments_grid9";

export type ProjectStatus =
  | "draft_plot"
  | "plot_confirmed"
  | "storyboard_confirmed"
  | "generating"
  | "generated"
  | "exported";

export type Project = {
  id: string;
  title: string;
  characterIds: string[];
  templateType: TemplateType;
  panelCount: number;
  styleId: string;
  targetPlatform: TargetPlatform;
  tone: string;
  synopsis: string; // 用户一句话或自写一段
  plotSource: "ai_expanded" | "user_written";

  expandedPlot?: ExpandedPlot;
  panels: Panel[];

  status: ProjectStatus;
  ownershipType: "original_oc" | "fanwork"; // 从角色继承的最严格值,决定导出侧商用拦截
  createdAt: number;
  exports: number;
  // 存储写满时旧作品图片被自动释放的标记(saveProject 降级策略),作品卡据此显示角标
  imagesTrimmed?: boolean;
  // 分镜阶段检测到的、剧情里出现但用户未建角色卡的人物(如凭空出现的女主),
  // 携带 LLM 生成的固定外貌锚,生成阶段传给生图指令 Agent 保证该人物每格长相一致
  unmatchedCharacters?: { name: string; appearanceAnchor: string }[];
};
