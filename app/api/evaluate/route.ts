import { NextRequest, NextResponse } from "next/server";
import { ieltsToCefr } from "@/lib/question-bank";
import { enforceRateLimit, isAllowedOrigin } from "@/lib/security";

type CriterionName =
  | "Fluency and Coherence"
  | "Lexical Resource"
  | "Grammatical Range and Accuracy"
  | "Pronunciation";

type CriterionDetail = {
  score: number;
  description: string;
  bandExplanation: string;
  suggestion: string;
};

const RUBRIC: Record<CriterionName, Record<number, string>> = {
  "Fluency and Coherence": {
    9: "Seamless flow with precise cohesion",
    8: "Fluent with minor hesitation",
    7: "Generally coherent",
    6: "Some loss of coherence",
    5: "Frequent hesitation",
  },
  "Lexical Resource": {
    9: "Very wide and precise vocabulary",
    8: "Wide vocabulary",
    7: "Adequate vocabulary",
    6: "Limited vocabulary",
    5: "Very limited vocabulary",
  },
  "Grammatical Range and Accuracy": {
    9: "Consistently accurate with full range",
    8: "Mostly accurate",
    7: "Some errors",
    6: "Frequent errors",
    5: "Major errors",
  },
  Pronunciation: {
    9: "Fully clear and natural throughout",
    8: "Very clear",
    7: "Generally clear",
    6: "Sometimes unclear",
    5: "Hard to understand",
  },
};

const CRITERIA_EXPLANATIONS: Record<CriterionName, Record<number, string>> = {
  "Fluency and Coherence": {
    9: "Sangat lancar dan terorganisir; hubungan antar ide halus dan presisi.",
    8: "Umumnya lancar, hanya sesekali ragu; ide terhubung dengan baik.",
    7: "Bisa bicara panjang, masih ada jeda/self-correction, namun tetap koheren.",
    6: "Mampu lanjut berbicara, tetapi jeda/pengulangan kadang mengganggu alur.",
    5: "Kelancaran terbatas; sering ragu dan mengulang sehingga koherensi menurun.",
  },
  "Lexical Resource": {
    9: "Kosakata sangat luas, presisi tinggi, dan fleksibel di berbagai konteks.",
    8: "Kosakata luas dan cukup fleksibel; salah pilih kata hanya sesekali.",
    7: "Kosakata memadai dan ada upaya pakai kata kurang umum, meski masih ada error.",
    6: "Kosakata cukup untuk menjelaskan ide, tapi akurasi/presisi belum konsisten.",
    5: "Rentang kosakata terbatas dan error pemilihan kata cukup terlihat.",
  },
  "Grammatical Range and Accuracy": {
    9: "Struktur kalimat sangat beragam dan hampir selalu akurat.",
    8: "Variasi struktur kalimat luas, error minor dan tidak terlalu mengganggu.",
    7: "Sudah memakai struktur kompleks, tetapi masih ada beberapa kesalahan grammar.",
    6: "Campuran kalimat sederhana-kompleks ada, tapi fleksibilitas dan akurasi terbatas.",
    5: "Mayoritas kalimat sederhana, kesalahan grammar cukup sering muncul.",
  },
  Pronunciation: {
    9: "Pengucapan sangat jelas dan natural, nyaris tanpa hambatan pemahaman.",
    8: "Pengucapan umumnya jelas, hanya ada gangguan kecil sesekali.",
    7: "Sebagian besar bisa dipahami, meski ada beberapa salah ucap.",
    6: "Cukup bisa dipahami, tapi kesalahan pengucapan masih cukup terasa.",
    5: "Masalah pengucapan cukup sering dan mulai mengurangi kejelasan makna.",
  },
};

const RUBRIC_BANDS = [5, 6, 7, 8, 9] as const;

function criterionSuggestion(criteria: CriterionName, score: number): string {
  if (criteria === "Fluency and Coherence") {
    if (score >= 7) return "Pertahankan ritme bicara stabil; tambah transisi ide seperti 'however', 'therefore'.";
    return "Latih jawaban 1 ide + 1 alasan + 1 contoh agar alur lebih nyambung dan minim jeda.";
  }
  if (criteria === "Lexical Resource") {
    if (score >= 7) return "Tambah idiomatic/less common vocabulary secukupnya agar ekspresi lebih presisi.";
    return "Bangun bank kosakata topikal (education/media/personal) dan latihan paraphrase 2-3 versi.";
  }
  if (criteria === "Grammatical Range and Accuracy") {
    if (score >= 7) return "Variasikan complex sentence (although/while/which) sambil jaga akurasi tense & agreement.";
    return "Fokus kurangi error dasar: subject-verb agreement, tense konsisten, article/preposition.";
  }
  if (score >= 7) return "Pertajam word stress dan sentence stress agar intonasi makin natural.";
  return "Latih shadowing 5-10 menit/hari untuk clarity, rhythm, dan pengucapan kata kunci.";
}

