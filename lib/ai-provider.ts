type AiProvider = "openai" | "groq";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function env(name: string): string {
  return (process.env[name] || "").trim();
}

export function resolveAiProvider(): AiProvider {
  const configured = env("AI_PROVIDER").toLowerCase();
  if (configured === "openai" || configured === "groq") {
    return configured;
  }
  if (env("GROQ_API_KEY")) {
    return "groq";
  }
  return "openai";
}

function resolveApiBase(provider: AiProvider): string {
  if (provider === "groq") {
    return env("GROQ_BASE_URL") || "https://api.groq.com/openai/v1";
  }
  return env("OPENAI_BASE_URL") || "https://api.openai.com/v1";
}

function resolveApiKey(provider: AiProvider): string {
  if (provider === "groq") {
    const key = env("GROQ_API_KEY");
    if (!key) {
      throw new Error("GROQ_API_KEY belum diisi.");
    }
    return key;
  }
  const key = env("OPENAI_API_KEY");
  if (!key) {
    throw new Error("OPENAI_API_KEY belum diisi.");
  }
  return key;
}

function resolveChatModel(provider: AiProvider): string {
  if (provider === "groq") {
    return env("GROQ_CHAT_MODEL") || "llama-3.3-70b-versatile";
  }
  return env("OPENAI_CHAT_MODEL") || "gpt-4o-mini";
}

function resolveTranscriptionModel(provider: AiProvider): string {
  if (provider === "groq") {
    return env("GROQ_TRANSCRIBE_MODEL") || "whisper-large-v3-turbo";
  }
  return env("OPENAI_TRANSCRIBE_MODEL") || "whisper-1";
}

export async function generateQuestionsWithAi(input: {
  anchorTopic: string;
  domainLabel: string;
  referenceQuestions: string[];
  count: number;
  modelName?: string;
  learnerProfile?: string;
  learningFocusTags?: string[];
  coachingMode?: "stabilize" | "improve" | "push";
}): Promise<string[]> {
  const provider = resolveAiProvider();
  const apiKey = resolveApiKey(provider);
  const baseUrl = resolveApiBase(provider);
  const model = input.modelName?.trim() || resolveChatModel(provider);

  const refText = input.referenceQuestions.slice(0, 10).map((q) => `- ${q}`).join("\n");
  const prompt = [
    "You generate IELTS speaking discussion questions.",
    `Domain: ${input.domainLabel}`,
    `Anchor topic: ${input.anchorTopic || input.domainLabel}`,
    `Learner profile: ${(input.learnerProfile || "no prior profile").trim()}`,
    `Learning focus tags: ${(input.learningFocusTags || []).join(", ") || "general argument quality"}`,
    `Coaching mode: ${input.coachingMode || "improve"}`,
    "Reference style (stay close to this domain and difficulty):",
    refText,
    "Rules:",
    `- Generate exactly ${input.count} unique English questions.`,
    "- Keep questions debatable and suitable for IELTS speaking practice.",
    "- Output numbered list only.",
  ].join("\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: "You produce high-quality IELTS speaking questions." },
        { role: "user", content: prompt },
      ] satisfies ChatMessage[],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI question generation gagal (${response.status}): ${errText}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const raw = payload.choices?.[0]?.message?.content || "";
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+[\).]\s*/, ""))
    .filter((line) => line.length > 8)
    .map((line) => (line.endsWith("?") ? line : `${line}?`));

  return Array.from(new Set(lines)).slice(0, input.count);
}

