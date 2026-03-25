export type DomainKey = "news_and_media" | "education" | "personal_development";

export const QUESTION_BANK: Record<DomainKey, string[]> = {
  news_and_media: [
    "How do most people find out about the news in your country?",
    "Are people more interested in local news than national news? Why?",
    "Why are discussion programs involving members of the public popular on TV and radio?",
    "How can media influence people's opinions?",
    "Do you think young people consume news differently from older people?",
    "How do social media platforms change the way people evaluate information?",
    "What are the risks of getting news mainly from short videos?",
    "Should schools teach media literacy as a compulsory subject?",
  ],
  education: [
    "What makes a good high school teacher?",
    "Should homework be reduced for high school students? Why or why not?",
    "Do exams fairly measure students' abilities?",
    "How can schools improve students' critical thinking skills?",
    "Should schools focus more on soft skills than memorization?",
    "What role should technology play in classroom learning?",
    "Should students be allowed to use AI tools for school tasks?",
    "What changes would you make to your country's education system?",
  ],
  personal_development: [
    "What do you think your best personal qualities are? Why?",
    "Do you think you have the personal qualities to be a good leader? Why or why not?",
    "How can people build self-confidence when speaking in public?",
    "Why do some people find it difficult to accept criticism?",
    "How important is discipline in achieving long-term goals?",
    "Is failure necessary for personal growth?",
    "How can young people manage stress effectively?",
    "What is one life skill that schools should teach more seriously?",
  ],
};

function shuffle<T>(arr: T[]): T[] {
  const cloned = [...arr];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function asQuestion(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "What is your opinion about this topic?";
  }
  return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
}

export function generateLocalFromDomain(domain: DomainKey, count = 10): string[] {
  const base = QUESTION_BANK[domain] ?? QUESTION_BANK.news_and_media;
  const padded = [
    ...base,
    `What is the biggest challenge in ${domain.replaceAll("_", " ")} today?`,
    `What policy would improve ${domain.replaceAll("_", " ")} outcomes?`,
    `What is one common misconception about ${domain.replaceAll("_", " ")}?`,
    `How should young people respond to problems in ${domain.replaceAll("_", " ")}?`,
  ].map(asQuestion);
  return shuffle(padded).slice(0, Math.max(1, count));
}

export function generateFromCustomTopic(topic: string, count = 10): string[] {
  const clean = topic.trim() || "education";
  const patterns = [
    `What is your opinion about ${clean}?`,
    `What are the main benefits and drawbacks of ${clean}?`,
    `Why do people disagree about ${clean}?`,
    `What real example best supports your view on ${clean}?`,
    `How might public opinion on ${clean} change over the next five years?`,
    `How does ${clean} affect different groups in society?`,
    `If you had to design one policy about ${clean}, what would it be?`,
    `What common misconception about ${clean} should be challenged?`,
    `What is the strongest counterargument to your position on ${clean}?`,
    `How can schools teach critical thinking through debates about ${clean}?`,
    `What evidence should people use before making claims about ${clean}?`,
    `How should parents and teachers discuss ${clean} with students?`,
  ];
  return shuffle(patterns).slice(0, Math.max(1, count));
}

export function ieltsToCefr(bandScore: number): string {
  if (bandScore >= 9) return "C2 (Proficient)";
  if (bandScore >= 7) return "C1 (Advanced)";
  if (bandScore >= 5.5) return "B2 (Upper Intermediate)";
  if (bandScore >= 4) return "B1 (Intermediate)";
  return "A2/A1 (Basic User)";
}