function clampBandHalf(score: number): number {
  const rounded = Math.round(score * 2) / 2;
  if (rounded >= 9) return 9;
  if (rounded <= 5) return 5;
  return rounded;
}

function nearestRubricBand(score: number): 5 | 6 | 7 | 8 | 9 {
  let best = 5 as 5 | 6 | 7 | 8 | 9;
  let diff = Number.POSITIVE_INFINITY;
  for (const band of RUBRIC_BANDS) {
    const currentDiff = Math.abs(score - band);
    if (currentDiff < diff) {
      diff = currentDiff;
      best = band;
    }
  }
  return best;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) || []).filter(Boolean);
}

function analyzeAnswers(answers: string[]) {
  const joined = answers.join(" ");
  const lowerJoined = joined.toLowerCase();
  const words = tokenize(joined);
  const totalWords = words.length;
  const uniqueWords = new Set(words).size;
  const avgWordsPerAnswer = totalWords / Math.max(1, answers.length);
  const sentences = joined
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const connectorPatterns = [
    /\bbecause\b/g,
    /\bhowever\b/g,
    /\btherefore\b/g,
    /\bfor example\b/g,
    /\bfor instance\b/g,
    /\balthough\b/g,
    /\bwhile\b/g,
    /\bon the other hand\b/g,
  ];
  const evidencePatterns = [
    /\bfor example\b/g,
    /\bfor instance\b/g,
    /\baccording to\b/g,
    /\bas seen\b/g,
    /\bduring\b/g,
    /\bdata\b/g,
    /\breport\b/g,
    /\bdebate(s)?\b/g,
    /\bcountry|countries|china|tiktok|instagram|twitter|facebook\b/g,
  ];
  const disfluencyPatterns = [
    /\bum\b/g,
    /\buh\b/g,
    /\byou know\b/g,
    /\blike\s+like\b/g,
    /\bhmm\b/g,
    /\bi don't know\b/g,
  ];

  const countMatches = (patterns: RegExp[]): number =>
    patterns.reduce((sum, re) => {
      const matches = lowerJoined.match(re);
      return sum + (matches ? matches.length : 0);
    }, 0);

  const connectorHits = countMatches(connectorPatterns);
  const evidenceHits = countMatches(evidencePatterns);
  const disfluencyHits = countMatches(disfluencyPatterns);

  const veryShortAnswers = answers.filter((a) => tokenize(a).length < 12).length;
  const repeatedWordRatio =
    totalWords > 0 ? 1 - Math.min(1, uniqueWords / Math.max(1, totalWords)) : 1;

  // Rough grammar risk signals from text transcript only.
  const grammarRiskPatterns = [
    /\b(is|are|was|were)\s+\1\b/i,
    /\bthe the\b/i,
    /\b(can|could|will|would)\s+be\s+\w+ed\s+to\b/i,
    /\b(he|she|it)\s+have\b/i,
  ];
  const grammarRiskHits = grammarRiskPatterns.reduce((sum, re) => sum + (re.test(joined) ? 1 : 0), 0);

  return {
    totalWords,
    uniqueWords,
    avgWordsPerAnswer,
    sentenceCount: sentences.length,
    connectorHits,
    evidenceHits,
    disfluencyHits,
    veryShortAnswers,
    repeatedWordRatio,
    grammarRiskHits,
    lexicalDiversity: uniqueWords / Math.max(1, totalWords),
  };
}

function scoreByCriteria(answers: string[]): Record<CriterionName, number> {
  const stats = analyzeAnswers(answers);

  let fluency = 5;
  if (stats.avgWordsPerAnswer >= 18) fluency += 0.5;
  if (stats.avgWordsPerAnswer >= 24) fluency += 0.5;
  if (stats.avgWordsPerAnswer >= 30) fluency += 0.5;
  if (stats.connectorHits >= 2) fluency += 0.5;
  if (stats.connectorHits >= 4) fluency += 0.5;
  if (stats.connectorHits >= 6) fluency += 0.5;
  if (stats.veryShortAnswers >= Math.ceil(answers.length / 2)) fluency -= 0.5;
  if (stats.disfluencyHits >= 2) fluency -= 0.5;

  let lexical = 5;
  if (stats.lexicalDiversity >= 0.38) lexical += 0.5;
  if (stats.lexicalDiversity >= 0.45) lexical += 0.5;
  if (stats.lexicalDiversity >= 0.52) lexical += 0.5;
  if (stats.lexicalDiversity >= 0.68 && stats.totalWords >= 60) lexical += 0.5;
  if (stats.lexicalDiversity >= 0.58) lexical += 0.5;
  if (stats.evidenceHits >= 2) lexical += 0.5;
  if (stats.evidenceHits >= 4) lexical += 0.5;
  if (stats.repeatedWordRatio > 0.62) lexical -= 0.5;

  let grammar = 5;
  if (stats.avgWordsPerAnswer >= 18) grammar += 0.5;
  if (stats.avgWordsPerAnswer >= 24) grammar += 0.5;
  if (stats.avgWordsPerAnswer >= 30) grammar += 0.5;
  if (stats.connectorHits >= 2) grammar += 0.5;
  if (stats.connectorHits >= 4) grammar += 0.5;
  if (stats.evidenceHits >= 3) grammar += 0.5;
  if (stats.grammarRiskHits >= 1) grammar -= 0.5;
  if (stats.grammarRiskHits >= 2) grammar -= 0.5;

  let pronunciation = 6;
  if (stats.disfluencyHits >= 2) pronunciation -= 0.5;
  if (stats.avgWordsPerAnswer < 16) pronunciation -= 0.5;
  if (stats.connectorHits >= 2 && stats.veryShortAnswers === 0) pronunciation += 0.5;
  if (stats.connectorHits >= 4 && stats.veryShortAnswers === 0) pronunciation += 0.5;
  if (stats.avgWordsPerAnswer >= 28 && stats.disfluencyHits === 0) pronunciation += 0.5;

  return {
    "Fluency and Coherence": clampBandHalf(fluency),
    "Lexical Resource": clampBandHalf(lexical),
    "Grammatical Range and Accuracy": clampBandHalf(grammar),
    Pronunciation: clampBandHalf(pronunciation),
  };
}

