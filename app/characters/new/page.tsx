"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCharacter, newId } from "@/lib/store";
import { DEFAULT_AVATAR_POOL } from "@/lib/data";
import type { Character, UploadedImage, LockLevel } from "@/lib/types";

// 手机照片动辄数 MB(iPhone 还是 HEIC),原图直接转 base64 会卡顿且撑爆 localStorage(约5MB上限),
// 统一缩放到最长边 1024 并重编码为 JPEG 后再入库。
function readAndCompress(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 1024;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        // 先铺白底:透明PNG直接转JPEG时透明像素会变纯黑,污染角色参考图
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片无法解码"));
    };
    img.src = objectUrl;
  });
}

export default function NewCharacterPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [personality, setPersonality] = useState("");
  const [ownershipType, setOwnershipType] = useState<"original_oc" | "fanwork">("original_oc");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lockedTraits, setLockedTraits] = useState<{ face: LockLevel; hair: LockLevel; outfit: LockLevel; color: LockLevel }>({
    face: "强锁定",
    hair: "强锁定",
    outfit: "弱锁定",
    color: "强锁定",
  });

  async function handleFiles(files: File[]) {
    if (files.length === 0 || uploading) return;
    if (images.length >= 6) {
      setUploadError("最多上传 6 张参考图，请先删除部分图片后再添加");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const list = files.slice(0, 6 - images.length);
      const uploaded: UploadedImage[] = [];
      for (const file of list) {
        try {
          const url = await readAndCompress(file);
          uploaded.push({ id: newId("img"), url, role: "secondary" });
        } catch {
          // 该浏览器解不开的格式(如安卓上的 HEIC),跳过并提示
        }
      }
      if (uploaded.length > 0) {
        setImages((prev) => {
          const merged = [...prev, ...uploaded].slice(0, 6);
          return merged.map((img, i) => ({ ...img, role: i === 0 ? ("primary" as const) : ("secondary" as const) }));
        });
      }
      if (uploaded.length < list.length) {
        setUploadError(`有 ${list.length - uploaded.length} 张图片格式不支持，已跳过（建议用 JPG/PNG）`);
      }
    } finally {
      setUploading(false);
    }
  }

  function toggleLock(field: keyof typeof lockedTraits) {
    setLockedTraits((prev) => {
      const order: LockLevel[] = ["强锁定", "弱锁定", "不锁定"];
      const next = order[(order.indexOf(prev[field]) + 1) % order.length];
      return { ...prev, [field]: next };
    });
  }

  function goBack() {
    if (step === 2) {
      setStep(1);
      return;
    }
    // 固定回角色库:router.back() 在直接打开本页(无历史)时会退出应用或无反应
    router.push("/characters");
  }

  function handleSave() {
    if (saving) return; // 防移动端双击创建两张重复角色卡
    setSaving(true);
    const finalName = name.trim() || "新角色";
    const referenceImages: UploadedImage[] =
      images.length > 0
        ? images
        : [{ id: newId("img"), url: DEFAULT_AVATAR_POOL[Math.floor(Math.random() * DEFAULT_AVATAR_POOL.length)], role: "primary" }];

    const character: Character = {
      id: newId("char"),
      name: finalName,
      ownershipType,
      source: images.length > 0 ? "photo_upload" : "text_only",
      ageFeel: "",
      canon: `${finalName},${desc || "外貌描述待补充"}${personality ? `,性格:${personality}` : ""}`,
      outfit: "",
      referenceImages,
      visual: { hair: "#7c3aed", hairStyle: "long", skin: "#ffe7d6", eye: "#374151", accent: "#a855f7" },
      lockedTraits,
      negativeTraits: [],
      createdAt: Date.now(),
    };
    try {
      saveCharacter(character);
    } catch {
      // localStorage 超出容量(手机浏览器约5MB)时 setItem 会抛异常
      setUploadError("保存失败：本地存储空间不足，请减少参考图数量后重试");
      setStep(1);
      setSaving(false);
      return;
    }
    router.push(`/create?character=${character.id}`);
  }

  return (
    <div className="flex min-h-full flex-col pb-10">
      <div className="flex items-center gap-2 px-5 pt-8 pb-4">
        <button onClick={goBack} aria-label="返回" className="flex h-9 w-9 items-center justify-center">
          <svg width="10" height="17" viewBox="0 0 10 17" fill="none">
            <path d="M9 1L1 8.5L9 16" stroke="var(--color-primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="text-lg font-extrabold text-[var(--color-text)]">{step === 1 ? "新建角色卡" : "确认角色特征"}</h1>
        <span className="ml-auto text-sm text-[var(--color-text-dim)]">{step} / 2</span>
      </div>

      <div className="flex-1 px-5">
        {step === 1 ? (
          <>
            <label
              htmlFor="ref-upload"
              className="mb-4 block cursor-pointer rounded-2xl border-[1.5px] border-dashed border-[var(--color-border-light)] p-6 text-center"
            >
              {images.length > 0 ? (
                <div className="mb-3 flex flex-wrap justify-center gap-2">
                  {images.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={img.id} src={img.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  ))}
                </div>
              ) : (
                <div className="mb-2 text-3xl">🖼️</div>
              )}
              <p className="mb-1 text-sm font-semibold text-[var(--color-text)]">
                {uploading ? "上传中…" : images.length > 0 ? `已上传 ${images.length} 张，点击继续添加` : "上传参考图（强烈建议）"}
              </p>
              <p className="text-xs text-[var(--color-text-dim)]">最多 6 张，AI 会用第一张锁定角色一致性</p>
              <span className="pf-btn pf-btn-secondary mt-3 !inline-flex !min-h-9 !py-2 !px-4 text-sm">
                选择图片
              </span>
              <input
                id="ref-upload"
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  // 先同步取出 File 引用再清空 value:iOS WebKit 上边读边清可能中断读取
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = "";
                  handleFiles(files);
                }}
              />
            </label>
            {uploadError && (
              <div className="-mt-2 mb-3 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)] p-3 text-xs text-[#F59E0B]">
                {uploadError}
              </div>
            )}

            <div className="mb-5 flex flex-col gap-3">
              <div>
                <label className="mb-1.5 block text-xs text-[var(--color-text-sub)]">角色名 *</label>
                <input className="pf-input" placeholder="例如：云绯" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-[var(--color-text-sub)]">外貌描述</label>
                <textarea
                  className="pf-input resize-none"
                  rows={2}
                  placeholder="粉色长发，红色瞳孔，活泼可爱的高中女生…"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-[var(--color-text-sub)]">性格 / 口癖</label>
                <input
                  className="pf-input"
                  placeholder="开朗、话多、喜欢用「呀」结尾"
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-[var(--color-text-sub)]">角色类型</label>
                <div className="flex gap-2">
                  <button
                    className={`pf-chip ${ownershipType === "original_oc" ? "active" : ""}`}
                    onClick={() => setOwnershipType("original_oc")}
                  >
                    OC 原创
                  </button>
                  <button
                    className={`pf-chip ${ownershipType === "fanwork" ? "active" : ""}`}
                    onClick={() => setOwnershipType("fanwork")}
                  >
                    同人角色（仅非商用）
                  </button>
                </div>
              </div>
            </div>

            <button onClick={() => setStep(2)} disabled={!name.trim()} className="pf-btn pf-btn-primary w-full">
              下一步：确认特征锁定 →
            </button>
          </>
        ) : (
          <>
            <p className="mb-3.5 text-xs text-[var(--color-text-sub)]">设置强锁定特征，生成时 AI 会严格保持</p>
            <div className="mb-4 flex flex-col gap-2">
              {(
                [
                  { key: "face", label: "面部", emoji: "👤" },
                  { key: "hair", label: "发色", emoji: "💇" },
                  { key: "outfit", label: "主服装", emoji: "👗" },
                  { key: "color", label: "色调", emoji: "🎨" },
                ] as const
              ).map((f) => (
                <div key={f.key} className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-2)] p-3">
                  <span className="text-xl">{f.emoji}</span>
                  <div className="flex-1">
                    <p className="text-xs text-[var(--color-text-dim)]">{f.label}</p>
                  </div>
                  <button
                    onClick={() => toggleLock(f.key)}
                    className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs font-bold"
                    style={{
                      background: lockedTraits[f.key] === "强锁定" ? "var(--color-primary)" : "var(--color-surface)",
                      color: lockedTraits[f.key] === "强锁定" ? "#fff" : "var(--color-text-dim)",
                    }}
                  >
                    {lockedTraits[f.key]}
                  </button>
                </div>
              ))}
            </div>

            {images.length === 0 && (
              <div className="mb-4 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)] p-3 text-xs text-[#F59E0B]">
                未上传参考图，将自动分配系统占位头像。角色一致性效果会弱于真实照片，建议返回上一步补传。
              </div>
            )}

            <button onClick={handleSave} disabled={saving} className="pf-btn pf-btn-primary w-full">
              {saving ? "保存中…" : "保存角色卡"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
