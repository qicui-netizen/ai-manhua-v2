"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadProjects,
  getQuota,
  getPlanClient,
  setPlanClient,
  deleteProject,
  getUserProfile,
  saveUserProfile,
  getSession,
  clearSession,
  maskAccount,
  FREE_MONTHLY_QUOTA,
  type Plan,
  type UserProfile,
  type AuthSession,
} from "@/lib/store";
import type { Project } from "@/lib/types";

// 头像压缩:最长边256已足够,避免撑大localStorage
function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 256;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch (e) {
        reject(e);
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

export default function ProfilePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [quota, setQuota] = useState(FREE_MONTHLY_QUOTA);
  const [plan, setPlan] = useState<Plan>("free");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile>({ name: "漫画创作者", avatar: "" });
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = () => {
      setProjects(loadProjects());
      setQuota(getQuota());
      setPlan(getPlanClient());
      setUser(getUserProfile());
      setSession(getSession());
    };
    refresh();
    window.addEventListener("pf:update", refresh);
    return () => window.removeEventListener("pf:update", refresh);
  }, []);

  async function handleAvatarChange(file: File | undefined) {
    if (!file) return;
    try {
      const avatar = await compressAvatar(file);
      saveUserProfile({ ...getUserProfile(), avatar });
    } catch {
      /* 解码失败忽略 */
    }
  }

  function commitName() {
    const name = nameDraft.trim();
    if (name) saveUserProfile({ ...getUserProfile(), name });
    setEditingName(false);
  }

  const exportedCount = projects.reduce((sum, p) => sum + p.exports, 0);
  const usedQuota = FREE_MONTHLY_QUOTA - quota;

  function handleUpgrade() {
    if (plan === "member") return;
    setPlanClient("member");
    alert("演示版：已切换为会员（未接入真实支付）");
  }

  return (
    <div className="flex min-h-full flex-col pb-24">
      <div className="px-5 pt-8 pb-3">
        <h1 className="text-xl font-extrabold text-[var(--color-text)]">我的</h1>
      </div>

      <div className="flex-1 px-5">
        {/* 用户卡:头像可点击更换,昵称可编辑 */}
        <div className="pf-card mb-4 flex items-center gap-3.5">
          <button
            onClick={() => avatarInputRef.current?.click()}
            aria-label="更换头像"
            className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full border-2 border-[rgba(124,58,237,0.4)]"
          >
            {user.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar} alt="头像" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-[var(--color-surface-2)] text-2xl">👤</span>
            )}
            <span className="absolute bottom-0 left-0 right-0 bg-black/55 py-0.5 text-center text-[9px] text-white">更换</span>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              handleAvatarChange(f);
            }}
          />
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  className="pf-input !min-h-9 !py-1.5 text-sm"
                  value={nameDraft}
                  maxLength={16}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && commitName()}
                />
                <button onClick={commitName} className="pf-btn pf-btn-primary !min-h-9 flex-shrink-0 !px-3 !py-1.5 text-xs">
                  保存
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setNameDraft(user.name);
                  setEditingName(true);
                }}
                className="flex items-center gap-1.5 text-left"
                aria-label="编辑昵称"
              >
                <span className="truncate text-[16px] font-bold text-[var(--color-text)]">{user.name}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" strokeWidth="2" strokeLinecap="round">
                  <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
            )}
            {session ? (
              <p className="mt-0.5 text-[11px] text-[var(--color-text-dim)]">
                {session.method === "phone" ? "📱" : "✉️"} {maskAccount(session)} · 点击头像或昵称可修改
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-[var(--color-text-dim)]">点击头像或昵称即可修改</p>
            )}
          </div>
          {!session && (
            <button
              onClick={() => router.push("/login")}
              className="pf-btn pf-btn-primary !min-h-9 flex-shrink-0 !px-4 !py-2 text-sm"
            >
              登录
            </button>
          )}
        </div>

        {/* 套餐卡 */}
        <div className="pf-card mb-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[15px] font-bold text-[var(--color-text)]">
                  {plan === "member" ? "会员版" : "免费版"}
                </span>
                {plan === "member" && (
                  <span className="rounded-full bg-[rgba(124,58,237,0.15)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary-light)]">
                    高清 · 无水印
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-sub)]">
                本月剩余额度 {quota}/{FREE_MONTHLY_QUOTA}
              </p>
            </div>
            {plan !== "member" && (
              <button onClick={handleUpgrade} className="pf-btn pf-btn-primary !min-h-9 !py-2 !px-4 text-sm">
                升级会员
              </button>
            )}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-light)]"
              style={{ width: `${FREE_MONTHLY_QUOTA ? (usedQuota / FREE_MONTHLY_QUOTA) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* 统计 */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="pf-card text-center">
            <p className="text-2xl font-extrabold text-[var(--color-text)]">{projects.length}</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-dim)]">创作作品</p>
          </div>
          <div className="pf-card text-center">
            <p className="text-2xl font-extrabold text-[var(--color-text)]">{exportedCount}</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-dim)]">导出次数</p>
          </div>
        </div>

        {/* 历史作品 */}
        <p className="mb-2 text-[13px] font-bold text-[var(--color-text)]">我的作品</p>
        {projects.length === 0 ? (
          <div className="pf-card flex flex-col items-center gap-2 py-8 text-center text-[var(--color-text-dim)]">
            <div className="text-3xl">🖋️</div>
            <p className="text-sm">还没有创作过短篇</p>
            <button onClick={() => router.push("/")} className="pf-btn pf-btn-secondary !min-h-9 !py-2 !px-4 text-sm">
              去创作
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {projects.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  setDeletingId(null);
                  router.push(`/project/${p.id}/storyboard`);
                }}
                className="pf-card flex cursor-pointer items-center gap-3"
              >
                <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl bg-[var(--color-surface-2)]">
                  {p.panels.find((pn) => pn.imageUrl)?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.panels.find((pn) => pn.imageUrl)!.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-lg">🖼️</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-[var(--color-text)]">{p.title}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-text-dim)]">
                    {p.panelCount} 格 · {p.exports > 0 ? `已导出 ${p.exports} 次` : "未导出"}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (deletingId === p.id) {
                      deleteProject(p.id);
                      setDeletingId(null);
                    } else {
                      setDeletingId(p.id);
                    }
                  }}
                  aria-label={`删除作品${p.title}`}
                  className="flex-shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold"
                  style={{
                    borderColor: deletingId === p.id ? "var(--color-error)" : "var(--color-border)",
                    background: deletingId === p.id ? "rgba(239,68,68,0.15)" : "transparent",
                    color: deletingId === p.id ? "var(--color-error)" : "var(--color-text-dim)",
                  }}
                >
                  {deletingId === p.id ? "确认删除?" : "删除"}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 退出登录:两步确认,只清会话不动本地作品/角色数据 */}
        {session && (
          <button
            onClick={() => {
              if (confirmingLogout) {
                clearSession();
                setConfirmingLogout(false);
              } else {
                setConfirmingLogout(true);
              }
            }}
            className="mt-6 w-full rounded-xl border py-3 text-sm font-semibold transition-colors"
            style={{
              borderColor: confirmingLogout ? "var(--color-error)" : "var(--color-border)",
              background: confirmingLogout ? "rgba(239,68,68,0.15)" : "var(--color-surface)",
              color: confirmingLogout ? "var(--color-error)" : "var(--color-text-sub)",
            }}
          >
            {confirmingLogout ? "确认退出登录?(本地作品不会丢失)" : "退出登录"}
          </button>
        )}

        {/* 协议入口 */}
        <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-[var(--color-text-dim)]">
          <button onClick={() => router.push("/terms")}>用户协议</button>
          <span>·</span>
          <button onClick={() => router.push("/privacy")}>隐私政策</button>
        </div>
      </div>
    </div>
  );
}
