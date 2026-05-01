import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";
import type { PromptMessage } from "../providers/types.js";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export type GuardrailResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      matched: string;
      role: PromptMessage["role"];
      index: number;
    };

export function checkPrompts(prompts: PromptMessage[]): GuardrailResult {
  for (let i = 0; i < prompts.length; i++) {
    const msg = prompts[i]!;
    const matches = matcher.getAllMatches(msg.content);
    if (matches.length === 0) continue;

    const first = matches[0]!;
    const { phraseMetadata } =
      englishDataset.getPayloadWithPhraseMetadata(first);
    const matched =
      phraseMetadata?.originalWord ??
      msg.content.slice(first.startIndex, first.endIndex + 1);

    return {
      ok: false,
      reason: `Prompt contains banned word: "${matched}"`,
      matched,
      role: msg.role,
      index: i,
    };
  }
  return { ok: true };
}
