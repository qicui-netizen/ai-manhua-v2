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
  return [...custom, ...CHARACTERS];
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
  custom = [c, ...custom.filter((x) => x.id !== c.id)];
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
  localStorage.setItem(PKEY, JSON.stringify(all));
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

// ── 额度 ──
export function getQuota(): number {
  if (typeof window === "undefined") return FREE_MONTHLY_QUOTA;
  const used = Number(localStorage.getItem(QKEY) || "0");
  return Math.max(0, FREE_MONTHLY_QUOTA - used);
}
export function spendQuota(n: number) {
  if (n <= 0) return;
  const used = Number(localStorage.getItem(QKEY) || "0") + n;
  localStorage.setItem(QKEY, String(used));
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
