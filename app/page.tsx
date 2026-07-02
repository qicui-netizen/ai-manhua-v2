"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadProjects, loadCharacters, getQuota, deleteProject, getUserProfile, FREE_MONTHLY_QUOTA } from "@/lib/store";
import { CHARACTERS } from "@/lib/data";
import type { Project, Character } from "@/lib/types";

const SEED_IDS = new Set(CHARACTERS.map((c) => c.id));

const ONBOARD_KEY = "pf_onboarded_v1";

export default function WorkspacePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [quota, setQuota] = useState(FREE_MONTHLY_QUOTA);
  const [avatar, setAvatar] = useState("");

  useEffect(() => {
    // 仅"真正首次访问"引导到新建角色卡(一次性标记);之后点工作台Tab正常显示,
    // 否则没建角色前工作台永远进不去,返回键也会陷入循环
    const isFirstVisit =
      !localStorage.getItem(ONBOARD_KEY) &&
      loadProjects().length === 0 &&
      !loadCharacters().some((c) => !SEED_IDS.has(c.id));
    if (isFirstVisit) {
      localStorage.setItem(ONBOARD_KEY, "1");
      router.replace("/characters/new");
      return; // 保持 ready=false,重定向期间不闪现工作台内容
    }
    const refresh = () => {
      setProjects(loadProjects());
      setCharacters(loadCharacters());
      setQuota(getQuota());
      setAvatar(getUserProfile().avatar);
    };
    refresh();
    setReady(true);
    window.addEventListener("pf:update", refresh);
    return () => window.removeEventListener("pf:update", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return <div className="flex min-h-full items-center justify-center"><div className="pf-spinner" /></div>;
  }

  const hasContent = projects.length > 0;
  const usedRatio = Math.round(((FREE_MONTHLY_QUOTA - quota) / FREE_MONTHLY_QUOTA) * 100);

  return (
    <div className="flex min-h-full flex-col pb-10">
      <div className="flex items-center justify-between px-5 pt-8 pb-3">
        <div>
          <h1 className="text-xl font-extrabold text-[var(--color-text)]">工作台</h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-dim)]">
            本月剩余 <span className="font-bold text-[var(--color-primary-light)]">{quota}</span> 次生成
          </p>
        </div>
        <Link
          href="/profile"
          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] text-lg"
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="我的" className="h-full w-full object-cover" />
          ) : (
            "👤"
          )}
        </Link>
      </div>

      <div className="mx-5 mb-4">
        <div className="mb-1.5 flex justify-between">
          <span className="text-xs text-[var(--color-text-dim)]">本月生成额度</span>
          <span className="text-xs text-[var(--color-text-sub)]">
            {FREE_MONTHLY_QUOTA - quota} / {FREE_MONTHLY_QUOTA}
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)] transition-all"
            style={{ width: `${usedRatio}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5">
        {hasContent ? <ContentState projects={projects} characters={characters} /> : <EmptyState />}
      </div>

      <Link
        href="/characters"
        className="fixed bottom-24 right-6 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-dark)] shadow-[0_4px_20px_rgba(124,58,237,0.5)] sm:absolute"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </Link>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="pb-8">
      <div className="py-5 text-center">
        <div className="mx-auto mb-3.5 flex h-18 w-18 items-center justify-center rounded-[20px] border border-[rgba(124,58,237,0.3)] bg-gradient-to-br from-[rgba(124,58,237,0.2)] to-[rgba(168,85,247,0.1)] text-3xl">
          📖
        </div>
        <p className="mb-1.5 text-lg font-bold text-[var(--color-text)]">创作你的第一篇漫格</p>
        <p className="text-[13px] leading-relaxed text-[var(--color-text-sub)]">
          OC / 同人角色都支持
          <br />
          上传照片或一句话，直接生成短篇
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-3">
        <Link href="/characters" className="pf-card border-[1.5px] border-[rgba(124,58,237,0.3)]">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-[#7C3AED] to-[#A855F7] text-xl">
              👤
            </div>
            <div className="flex-1">
              <p className="text-[15px] font-bold text-[var(--color-text)]">创建我的角色</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-sub)]">上传照片或文字描述，建立角色卡</p>
            </div>
            <Chevron />
          </div>
        </Link>

        <Link href="/create" className="pf-card border-[1.5px] border-[rgba(245,158,11,0.3)]">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-[#F59E0B] to-[#D97706] text-xl">
              ✍️
            </div>
            <div className="flex-1">
              <p className="text-[15px] font-bold text-[var(--color-text)]">一句话生成漫格</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-sub)]">AI 补全剧情 → 自动生成分镜 → 导出</p>
            </div>
            <Chevron />
          </div>
        </Link>
      </div>
    </div>
  );
}

function ContentState({ projects, characters }: { projects: Project[]; characters: Character[] }) {
  const draft = projects.find((p) => p.status !== "exported");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  return (
    <div className="pb-8">
      {draft && (
        <Link
          href={`/project/${draft.id}/storyboard`}
          className="mb-5 block rounded-2xl border-[1.5px] border-[rgba(124,58,237,0.35)] bg-gradient-to-br from-[rgba(124,58,237,0.18)] to-[rgba(168,85,247,0.08)] p-4"
        >
          <div className="mb-3 flex items-center gap-2.5">
            <div className="text-lg">📝</div>
            <div>
              <p className="text-sm font-bold text-[var(--color-text)]">{draft.title || "未完成草稿"}</p>
              <p className="text-xs text-[var(--color-text-sub)]">
                {draft.templateType === "4_panel" ? "4格" : draft.templateType === "9_panel" ? "9格" : "条漫"} ·{" "}
                {draft.panels.length} 格
              </p>
            </div>
            <span className="ml-auto rounded-full bg-[rgba(245,158,11,0.2)] px-2.5 py-0.5 text-[11px] font-semibold text-[#F59E0B]">
              草稿
            </span>
          </div>
          <div className="flex justify-end">
            <span className="text-xs text-[var(--color-text-dim)]">点击继续编辑 →</span>
          </div>
        </Link>
      )}

      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[15px] font-bold text-[var(--color-text)]">我的角色</p>
        <Link href="/characters" className="text-[13px] text-[var(--color-primary-light)]">
          管理
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {characters.slice(0, 4).map((c) => (
          <Link key={c.id} href={`/create?character=${c.id}`} className="flex flex-shrink-0 flex-col items-center gap-1.5">
            <div className="h-13 w-13 overflow-hidden rounded-full border-2 border-[rgba(124,58,237,0.4)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.referenceImages[0]?.url} alt={c.name} className="h-full w-full object-cover" />
            </div>
            <span className="text-[11px] text-[var(--color-text-sub)]">{c.name}</span>
          </Link>
        ))}
        <Link href="/characters" className="flex flex-shrink-0 flex-col items-center gap-1.5">
          <div className="flex h-13 w-13 items-center justify-center rounded-full border-[1.5px] border-dashed border-[var(--color-border-light)] bg-[var(--color-surface-2)] text-xl">
            ➕
          </div>
          <span className="text-[11px] text-[var(--color-text-dim)]">添加</span>
        </Link>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-[15px] font-bold text-[var(--color-text)]">全部短篇</p>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        {projects.map((p) => (
          <Link
            key={p.id}
            href={`/project/${p.id}/storyboard`}
            className="pf-card relative p-3"
            onClick={() => setDeletingId(null)}
          >
            <button
              onClick={(e) => {
                // 阻止触发外层 Link 跳转
                e.preventDefault();
                e.stopPropagation();
                if (deletingId === p.id) {
                  deleteProject(p.id);
                  setDeletingId(null);
                } else {
                  setDeletingId(p.id);
                }
              }}
              aria-label={`删除作品${p.title}`}
              className="absolute right-2 top-2 z-10 rounded-lg border px-2 py-1 text-[10px] font-semibold"
              style={{
                borderColor: deletingId === p.id ? "var(--color-error)" : "var(--color-border)",
                background: deletingId === p.id ? "rgba(239,68,68,0.9)" : "rgba(0,0,0,0.45)",
                color: deletingId === p.id ? "#fff" : "var(--color-text-sub)",
              }}
            >
              {deletingId === p.id ? "确认删除?" : "删除"}
            </button>
            <div className="mb-2 flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-[var(--color-surface-2)]">
              {p.panels[0]?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.panels[0].imageUrl} alt={p.title} className="h-full w-full object-cover" />
              ) : (
                <span className="text-3xl">📄</span>
              )}
            </div>
            <p className="text-[13px] font-semibold text-[var(--color-text)]">{p.title || "未命名短篇"}</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] text-[var(--color-text-dim)]">{new Date(p.createdAt).toLocaleDateString()}</span>
              <span className="rounded-full bg-[var(--color-primary-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
                {p.status === "exported" ? "已导出" : "草稿"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="var(--color-text-dim)" strokeWidth="2" strokeLinecap="round">
      <path d="M1 1l6 6-6 6" />
    </svg>
  );
}
