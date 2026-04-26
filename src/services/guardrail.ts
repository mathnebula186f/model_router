import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PromptMessage } from "../providers/types.js";

interface BannedWordsFile {
  words: string[];
}

const bannedWordsPath = resolve(process.cwd(), "banned-words.json");
const { words } = JSON.parse(
  readFileSync(bannedWordsPath, "utf-8"),
) as BannedWordsFile;

// Pre-lowercase once at load time; matching is case-insensitive whole-word.
const bannedLower = words.map((w) => w.toLowerCase());

export type GuardrailResult =
  | { ok: true }
  | { ok: false; reason: string; matched: string; role: PromptMessage["role"]; index: number };

export function checkPrompts(prompts: PromptMessage[]): GuardrailResult {
  for (let i = 0; i < prompts.length; i++) {
    const msg = prompts[i]!;
    const haystack = msg.content.toLowerCase();
    for (const banned of bannedLower) {
      const re = new RegExp(`\\b${escapeRegex(banned)}\\b`);
      if (re.test(haystack)) {
        return {
          ok: false,
          reason: `Prompt contains banned word: "${banned}"`,
          matched: banned,
          role: msg.role,
          index: i,
        };
      }
    }
  }
  return { ok: true };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