export async function transcribeAudioWithAi(input: {
  fileBuffer: ArrayBuffer;
  fileName: string;
  mimeType: string;
  language?: string;
  modelName?: string;
}): Promise<string> {
  const provider = resolveAiProvider();
  const apiKey = resolveApiKey(provider);
  const baseUrl = resolveApiBase(provider);
  const model = input.modelName?.trim() || resolveTranscriptionModel(provider);

  const formData = new FormData();
  const blob = new Blob([input.fileBuffer], { type: input.mimeType || "audio/webm" });
  formData.set("file", blob, input.fileName || "audio.webm");
  formData.set("model", model);
  formData.set("response_format", "json");
  if (input.language) {
    formData.set("language", input.language);
  }

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Transcription gagal (${response.status}): ${errText}`);
  }

  const payload = (await response.json()) as { text?: string };
  return (payload.text || "").trim();
}

export async function generateCoachChallengeWithAi(input: {
  question: string;
  answer: string;
  toulmin: {
    claim: boolean;
    reason: boolean;
    example: boolean;
    rebuttal: boolean;
    qualifier: boolean;
  };
  recentContext?: string[];
  modelName?: string;
  learnerProfile?: string;
  learningFocusTags?: string[];
  coachingMode?: "stabilize" | "improve" | "push";
  coachingTargets?: string[];
  factualAnchor?: string;
  factualSource?: string;
}): Promise<string | null> {
  const provider = resolveAiProvider();
  const apiKey = resolveApiKey(provider);
  const baseUrl = resolveApiBase(provider);
  const model = input.modelName?.trim() || resolveChatModel(provider);

  const contextBlock = (input.recentContext || []).slice(-4).join("\n");
  const prompt = [
    "You are an AI speaking coach that challenges the user's argument to improve critical thinking.",
    "Analyze the answer and respond as a debate partner, not as a teacher.",
    "Return exactly 3-4 sentences with at most ONE question.",
    "",
    "Question:",
    input.question,
    "",
    "Student answer:",
    input.answer,
    "",
    "Evidence anchor:",
    input.factualAnchor || "(none)",
    `Evidence source: ${input.factualSource || "general public reports"}`,
    "",
    "Learner profile:",
    (input.learnerProfile || "no prior profile").trim(),
    "",
    `Learning focus tags: ${(input.learningFocusTags || []).join(", ") || "general argument quality"}`,
    "",
    `Coaching mode: ${input.coachingMode || "improve"}`,
    "",
    `Priority improvement targets: ${(input.coachingTargets || []).join(", ") || "clarity, reasoning, example depth"}`,
    "",
    "Recent context:",
    contextBlock || "(none)",
    "",
    "Toulmin signals:",
    `claim=${input.toulmin.claim}, reason=${input.toulmin.reason}, example=${input.toulmin.example}, rebuttal=${input.toulmin.rebuttal}, qualifier=${input.toulmin.qualifier}`,
    "",
    input.coachingTargets?.includes("STRONG_ANSWER")
      ? "NOTE: This answer already has clear opinion + reasoning + example. Use HANDLING STRONG ANSWERS strategy: acknowledge quality, introduce limitation/rebuttal, ask advanced question."
      : "",
    "",
    "Style example:",
    "User: I think policy is important for media because it is good.",
    "Coach: Your idea sounds positive, but it is still unclear what kind of policy you mean. Why do you think it is good, and how does it improve media outcomes? Without a concrete example, it is hard to judge the impact. Could there also be situations where policy might limit media freedom instead?",
    "",
    "=== CORE RULES ===",
    "- Do not use words like claim, grounds, warrant, backing, qualifier, rebuttal, or Toulmin.",
    "- Do not provide a corrected or rewritten answer.",
    "- Do not use generic openers or checklist-like wording.",
    "- Use IELTS-style formal spoken register: precise, neutral, and academically natural.",
    "- Avoid slang, casual fillers, or chatty internet tone.",
    "- Keep every sentence specific to the user answer.",
    "- Focus on only one most important weakness in the answer.",
    "- Sound slightly critical but still supportive.",
    "- MUST cite, quote, or reference the student's actual answer (show you read and understood it).",
    "- Reference specific phrases or ideas from the answer to prove engagement.",
    "- Never give generic feedback that could apply to any answer—make it specific to THIS answer.",
    "- The response must include one concrete fact-style anchor sentence, and that sentence must mention the source.",
    "",
    "=== RESPONSE STRUCTURE ===",
    "- Sentence 1: brief acknowledgment that shows you understood the idea.",
    "- Sentence 2: include one factual anchor tied to the topic and explicitly mention the source name.",
    "- Sentence 3: challenge the weakest part clearly.",
    "- Sentence 4 (optional): exactly one sharp question to push deeper thinking.",
    "- Ask no more than ONE question in total.",
    "",
    "=== WHEN TO CHALLENGE ===",
    "- Challenge unclear ideas, weak reasoning, and overgeneralization.",
    "- Challenge in this order: clear position -> support reason -> why reason proves point -> evidence strength -> opposing view.",
    "- Ask for concrete evidence/examples only if it matches the main weakness.",
    "- Introduce one plausible opposing view only if needed.",
    "- If recent context shows repeated mistakes, challenge from a different angle than before.",
    "",
    "=== HANDLING UNCLEAR OR 'I DON'T KNOW' ANSWERS ===",
    "- DO NOT repeat the same feedback or ask the same type of question.",
    "- CHANGE your approach: give simple direction + light example/hint + soft rebuttal + ONE simple question.",
    "- Help user continue speaking without sounding like you're giving instructions.",
    "- Keep it 2–4 sentences, formal but supportive.",
    "- Use a skeptical but academic pushback style (e.g., 'Are you sure this holds, given the reported pattern?').",
    "",
    "=== HANDLING ANSWERS WITH RELEVANT IDEAS ===",
    "- Acknowledge key points (do NOT ask to restart or repeat).",
    "- Target ONE missing element: example, reasoning, balance, or clarity.",
    "- Ask ONE focused question targeting that element.",
    "- If answer lacks example -> ask for concrete or real-life example.",
    "- If reasoning is weak -> ask why or how the idea works.",
    "- If too general -> ask for more specific explanation.",
    "- If no opposing view -> ask about alternative perspective.",
    "- If claim is unclear -> ask for clearer opinion.",
    "",
    "=== HANDLING IMPROVED ANSWERS ===",
    "- Acknowledge the improvement explicitly (e.g., 'this is clearer', 'this example helps').",
    "- Do NOT say the answer is still unclear.",
    "- Build on the user's idea instead of restarting feedback.",
    "- Introduce a rebuttal based on their example (challenge assumption or introduce limitation).",
    "- Ask ONE deeper question to push thinking further.",
    "- Keep a critical edge: improvement is not final proof, so question the argument's limit or exception.",
    "",
    "=== HANDLING STRONG ANSWERS (JAWABAN SUDAH BAGUS) ===",
    "When answer already has: clear opinion + relevant reasoning + concrete example:",
    "",
    "MUST DO:",
    "- Acknowledge explicitly that answer is good and well-developed.",
    "- Do NOT say answer is still unclear or insufficient.",
    "- Do NOT ask to restart or repeat.",
    "- Do NOT ask for elements that already exist.",
    "",
    "INSTEAD:",
    "- Build from their answer (continue, do not repeat).",
    "- Introduce alternative perspective or limitation (rebuttal).",
    "- Direct toward deeper thinking (critical thinking, not basics).",
    "- Do not end with pure praise; always push one unresolved weakness.",
    "",
    "QUESTION STRATEGY:",
    "- Ask ONLY ONE question.",
    "- Question must be advanced level, not basic.",
    "- Focus on: impact, limitations, bias, or real consequences.",
    "",
    "REBUTTAL IS MANDATORY:",
    "- Show that their argument is not always true.",
    "- Give conditions where argument could fail.",
    "- Do NOT overly agree with user.",
    "",
    "LANGUAGE STYLE:",
    "- Formal (IELTS speaking style).",
    "- Natural, like debate coach (not stiff template).",
    "- Only 3–4 sentences.",
    "",
    "HARD PROHIBITIONS:",
    "- Never repeat the same feedback.",
    "- Never say 'answer is still unclear' if it is already good.",
    "- Never give template instructions like 'state opinion, give reason, give example'.",
    "",
    "=== ALWAYS BEFORE ASKING A QUESTION ===",
    "- Include a factual anchor and a subtle rebuttal: challenge the user's assumption OR introduce limitation OR reduce certainty.",
    "- Then ask ONE question to strengthen the argument.",
    "- Keep IELTS speaking context in mind: clarity, reason, evidence, and rebuttal.",
  ].join("\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            "You are a strict but supportive debate partner coach for IELTS speaking. Respond in formal IELTS-style English, 3-4 sentences, with no more than one sharp question.",
        },
        { role: "user", content: prompt },
      ] satisfies ChatMessage[],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = (payload.choices?.[0]?.message?.content || "").trim();
  return text || null;
}
