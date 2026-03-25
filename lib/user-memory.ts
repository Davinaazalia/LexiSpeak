import { getSupabaseServerClient } from "@/lib/supabase-server";

type QaRow = {
  question: string;
  transcript: string;
};

export type UserMemoryRecord = {
  user_id: string;
  preferred_model: string | null;
  fine_tuned_model: string | null;
  profile_summary: string | null;
  weakness_tags: string[] | null;
  argument_style: string | null;
  session_count: number | null;
  avg_band: number | null;
  updated_at: string;
};

const TABLE = "user_coach_memory";

export type UserLearningPlan = {
  levelLabel: string;
  focusTags: string[];
  drills: string[];
  coachingMode: "stabilize" | "improve" | "push";
};

function detectStyle(transcripts: string[]): string {
  const text = transcripts.join(" ").toLowerCase();
  const hasClaim = text.includes("i think") || text.includes("in my opinion");
  const hasReason = text.includes("because") || text.includes("since");
  const hasExample = text.includes("for example") || text.includes("for instance");
  const hasRebuttal = text.includes("however") || text.includes("on the other hand") || text.includes("some people");

  if (hasClaim && hasReason && hasExample && hasRebuttal) return "balanced-argumentative";
  if (hasClaim && hasReason && hasExample) return "claim-reason-example";
  if (hasClaim && hasReason) return "opinion-causal";
  if (text.split(/\s+/).length < 100) return "short-fragmented";
  return "descriptive";
}

function inferWeaknessTags(rows: QaRow[]): string[] {
  const tags = new Set<string>();

  for (const row of rows) {
    const t = (row.transcript || "").toLowerCase();
    const words = t.split(/\s+/).filter(Boolean);

    if (words.length < 12) tags.add("short-answer");
    if (!(t.includes("i think") || t.includes("in my opinion"))) tags.add("missing-claim");
    if (!(t.includes("because") || t.includes("since"))) tags.add("missing-reason");
    if (!(t.includes("for example") || t.includes("for instance"))) tags.add("missing-example");
    if (!(t.includes("however") || t.includes("on the other hand") || t.includes("some people"))) {
      tags.add("missing-rebuttal");
    }
  }

  return Array.from(tags).slice(0, 6);
}

function buildSummary(style: string, tags: string[], avgBand: number): string {
  const focus = tags.length ? tags.join(", ") : "maintain evidence depth";
  return `User style: ${style}. Average band so far: ${avgBand.toFixed(1)}. Priority coaching focus: ${focus}.`;
}

export async function getUserMemory(userId: string): Promise<UserMemoryRecord | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  const { data } = await supabase.from(TABLE).select("*").eq("user_id", userId).maybeSingle();
  return (data as UserMemoryRecord | null) || null;
}

export async function upsertUserMemory(input: {
  userId: string;
  qaTranscripts: QaRow[];
  bandScore: number;
  preferredModel?: string;
  fineTunedModel?: string;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const existing = await getUserMemory(input.userId);
  const sessionCount = (existing?.session_count || 0) + 1;
  const avgBand = existing?.avg_band
    ? (existing.avg_band * (sessionCount - 1) + input.bandScore) / sessionCount
    : input.bandScore;

  const transcripts = input.qaTranscripts.map((x) => x.transcript || "");
  const style = detectStyle(transcripts);
  const weaknessTags = inferWeaknessTags(input.qaTranscripts);
  const summary = buildSummary(style, weaknessTags, avgBand);

  await supabase.from(TABLE).upsert(
    {
      user_id: input.userId,
      preferred_model: input.preferredModel || existing?.preferred_model || null,
      fine_tuned_model: input.fineTunedModel || existing?.fine_tuned_model || null,
      profile_summary: summary,
      weakness_tags: weaknessTags,
      argument_style: style,
      session_count: sessionCount,
      avg_band: Number(avgBand.toFixed(2)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

export async function updateUserModelPreference(input: {
  userId: string;
  preferredModel?: string;
  fineTunedModel?: string;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const existing = await getUserMemory(input.userId);

  await supabase.from(TABLE).upsert(
    {
      user_id: input.userId,
      preferred_model: input.preferredModel ?? existing?.preferred_model ?? null,
      fine_tuned_model: input.fineTunedModel ?? existing?.fine_tuned_model ?? null,
      profile_summary: existing?.profile_summary || "",
      weakness_tags: existing?.weakness_tags || [],
      argument_style: existing?.argument_style || "",
      session_count: existing?.session_count || 0,
      avg_band: existing?.avg_band || 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

export async function resolveUserInferenceModel(input: {
  userId?: string;
  fallbackModel?: string;
}): Promise<{ modelName?: string; source: "fine_tuned" | "preferred" | "fallback" | "none" }> {
  const fallback = input.fallbackModel?.trim();
  const userId = input.userId?.trim();

  if (!userId) {
    return fallback ? { modelName: fallback, source: "fallback" } : { source: "none" };
  }

  const memory = await getUserMemory(userId);
  const fineTuned = memory?.fine_tuned_model?.trim();
  const preferred = memory?.preferred_model?.trim();

  if (fineTuned) {
    return { modelName: fineTuned, source: "fine_tuned" };
  }
  if (preferred) {
    return { modelName: preferred, source: "preferred" };
  }
  if (fallback) {
    return { modelName: fallback, source: "fallback" };
  }
  return { source: "none" };
}

function computeLevel(avgBand: number): string {
  if (avgBand >= 7.5) return "Advanced (Band 7.5+)";
  if (avgBand >= 6.5) return "Upper-Intermediate (Band 6.5-7.0)";
  if (avgBand >= 5.5) return "Intermediate (Band 5.5-6.0)";
  return "Foundation (Band <=5.0)";
}

function deriveDrills(tags: string[]): string[] {
  const drills: string[] = [];
  if (tags.includes("missing-claim")) {
    drills.push("Open each answer with one explicit claim in the first sentence.");
  }
  if (tags.includes("missing-reason")) {
    drills.push("Use one because-clause in every answer to justify your stance.");
  }
  if (tags.includes("missing-example")) {
    drills.push("Add one concrete example with a real context in each response.");
  }
  if (tags.includes("missing-rebuttal")) {
    drills.push("Practice one counterargument plus rebuttal using 'however'.");
  }
  if (tags.includes("short-answer")) {
    drills.push("Target 4-6 sentences per answer to improve depth and coherence.");
  }
  if (!drills.length) {
    drills.push("Maintain argument balance with claim, reason, example, and rebuttal in each turn.");
  }
  return drills.slice(0, 3);
}

export function buildUserLearningPlan(memory: UserMemoryRecord | null): UserLearningPlan {
  const avgBand = Number(memory?.avg_band || 0);
  const focusTags = (memory?.weakness_tags || []).filter(Boolean).slice(0, 4);
  const coachingMode: UserLearningPlan["coachingMode"] =
    avgBand >= 7 ? "push" : avgBand >= 5.5 ? "improve" : "stabilize";

  return {
    levelLabel: computeLevel(avgBand),
    focusTags,
    drills: deriveDrills(focusTags),
    coachingMode,
  };
}

export async function getUserLearningContext(userId: string): Promise<{
  memory: UserMemoryRecord | null;
  plan: UserLearningPlan;
}> {
  const memory = await getUserMemory(userId);
  return {
    memory,
    plan: buildUserLearningPlan(memory),
  };
}