function scoreAnswers(answers: string[]): {
  detail: Record<CriterionName, CriterionDetail>;
  notes: string[];
  bandScore: number;
  analytics: {
    totalWords: number;
    lexicalDiversity: number;
    avgWordsPerAnswer: number;
    connectorHits: number;
    evidenceHits: number;
    grammarRiskHits: number;
    disfluencyHits: number;
  };
} {
  const criteriaScores = scoreByCriteria(answers);
  const stats = analyzeAnswers(answers);
  const detail = {} as Record<CriterionName, CriterionDetail>;

  (Object.keys(RUBRIC) as CriterionName[]).forEach((criteria) => {
    const score = criteriaScores[criteria];
    const rubricBand = nearestRubricBand(score);
    detail[criteria] = {
      score,
      description: RUBRIC[criteria][rubricBand],
      bandExplanation:
        CRITERIA_EXPLANATIONS[criteria][rubricBand] || "Penjelasan detail belum tersedia untuk band ini.",
      suggestion: criterionSuggestion(criteria, Math.round(score)),
    };
  });

  const rawOverall =
    (detail["Fluency and Coherence"].score +
      detail["Lexical Resource"].score +
      detail["Grammatical Range and Accuracy"].score +
      detail.Pronunciation.score) /
    4;

  let bandScore = Math.round(rawOverall * 2) / 2;

  // Strict IELTS guardrails: weak grammar/coherence should cap overall score.
  if (detail["Grammatical Range and Accuracy"].score <= 5 || detail["Fluency and Coherence"].score <= 5) {
    bandScore = Math.min(bandScore, 6);
  }
  if (detail["Lexical Resource"].score <= 5) {
    bandScore = Math.min(bandScore, 6.5);
  }

  if (detail["Fluency and Coherence"].score >= 8.5 && detail["Grammatical Range and Accuracy"].score >= 8.5) {
    bandScore = Math.max(bandScore, 8.5);
  }

  if (
    detail["Fluency and Coherence"].score >= 9 &&
    detail["Lexical Resource"].score >= 8.5 &&
    detail["Grammatical Range and Accuracy"].score >= 8.5
  ) {
    bandScore = 9;
  }

  const notes = (Object.keys(detail) as CriterionName[]).map(
    (criteria) => `${criteria}: ${detail[criteria].suggestion}`
  );

  return {
    detail,
    notes,
    bandScore,
    analytics: {
      totalWords: stats.totalWords,
      lexicalDiversity: Number(stats.lexicalDiversity.toFixed(3)),
      avgWordsPerAnswer: Number(stats.avgWordsPerAnswer.toFixed(1)),
      connectorHits: stats.connectorHits,
      evidenceHits: stats.evidenceHits,
      grammarRiskHits: stats.grammarRiskHits,
      disfluencyHits: stats.disfluencyHits,
    },
  };
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ message: "Origin tidak diizinkan" }, { status: 403 });
  }

  const rateLimit = enforceRateLimit(request, "evaluate", { max: 30, windowMs: 60_000 });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { message: "Terlalu banyak request, coba lagi sebentar." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    const answers = Array.isArray(body?.answers) ? body.answers.map(String) : [];

    if (!answers.length) {
      return NextResponse.json({ message: "answers tidak boleh kosong" }, { status: 400 });
    }

    const scored = scoreAnswers(answers);
    return NextResponse.json({
      ...scored,
      cefr: ieltsToCefr(scored.bandScore),
    });
  } catch {
    return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
  }
}
