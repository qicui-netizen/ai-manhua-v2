"use client";
// 本地存储层:角色 + 项目 + 生成额度,落 localStorage。
// 当前阶段(先做可预览体验版本)不接真实数据库,后续要切换时只需替换本文件的实现。
import type { Project, Character } from "./types";
import { CHARACTERS } from "./data";

const PKEY = "pf_projects_v2";
const QKEY = "pf_quota_v2";
const CKEY = "pf_characters_v2";

export function loadCharacters(): Character[] {
  if (typeof window === "undefined") return CHARACTERS;
  let custom: Character[] = [];
  try {
    custom = JSON.parse(localStorage.getItem(CKEY) || "[]");
  } catch {
    custom = [];
  }
  // 种子角色被用户编辑过(如调整特征锁定)时以同 id 存入 custom:取 custom 版本但保持种子原位次,
  // 避免"编辑一下锁定,卡片就跳到列表顶部"的交互跳动
  const byId = new Map(custom.map((c) => [c.id, c]));
  const seedIds = new Set(CHARACTERS.map((c) => c.id));
  return [...custom.filter((c) => !seedIds.has(c.id)), ...CHARACTERS.map((s) => byId.get(s.id) ?? s)];
}

export function getCharacter(id: string): Character | undefined {
  return loadCharacters().find((c) => c.id === id);
}

export function saveCharacter(c: Character) {
  let custom: Character[] = [];
  try {
    custom = JSON.parse(localStorage.getItem(CKEY) || "[]");
  } catch {
    custom = [];
  }
  // 已存在的角色原位替换(编辑锁定等操作不应把卡片挪到列表顶部),新角色才头插
  const idx = custom.findIndex((x) => x.id === c.id);
  if (idx >= 0) custom[idx] = c;
  else custom.unshift(c);
  localStorage.setItem(CKEY, JSON.stringify(custom));
  window.dispatchEvent(new Event("pf:update"));
}

export function deleteCharacter(id: string) {
  let custom: Character[] = [];
  try {
    custom = JSON.parse(localStorage.getItem(CKEY) || "[]");
  } catch {
    custom = [];
  }
  localStorage.setItem(CKEY, JSON.stringify(custom.filter((x) => x.id !== id)));
  window.dispatchEvent(new Event("pf:update"));
}

export const FREE_MONTHLY_QUOTA = 30;

export function loadProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PKEY) || "[]");
  } catch {
    return [];
  }
}

export function getProject(id: string): Project | undefined {
  return loadProjects().find((p) => p.id === id);
}

export function saveProject(p: Project) {
  const all = loadProjects().filter((x) => x.id !== p.id);
  all.unshift(p);
  try {
    localStorage.setItem(PKEY, JSON.stringify(all));
  } catch (err) {
    // localStorage 约5MB上限:图片都是base64,多作品时容易写满。
    // 降级策略:从最旧的项目开始剔除图片(保住当前作品和所有项目的文字数据)逐步重试。
    let saved = false;
    for (let i = all.length - 1; i > 0 && !saved; i--) {
      all[i] = { ...all[i], panels: all[i].panels.map((pn) => ({ ...pn, imageUrl: undefined })) };
      try {
        localStorage.setItem(PKEY, JSON.stringify(all));
        saved = true;
      } catch {
        /* 继续剔除更多旧项目的图片 */
      }
    }
    if (!saved) throw err; // 只剩当前项目仍写不下,交给调用方提示
  }
  window.dispatchEvent(new Event("pf:update"));
}

export function deleteProject(id: string) {
  localStorage.setItem(PKEY, JSON.stringify(loadProjects().filter((p) => p.id !== id)));
  window.dispatchEvent(new Event("pf:update"));
}

export function newId(prefix = "p"): string {
  const rand = typeof window !== "undefined" && window.crypto?.randomUUID
    ? window.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

// ── 额度(按自然月重置,跨月自动清零) ──
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}
function readQuotaUsed(): number {
  try {
    const rec = JSON.parse(localStorage.getItem(QKEY) || "{}");
    return rec.month === currentMonth() ? Number(rec.used) || 0 : 0;
  } catch {
    return 0;
  }
}
export function getQuota(): number {
  if (typeof window === "undefined") return FREE_MONTHLY_QUOTA;
  return Math.max(0, FREE_MONTHLY_QUOTA - readQuotaUsed());
}
export function spendQuota(n: number) {
  if (n <= 0) return;
  localStorage.setItem(QKEY, JSON.stringify({ month: currentMonth(), used: readQuotaUsed() + n }));
  window.dispatchEvent(new Event("pf:update"));
}

// ── 用户资料(本地,无账号体系) ──
const UKEY = "pf_user_v1";
export type UserProfile = { name: string; avatar: string }; // avatar 为 data URL,空串则用默认图标
export function getUserProfile(): UserProfile {
  if (typeof window === "undefined") return { name: "漫画创作者", avatar: "" };
  try {
    const raw = JSON.parse(localStorage.getItem(UKEY) || "{}");
    return { name: raw.name || "漫画创作者", avatar: raw.avatar || "" };
  } catch {
    return { name: "漫画创作者", avatar: "" };
  }
}
export function saveUserProfile(p: UserProfile) {
  localStorage.setItem(UKEY, JSON.stringify(p));
  window.dispatchEvent(new Event("pf:update"));
}

// ── 套餐(演示付费墙,未接入真实支付) ──
const PLANKEY = "pf_plan_v2";
export type Plan = "free" | "member";
export function getPlanClient(): Plan {
  if (typeof window === "undefined") return "free";
  return (localStorage.getItem(PLANKEY) as Plan) || "free";
}
export function setPlanClient(p: Plan) {
  localStorage.setItem(PLANKEY, p);
  window.dispatchEvent(new Event("pf:update"));
}
