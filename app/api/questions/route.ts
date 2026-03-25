import { NextRequest, NextResponse } from "next/server";
import {
  DomainKey,
  QUESTION_BANK,
  generateFromCustomTopic,
  generateLocalFromDomain,
} from "@/lib/question-bank";
import { generateQuestionsWithAi } from "@/lib/ai-provider";
import { getUserLearningContext, resolveUserInferenceModel, updateUserModelPreference } from "@/lib/user-memory";
import { enforceRateLimit, isAllowedOrigin } from "@/lib/security";

type QuestionMode = "ai_reference" | "local_domain" | "custom_topic";

function questionStem(text: string): string {
  const clean = text.trim().replace(/[?.!]+$/g, "");
  if (!clean) return "this issue";
  return clean;
}

function applyToulminFlow(questions: string[], topicFallback: string): string[] {
  const cycle = ["claim", "reason", "example", "counter", "rebuttal"] as const;

  return questions.map((raw, index) => {
    const stem = questionStem(raw);
    const quoted = `"${stem}"`;
    const stage = cycle[index % cycle.length];

    if (stage === "claim") {
      return `For IELTS speaking, what is your overall opinion about this question: ${quoted}?`;
    }
    if (stage === "reason") {
      return `For IELTS speaking, what is your strongest reason for that opinion in ${topicFallback}?`;
    }
    if (stage === "example") {
      return `For IELTS speaking, can you share one real-life example that supports your view on ${quoted}?`;
    }
    if (stage === "counter") {
      return `For IELTS speaking, what is the strongest opposite view to your position on ${quoted}?`;
    }
    return `For IELTS speaking, how would you respond to that opposite view while keeping your position clear?`;
  });
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ message: "Origin tidak diizinkan" }, { status: 403 });
  }

  const rateLimit = enforceRateLimit(request, "questions", { max: 40, windowMs: 60_000 });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { message: "Terlalu banyak request, coba lagi sebentar." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    const mode = (body?.mode as QuestionMode) || "local_domain";
    const domain = (body?.domain as DomainKey) || "news_and_media";
    const count = Math.min(10, Math.max(1, Number(body?.count || 10)));
    const customTopic = String(body?.customTopic || "");
    const anchorTopic = String(body?.anchorTopic || domain.replaceAll("_", " "));
    const chatModel = String(body?.chatModel || "").trim();
    const userId = String(body?.userId || "").trim();

    let questions: string[];
    let activeModel: string | undefined;
    let modelSource: "fine_tuned" | "preferred" | "fallback" | "none" = "none";
    let personalization: {
      focusTags: string[];
      coachingMode: "stabilize" | "improve" | "push";
      levelLabel: string;
    } | null = null;

    if (mode === "custom_topic") {
      if (!customTopic.trim()) {
        return NextResponse.json({ message: "customTopic wajib diisi" }, { status: 400 });
      }
      questions = generateFromCustomTopic(customTopic, count);
    } else if (mode === "ai_reference") {
      try {
        const learningContext = userId ? await getUserLearningContext(userId) : null;
        if (learningContext) {
          personalization = {
            focusTags: learningContext.plan.focusTags,
            coachingMode: learningContext.plan.coachingMode,
            levelLabel: learningContext.plan.levelLabel,
          };
        }

        const resolved = await resolveUserInferenceModel({
          userId: userId || undefined,
          fallbackModel: chatModel || undefined,
        });
        activeModel = resolved.modelName;
        modelSource = resolved.source;

        questions = await generateQuestionsWithAi({
          anchorTopic,
          domainLabel: domain.replaceAll("_", " "),
          referenceQuestions: QUESTION_BANK[domain],
          count,
          modelName: activeModel,
          learnerProfile: learningContext?.memory?.profile_summary || undefined,
          learningFocusTags: learningContext?.plan.focusTags || [],
          coachingMode: learningContext?.plan.coachingMode || "improve",
        });

        if (userId && chatModel) {
          await updateUserModelPreference({
            userId,
            preferredModel: chatModel,
          });
        }
      } catch {
        const base = generateLocalFromDomain(domain, count);
        const normalizedAnchor = anchorTopic.trim();
        questions = base.map((q) => {
          if (!normalizedAnchor) return q;
          if (q.toLowerCase().includes(normalizedAnchor.toLowerCase())) return q;
          return `${q.replace(/\?$/, "")} in relation to ${normalizedAnchor}?`;
        });
      }
    } else {
      questions = generateLocalFromDomain(domain, count);
    }

    const toulminTopic = (anchorTopic || customTopic || domain.replaceAll("_", " ")).trim();
    questions = applyToulminFlow(questions, toulminTopic);

    const fallback = QUESTION_BANK[domain].slice(0, count);
    return NextResponse.json({
      questions: questions.length ? questions : fallback,
      activeModel: activeModel || null,
      modelSource,
      personalization,
    });
  } catch {
    return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
  }
}
