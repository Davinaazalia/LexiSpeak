import { NextRequest, NextResponse } from "next/server";
import { generateCoachChallengeWithAi } from "@/lib/ai-provider";
import { getUserLearningContext, resolveUserInferenceModel, updateUserModelPreference } from "@/lib/user-memory";
import { enforceRateLimit, isAllowedOrigin } from "@/lib/security";

export const runtime = "nodejs";

type ToulminFlags = {
  claim: boolean;
  grounds: boolean;
  warrant: boolean;
  backing: boolean;
  reason: boolean;
  example: boolean;
  rebuttal: boolean;
  qualifier: boolean;
};

type ToulminComponent = keyof ToulminFlags;

type FactItem = {
  source: string;
  insight: string;
  keywords: string[];
};

const TOULMIN_ORDER: ToulminComponent[] = ["claim", "reason", "example", "rebuttal", "qualifier"];

const FACT_BANK: FactItem[] = [
  {
    source: "Reuters Digital News Report",
    insight:
      "audiences increasingly discover news through social and video platforms, which can boost speed but also increase exposure to unverified claims",
    keywords: ["news", "media", "social", "platform", "opinion", "bias", "information"],
  },
  {
    source: "OECD Learning Compass",
    insight:
      "learners who justify claims with evidence and consider alternatives usually perform better in argumentative speaking tasks",
    keywords: ["education", "student", "learn", "school", "argument", "speaking", "critical"],
  },
  {
    source: "UNESCO Global Education Monitoring",
    insight:
      "access gaps and context differences often change how strongly one policy or idea works across regions",
    keywords: ["policy", "society", "country", "public", "region", "impact", "access"],
  },
];

function missingToulminComponents(flags: ToulminFlags): ToulminComponent[] {
  return TOULMIN_ORDER.filter((component) => !flags[component]);
}

function deriveToulminTargets(flags: ToulminFlags): string[] {
  const targets: string[] = [];

  if (!flags.claim) {
    targets.push("state your position more clearly");
  }
  if (!flags.grounds || !flags.reason) {
    targets.push("give a concrete supporting reason");
  }
  if (!flags.warrant) {
    targets.push("explain why your reason actually proves your point");
  }
  if (!flags.backing || !flags.example) {
    targets.push("add evidence or a real example");
  }
  if (!flags.rebuttal) {
    targets.push("address one strong opposite view");
  }
  if (!flags.qualifier) {
    targets.push("avoid sounding absolute and show realistic limits");
  }

  return targets.slice(0, 4);
}

function labelComponent(component: ToulminComponent): string {
  if (component === "claim") return "your exact position";
  if (component === "reason") return "why your position should be accepted";
  if (component === "example") return "a concrete example";
  if (component === "rebuttal") return "how you would answer the opposite view";
  return "how certain this is in real life";
}

function buildProbeQuestions(components: ToulminComponent[]): string {
  const probes: string[] = [];

  if (components.includes("claim")) {
    probes.push("What is your exact position in one direct sentence?");
  }
  if (components.includes("reason")) {
    probes.push("Why should a listener accept that position?");
  }
  if (components.includes("example")) {
    probes.push("What real example can you give to prove this point?");
  }
  if (components.includes("rebuttal")) {
    probes.push("How would you respond if someone disagreed with you?");
  }
  if (components.includes("qualifier")) {
    probes.push("Is this always true, or only true in many cases?");
  }

  if (!probes.length) {
    return "What stronger evidence would make your argument harder to reject?";
  }

  return probes[0];
}

function compactAnswerSnippet(answer: string): string {
  const snippet = (answer || "").trim().replace(/\s+/g, " ");
  if (!snippet) return "your current response";
  if (snippet.length <= 120) return snippet;
  return `${snippet.slice(0, 117)}...`;
}

function resolveFactItem(question: string, answer: string, recentContext: string[]): FactItem {
  const text = `${question} ${answer} ${recentContext.join(" ")}`.toLowerCase();
  let best = FACT_BANK[0];
  let bestScore = -1;

  for (const item of FACT_BANK) {
    const score = item.keywords.reduce((sum, keyword) => (text.includes(keyword) ? sum + 1 : sum), 0);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return best;
}

function formatFactAnchor(item: FactItem): string {
  return `According to ${item.source}, ${item.insight}.`;
}

function formatComponentList(components: ToulminComponent[]): string {
  const labels = components.map(labelComponent);
  if (labels.length <= 1) {
    return labels[0] || "a stronger argument structure";
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function localValidateChallenge(answer: string, unmet: ToulminComponent[], factAnchor: string): string {
  const snippet = compactAnswerSnippet(answer);
  const missingText = formatComponentList(unmet);
  const probe = buildAdaptiveProbe(unmet, answer, []);
  return `I understand your point in "${snippet}", but the argument still needs ${missingText}. ${factAnchor} ${probe}`;
}

function chooseVariant(seed: string, options: string[]): string {
  const index = Math.abs(seed.length) % options.length;
  return options[index];
}

function localValidationPassFeedback(answer: string, factAnchor: string): string {
  const snippet = compactAnswerSnippet(answer);
  return `${factAnchor} Your refinement in "${snippet}" is clearer, but the argument is still contestable under scrutiny. In an IELTS debate response, what is the strongest limitation of your own claim, and how would you defend against it?`;
}

function withVerdict(text: string, tone: "strong" | "partial" | "off_topic"): string {
  const cleaned = (text || "").trim();
  if (!cleaned) return cleaned;

  // Keep coach tone natural and avoid repetitive prefix stacking.
  return cleaned;
}

function buildAdaptiveProbe(components: ToulminComponent[], answer: string, recentContext: string[]): string {
  if (!components.length) {
    return "What stronger evidence would make your argument harder to reject?";
  }

  const seed = `${answer}|${recentContext.slice(-3).join("|")}`;
  const pivot = Math.abs(seed.length) % components.length;
  const target = components[pivot];

  if (target === "claim") return "Can you state your exact position in one precise sentence?";
  if (target === "reason") return "Why should a listener accept your reason, not just your opinion?";
  if (target === "example") return "According to your argument, what specific real case best proves your point?";
  if (target === "rebuttal") return "If someone disagrees strongly, what is your best rebuttal in one line?";
  return "How certain is your claim in real life, and when might it fail?";
}

function hasMastery(flags: ToulminFlags): boolean {
  return flags.claim && (flags.reason || flags.grounds) && flags.example && flags.rebuttal;
}

function toConciseTutorVoice(text: string): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return cleaned;

  let normalized = cleaned
    .replace(/^for this question,\s*/i, "")
    .replace(/^to improve your answer,\s*let'?s start with\s*/i, "")
    .replace(/^to improve your answer,\s*/i, "")
    .replace(/^let'?s start with\s*/i, "")
    .replace(/^try to improve\s*/i, "");

  const sentences = normalized.match(/[^.!?]+[.!?]?/g) || [normalized];
  const trimmed = sentences.map((s) => s.trim()).filter(Boolean);
  const statements = trimmed.filter((s) => !/[?]$/.test(s)).slice(0, 3);
  const question = trimmed.find((s) => /[?]$/.test(s));

  const shaped = [...statements, ...(question ? [question] : [])].slice(0, 4);
  return shaped.join(" ");
}

function extractKeywords(input: string): string[] {
  const tokens = (input || "").toLowerCase().match(/[a-z']+/g) || [];
  const stop = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "to",
    "for",
    "of",
    "and",
    "in",
    "on",
    "with",
    "about",
    "how",
    "why",
    "what",
    "should",
    "do",
    "does",
    "can",
    "could",
    "would",
    "be",
    "by",
  ]);
  const unique: string[] = [];
  for (const t of tokens) {
    if (t.length < 3 || stop.has(t)) continue;
    if (!unique.includes(t)) unique.push(t);
  }
  return unique.slice(0, 8);
}

function detectToulmin(answer: string): ToulminFlags {
  const text = (answer || "").toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const hasCaseAnchor =
    text.includes("during") ||
    text.includes("when") ||
    text.includes("for example") ||
    text.includes("for instance") ||
    text.includes("as seen") ||
    text.includes("as shown") ||
    text.includes("in the case of") ||
    text.includes("covid") ||
    text.includes("pandemic");
  const hasReasonConnector =
    text.includes("because") ||
    text.includes("since") ||
    text.includes("due to") ||
    text.includes("there is") ||
    text.includes("this is why") ||
    text.includes("therefore") ||
    text.includes("as a result") ||
    text.includes("this means") ||
    text.includes("this can") ||
    text.includes("this could") ||
    text.includes("so that");
  const hasEvidenceCue =
    text.includes("for example") ||
    text.includes("for instance") ||
    text.includes("such as") ||
    text.includes("example") ||
    text.includes("for me") ||
    text.includes("in my country") ||
    text.includes("in my experience") ||
    /\b\d{4}\b/.test(text) ||
    /\b(covid|pandemic|tiktok|twitter|instagram|facebook|youtube|blm)\b/.test(text) ||
    text.includes("case of") ||
    text.includes("real case") ||
    hasCaseAnchor;
  const hasWarrantCue =
    text.includes("therefore") ||
    text.includes("that means") ||
    text.includes("which is why") ||
    text.includes("so it") ||
    text.includes("this shows");
  const hasBackingCue =
    text.includes("study") ||
    text.includes("research") ||
    text.includes("data") ||
    text.includes("report") ||
    text.includes("according to");

  // Improved claim detection: look for opinion markers, not just "I think"
  const claimMarkers =
    text.includes("i think") ||
    text.includes("in my opinion") ||
    text.includes("i believe") ||
    text.includes("i argue") ||
    text.includes("my view") ||
    text.includes("in reality") ||
    text.includes("actually") ||
    text.includes("the fact is") ||
    text.includes("is important") ||
    text.includes("is necessary") ||
    text.includes("is crucial") ||
    (text.split(/[.!?]+/).length > 0 && text.length > 30); // Long answer likely has position

  return {
    claim: claimMarkers,
    grounds: hasReasonConnector || hasEvidenceCue,
    warrant: hasWarrantCue,
    backing: hasBackingCue,
    reason: hasReasonConnector,
    example: hasEvidenceCue,
    rebuttal:
      text.includes("however") ||
      text.includes("on the other hand") ||
      text.includes("some people") ||
      text.includes("some may argue") ||
      text.includes("others may argue") ||
      text.includes("critics may say") ||
      text.includes("counterargument") ||
      (text.includes("but") && wordCount > 20),
    qualifier:
      text.includes("usually") ||
      text.includes("sometimes") ||
      text.includes("in general") ||
      text.includes("often") ||
      text.includes("most") ||
      text.includes("many") ||
      text.includes("may") ||
      text.includes("might") ||
      text.includes("not always") ||
      text.includes("not complete") ||
      text.includes("not completely") ||
      text.includes("in many cases") ||
      text.includes("can fail") ||
      (wordCount > 25 && (text.includes("likely") || text.includes("unlikely"))),
  };
}

function isUnclearAnswer(answer: string): boolean {
  const a = (answer || "").trim().toLowerCase();
  if (!a) return true;
  if (a.split(/\s+/).length < 5) return true;

  const markers = ["i don't know", "dont know", "not sure", "i guess"];
  if (markers.some((m) => a.includes(m)) && a.split(/\s+/).length < 18) return true;
  if (/(.)\1{4,}/.test(a)) return true;

  return false;
}

function isStrongAnswer(toulmin: ToulminFlags): boolean {
  // Answer is strong if it has: claim + reason/grounds + example
  return toulmin.claim && (toulmin.reason || toulmin.grounds) && toulmin.example;
}

function isRelevantResponse(question: string, answer: string, toulmin?: ToulminFlags): boolean {
  if (isUnclearAnswer(answer)) return false;

  const lower = (answer || "").toLowerCase();
  const escapeMarkers = ["i have to go", "toilet", "bathroom", "skip", "pass", "later"];
  if (escapeMarkers.some((m) => lower.includes(m))) return false;

  // If answer is well-structured (claim + reason + example), assume it's relevant
  // A strong answer is likely addressing the question properly
  if (toulmin && isStrongAnswer(toulmin)) {
    return true;
  }

  // Otherwise, check keyword overlap
  const qWords = new Set(extractKeywords(question));
  const aWords = new Set(extractKeywords(answer));
  if (!qWords.size) return true;

  let overlap = 0;
  qWords.forEach((w) => {
    if (aWords.has(w)) overlap += 1;
  });
  
  // More lenient: if answer is long enough (substantial) and has some overlap, it's relevant
  // Or if answer is just long (20+ words) and not explicitly off-topic
  const isSubstantial = answer.split(/\s+/).length > 20;
  return overlap >= 1 || isSubstantial;
}

function localStrongAnswerChallenge(answer: string, factAnchor: string): string {
  // Extract a key phrase from the answer to cite it
  const sentences = (answer || "").split(/[.!?]+/).filter((s) => s.trim().length > 15);
  const mainIdea = sentences.length > 0 ? sentences[0].trim() : answer.slice(0, 50).trim();
  const cited = mainIdea.length > 80 ? `${mainIdea.slice(0, 77)}...` : mainIdea;

  return `${factAnchor} Your point about "${cited}" is well-taken, but it may not hold equally in every context. If that source pattern changes across groups, what would be the strongest counterargument to your claim?`;
}

function localCoachChallenge(question: string, answer: string, toulmin: ToulminFlags, factAnchor: string): string {
  // Extract a meaningful excerpt to cite
  const sentences = (answer || "").split(/[.!?]+/).filter((s) => s.trim().length > 15);
  const firstSentence = sentences.length > 0 ? sentences[0].trim() : answer.slice(0, 60).trim();
  const excerpt = firstSentence.length > 90 ? `${firstSentence.slice(0, 87)}...` : firstSentence;

  const weakness = !toulmin.claim
    ? "your main opinion is not explicit"
    : !toulmin.reason
      ? "your reason is still too thin"
      : !toulmin.example
        ? "you did not include a concrete example"
        : !toulmin.rebuttal
          ? "you did not address the opposite side"
          : !toulmin.qualifier
            ? "your answer sounds too absolute"
            : "your argument needs deeper evidence";

  return `${factAnchor} Your point that "${excerpt}" is understood, but ${weakness}. If the source trend is true, how exactly does your argument still stand?`;
}

function localTargetedChallenge(question: string, answer: string, missing: ToulminComponent[], factAnchor: string): string {
  const probes = buildProbeQuestions(missing);
  const snippet = compactAnswerSnippet(answer);
  return `${factAnchor} You already present a position in "${snippet}", but your reasoning is still easy to challenge. ${probes}`;
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ message: "Origin tidak diizinkan" }, { status: 403 });
  }

  const rateLimit = enforceRateLimit(request, "followup", { max: 50, windowMs: 60_000 });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { message: "Terlalu banyak request, coba lagi sebentar." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    const mode = String(body?.mode || "challenge");
    const question = String(body?.question || "").trim();
    const answer = String(body?.answer || "").trim();
    const recentContext = Array.isArray(body?.recentContext) ? body.recentContext.map(String) : [];
    const expectedComponents = Array.isArray(body?.expectedComponents)
      ? body.expectedComponents.map(String).filter(Boolean)
      : [];
    const modelName = String(body?.modelName || "").trim();
    const userId = String(body?.userId || "").trim();

    if (!question || !answer) {
      return NextResponse.json({ message: "question dan answer wajib diisi" }, { status: 400 });
    }

    const toulmin = detectToulmin(answer);
    const relevant = isRelevantResponse(question, answer, toulmin);
    const factItem = resolveFactItem(question, answer, recentContext);
    const factAnchor = formatFactAnchor(factItem);

    if (mode === "validate") {
      const followupFlags = toulmin;
      const answerWordCount = answer.split(/\s+/).filter(Boolean).length;
      const normalizedExpected = expectedComponents.filter((component: string) =>
        TOULMIN_ORDER.includes(component as ToulminComponent)
      ) as ToulminComponent[];
      const unmet = normalizedExpected.filter((component: ToulminComponent) => !followupFlags[component]);
      const mastered = hasMastery(followupFlags);
      const isSubstantialAndCoherent =
        answerWordCount >= 35 &&
        followupFlags.claim &&
        (followupFlags.reason || followupFlags.grounds) &&
        followupFlags.example;

      if (!relevant) {
        return NextResponse.json({
          ok: true,
          isRelevant: false,
          challenge: withVerdict(
            `${factAnchor} Your reply is still hard to evaluate against the question. In one clear sentence, state your view first, then add one reason and one example linked to that view.`,
            "off_topic"
          ),
          unmetComponents: normalizedExpected,
        });
      }

      if (normalizedExpected.length > 0 && unmet.length && !isSubstantialAndCoherent) {
        const adaptiveProbe = buildAdaptiveProbe(unmet, answer, recentContext);
        return NextResponse.json({
          ok: true,
          isRelevant: false,
          challenge: withVerdict(
            `${factAnchor} I understand your point, but your argument still needs ${formatComponentList(unmet)}. ${adaptiveProbe}`,
            "partial"
          ),
          unmetComponents: unmet,
        });
      }

      return NextResponse.json({
        ok: true,
        isRelevant: true,
        unmetComponents: [],
        isMastered: mastered || isSubstantialAndCoherent,
        feedback: withVerdict(localValidationPassFeedback(answer, factAnchor), "strong"),
      });
    }

    const missing = missingToulminComponents(toulmin);
    const toulminTargets = deriveToulminTargets(toulmin);
    const learningContext = userId ? await getUserLearningContext(userId) : null;

    const resolved = await resolveUserInferenceModel({
      userId: userId || undefined,
      fallbackModel: modelName || undefined,
    });

    if (userId && modelName) {
      await updateUserModelPreference({
        userId,
        preferredModel: modelName,
      });
    }

    if (!relevant) {
      return NextResponse.json({
        ok: true,
        isRelevant: false,
        required: true,
        source: "local",
        toulmin,
        requiredComponents: ["claim", "reason", "example"],
        challenge: withVerdict(
          `${factAnchor} Your response does not fully address the question. Please make sure your answer relates directly to what is being asked.`,
          "off_topic"
        ),
      });
    }

    const strong = isStrongAnswer(toulmin);
    if (strong) {
      // Answer is already well-developed; use HANDLING STRONG ANSWERS strategy
      let challenge = await generateCoachChallengeWithAi({
        question,
        answer,
        toulmin,
        recentContext,
        modelName: resolved.modelName,
        learnerProfile: learningContext?.memory?.profile_summary || undefined,
        learningFocusTags: learningContext?.plan.focusTags || [],
        coachingMode: learningContext?.plan.coachingMode || "improve",
        coachingTargets: ["STRONG_ANSWER", "deeper_thinking", "advanced_challenge"],
        factualAnchor: factAnchor,
        factualSource: factItem.source,
      });
      const usedLlm = Boolean(challenge);

      if (!challenge) {
        challenge = localStrongAnswerChallenge(answer, factAnchor);
      }

      challenge = toConciseTutorVoice(challenge);
      challenge = withVerdict(challenge, "strong");

      return NextResponse.json({
        ok: true,
        isRelevant: true,
        required: false,
        source: usedLlm ? "llm" : "local",
        toulmin,
        requiredComponents: [],
        challenge,
      });
    }

    if (missing.length) {
      let targeted = await generateCoachChallengeWithAi({
        question,
        answer,
        toulmin,
        recentContext,
        modelName: resolved.modelName,
        learnerProfile: learningContext?.memory?.profile_summary || undefined,
        learningFocusTags: learningContext?.plan.focusTags || [],
        coachingMode: learningContext?.plan.coachingMode || "improve",
        coachingTargets: [...toulminTargets, ...missing.map(labelComponent)].slice(0, 4),
        factualAnchor: factAnchor,
        factualSource: factItem.source,
      });
      const usedLlm = Boolean(targeted);

      if (!targeted) {
        targeted = localTargetedChallenge(question, answer, missing, factAnchor);
      }

      targeted = toConciseTutorVoice(targeted);
      targeted = withVerdict(targeted, "partial");

      return NextResponse.json({
        ok: true,
        isRelevant: true,
        required: true,
        source: usedLlm ? "llm" : "local",
        toulmin,
        requiredComponents: missing,
        challenge: targeted,
      });
    }

    let challenge = await generateCoachChallengeWithAi({
      question,
      answer,
      toulmin,
      recentContext,
      modelName: resolved.modelName,
      learnerProfile: learningContext?.memory?.profile_summary || undefined,
      learningFocusTags: learningContext?.plan.focusTags || [],
      coachingMode: learningContext?.plan.coachingMode || "improve",
      coachingTargets: toulminTargets,
      factualAnchor: factAnchor,
      factualSource: factItem.source,
    });

    const source = challenge ? "llm" : "local";
    if (!challenge) {
      challenge = localCoachChallenge(question, answer, toulmin, factAnchor);
    }

    challenge = toConciseTutorVoice(challenge);
    challenge = withVerdict(challenge, "partial");

    return NextResponse.json({
      ok: true,
      isRelevant: true,
      required: true,
      source,
      activeModel: resolved.modelName || null,
      modelSource: resolved.source,
      requiredComponents: ["rebuttal", "qualifier"],
      personalization: learningContext
        ? {
            levelLabel: learningContext.plan.levelLabel,
            focusTags: learningContext.plan.focusTags,
            coachingMode: learningContext.plan.coachingMode,
          }
        : null,
      toulmin,
      challenge,
    });
  } catch {
    return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
  }
}
