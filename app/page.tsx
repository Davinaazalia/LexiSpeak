"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ttsUtils } from "@/lib/tts-utils";

type SessionMode = "ai_reference" | "local_domain" | "custom_topic";

type EvaluateResult = {
  bandScore: number;
  cefr: string;
  detail: Record<
    "Fluency and Coherence" | "Lexical Resource" | "Grammatical Range and Accuracy" | "Pronunciation",
    {
      score: number;
      description: string;
      bandExplanation: string;
      suggestion: string;
    }
  >;
  notes: string[];
  analytics?: {
    totalWords: number;
    lexicalDiversity: number;
    avgWordsPerAnswer: number;
    connectorHits: number;
    evidenceHits: number;
    grammarRiskHits: number;
    disfluencyHits: number;
  };
};

type QaTranscript = {
  index: number;
  question: string;
  transcript: string;
};

const TRANSCRIPT_ENTRY_KEY = "__TRANSCRIPT_BLOCK__";

type ChatRow = {
  id: string;
  role: "assistant" | "user" | "system";
  text: string;
};

type ModelSource = "fine_tuned" | "preferred" | "fallback" | "none";

type UserLearningPlan = {
  levelLabel: string;
  focusTags: string[];
  drills: string[];
  coachingMode: "stabilize" | "improve" | "push";
};

type ToulminComponent = "claim" | "reason" | "example" | "rebuttal" | "qualifier";

function guidanceLabel(component: ToulminComponent): string {
  if (component === "claim") return "clear opinion";
  if (component === "reason") return "strong reason";
  if (component === "example") return "real example";
  if (component === "rebuttal") return "opposite-view response";
  return "balanced certainty";
}

type UserMemoryApi = {
  memory?: {
    avg_band?: number | null;
    session_count?: number | null;
    profile_summary?: string | null;
  } | null;
  learningPlan?: UserLearningPlan;
};

type HistorySession = {
  id: string;
  mode: string;
  domain: string;
  topic_label: string;
  band_score: number;
  cefr: string;
  answers_count: number;
  score_detail?: EvaluateResult["detail"];
  notes?: string[];
  qa_transcripts?: QaTranscript[];
  created_at: string;
};

const MODES: Array<{ label: string; value: SessionMode }> = [
  { label: "Generate by AI (nyerempet acuan)", value: "ai_reference" },
  { label: "Generate lokal by domain (tanpa topik utama)", value: "local_domain" },
  { label: "Enter by topic", value: "custom_topic" },
];

const DOMAINS = ["news_and_media", "education", "personal_development"];
const MAX_RECORD_SECONDS = 47;
const CHAT_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"];
const STT_MODELS: Array<{ label: string; value: string }> = [
  { label: "Auto (sesuai AI provider)", value: "" },
  { label: "OpenAI Whisper (whisper-1)", value: "whisper-1" },
  { label: "Groq Whisper Large v3 Turbo", value: "whisper-large-v3-turbo" },
  { label: "Groq Whisper Large v3", value: "whisper-large-v3" },
];
const COACH_NAME = "LexiSpeak Coach";
const COACH_ROLE = "LexiSpeak Debate Partner";
const TARGET_QA_ACTIVITIES = 10;
const QUICK_RESPONSE_CHIPS = [
  "In my view, ... because ...",
  "For example, ...",
  "Some people may argue ..., but ...",
  "In many cases, ...",
];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const shift = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + shift);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekLabel(date: Date): string {
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

function hasCompleteScoreDetail(value: unknown): value is EvaluateResult["detail"] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const detail = value as Record<string, unknown>;
  const requiredKeys = [
    "Fluency and Coherence",
    "Lexical Resource",
    "Grammatical Range and Accuracy",
    "Pronunciation",
  ];

  return requiredKeys.every((key) => {
    const row = detail[key];
    return (
      !!row &&
      typeof row === "object" &&
      typeof (row as { score?: unknown }).score === "number" &&
      typeof (row as { description?: unknown }).description === "string" &&
      typeof (row as { bandExplanation?: unknown }).bandExplanation === "string" &&
      typeof (row as { suggestion?: unknown }).suggestion === "string"
    );
  });
}

function extractPolishedTranscript(block: string): string {
  const text = String(block || "");
  const match = text.match(/Polished Transcript:\n([\s\S]*?)\n\nMetrics:/);
  const candidate = match?.[1]?.trim() || "";
  return candidate;
}

export default function Home() {
  const [mode, setMode] = useState<SessionMode>("local_domain");
  const [domain, setDomain] = useState<string>(DOMAINS[0]);
  const [anchorTopic, setAnchorTopic] = useState<string>("news and media");
  const [customTopic, setCustomTopic] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [chatModel, setChatModel] = useState<string>(CHAT_MODELS[0]);
  const [sttModel, setSttModel] = useState<string>(STT_MODELS[0].value);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [isScoring, setIsScoring] = useState<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordSecondsLeft, setRecordSecondsLeft] = useState<number>(MAX_RECORD_SECONDS);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string>("");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [uploadedAudioFile, setUploadedAudioFile] = useState<File | null>(null);
  const [awaitingFollowup, setAwaitingFollowup] = useState<boolean>(false);
  const [pendingFollowup, setPendingFollowup] = useState<string>("");
  const [pendingRequiredComponents, setPendingRequiredComponents] = useState<ToulminComponent[]>([]);
  const [sessionSaved, setSessionSaved] = useState<boolean>(false);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyItems, setHistoryItems] = useState<HistorySession[]>([]);
  const [activeModel, setActiveModel] = useState<string>("");
  const [activeModelSource, setActiveModelSource] = useState<ModelSource>("none");
  const [learningPlan, setLearningPlan] = useState<UserLearningPlan | null>(null);
  const [avgBandSnapshot, setAvgBandSnapshot] = useState<number>(0);
  const [sessionCountSnapshot, setSessionCountSnapshot] = useState<number>(0);
  const [activeTap, setActiveTap] = useState<string>("");
  const [actionHint, setActionHint] = useState<string>("");
  const [playingId, setPlayingId] = useState<string>("");

  const [started, setStarted] = useState<boolean>(false);
  const [questions, setQuestions] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [draftAnswer, setDraftAnswer] = useState<string>("");
  const [answers, setAnswers] = useState<string[]>([]);
  const [qaRecords, setQaRecords] = useState<QaTranscript[]>([]);
  const [chatRows, setChatRows] = useState<ChatRow[]>([]);
  const [result, setResult] = useState<EvaluateResult | null>(null);
  const [error, setError] = useState<string>("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimeoutRef = useRef<number | null>(null);
  const recordTickerRef = useRef<number | null>(null);
  const tapTimeoutRef = useRef<number | null>(null);
  const hintTimeoutRef = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const isLastQuestion = currentIndex >= questions.length - 1;
  const topicLabel =
    mode === "custom_topic" ? customTopic.trim() : mode === "ai_reference" ? anchorTopic.trim() : domain;

  const progressText = useMemo(() => {
    if (!started || questions.length === 0) {
      return "Belum mulai session";
    }
    return `Aktivitas ${answers.length} / ${TARGET_QA_ACTIVITIES}`;
  }, [started, questions.length, currentIndex, answers.length]);

  const weeklyTrend = useMemo(() => {
    const map = new Map<string, { label: string; values: number[] }>();

    for (const item of historyItems) {
      const current = new Date(item.created_at);
      if (Number.isNaN(current.getTime())) {
        continue;
      }
      const weekStart = getWeekStart(current);
      const key = weekStart.toISOString().slice(0, 10);
      const existing = map.get(key) || { label: formatWeekLabel(weekStart), values: [] };
      existing.values.push(Number(item.band_score) || 0);
      map.set(key, existing);
    }

    const rows = Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-8)
      .map(([key, value]) => {
        const avg = value.values.reduce((sum, n) => sum + n, 0) / Math.max(1, value.values.length);
        return {
          key,
          label: value.label,
          avg: Number(avg.toFixed(1)),
          count: value.values.length,
        };
      });

    return rows;
  }, [historyItems]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [chatRows, result]);

  const clearRecordedAudio = () => {
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
    }
    setRecordedAudioUrl("");
    setAudioBlob(null);
    setUploadedAudioFile(null);
  };

  const appendChatRow = (role: ChatRow["role"], text: string) => {
    setChatRows((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, role, text }]);
  };

  const loadHistoryToChat = (item: HistorySession) => {
    const rows: ChatRow[] = [];

    rows.push({
      id: `hist-${item.id}-summary`,
      role: "system",
      text: `Riwayat: ${new Date(item.created_at).toLocaleString()} | Band ${Number(item.band_score).toFixed(1)} (${item.cefr}) | Topik: ${item.topic_label || item.domain}`,
    });

    const transcripts = Array.isArray(item.qa_transcripts) ? item.qa_transcripts : [];
    if (!transcripts.length) {
      rows.push({
        id: `hist-${item.id}-empty`,
        role: "system",
        text: "Transcript untuk sesi ini tidak tersedia.",
      });
    } else {
      transcripts.forEach((entry, index) => {
        const qText = String(entry.question || "").trim();
        const aText = String(entry.transcript || "").trim();

        if (qText === TRANSCRIPT_ENTRY_KEY || isTranscriptNote(aText) || isTranscriptNote(qText)) {
          rows.push({
            id: `hist-${item.id}-t-${index}`,
            role: "system",
            text: isTranscriptNote(aText) ? aText : qText,
          });
          return;
        }

        if (qText) {
          rows.push({
            id: `hist-${item.id}-q-${index}`,
            role: "assistant",
            text: qText,
          });
        }

        if (aText) {
          rows.push({
            id: `hist-${item.id}-a-${index}`,
            role: "user",
            text: aText,
          });
        }
      });
    }

    rows.push({
      id: `hist-${item.id}-result`,
      role: "assistant",
      text: `Final result: Band ${Number(item.band_score).toFixed(1)} (${item.cefr}).`,
    });

    setChatRows(rows);
    setStarted(false);
    setAwaitingFollowup(false);
    setPendingFollowup("");
    setPendingRequiredComponents([]);
    setDraftAnswer("");

    if (hasCompleteScoreDetail(item.score_detail)) {
      setResult({
        bandScore: Number(item.band_score) || 0,
        cefr: String(item.cefr || ""),
        detail: item.score_detail,
        notes: Array.isArray(item.notes) ? item.notes.map(String) : [],
      });
      return;
    }

    setResult(null);
  };

  const isTranscriptNote = (text: string): boolean => text.startsWith("-----Transcripts-----");

  const clearRecordTimers = () => {
    if (recordTimeoutRef.current) {
      window.clearTimeout(recordTimeoutRef.current);
      recordTimeoutRef.current = null;
    }
    if (recordTickerRef.current) {
      window.clearInterval(recordTickerRef.current);
      recordTickerRef.current = null;
    }
    setRecordSecondsLeft(MAX_RECORD_SECONDS);
  };

  const stopMicTracks = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const loadHistory = async (targetUserId: string) => {
    const cleanUserId = targetUserId.trim();
    if (!cleanUserId) {
      return;
    }

    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/history?userId=${encodeURIComponent(cleanUserId)}`);
      if (!response.ok) {
        throw new Error("Gagal load history");
      }
      const data = (await response.json()) as { sessions?: HistorySession[] };
      setHistoryItems(data.sessions || []);
    } catch {
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadLearningProfile = async (targetUserId: string) => {
    const cleanUserId = targetUserId.trim();
    if (!cleanUserId) {
      setLearningPlan(null);
      setAvgBandSnapshot(0);
      setSessionCountSnapshot(0);
      return;
    }

    try {
      const response = await fetch(`/api/user-memory?userId=${encodeURIComponent(cleanUserId)}`);
      if (!response.ok) {
        throw new Error("Gagal load learning profile");
      }
      const data = (await response.json()) as UserMemoryApi;
      setLearningPlan(data.learningPlan || null);
      setAvgBandSnapshot(Number(data.memory?.avg_band || 0));
      setSessionCountSnapshot(Number(data.memory?.session_count || 0));
    } catch {
      setLearningPlan(null);
      setAvgBandSnapshot(0);
      setSessionCountSnapshot(0);
    }
  };

  useEffect(() => {
    const storedUser =
      window.localStorage.getItem("lexispeak_user_id") || window.localStorage.getItem("ielts_user_id") || "";
    if (storedUser) {
      setUserId(storedUser);
      loadHistory(storedUser);
      loadLearningProfile(storedUser);
    }

    return () => {
      clearRecordTimers();
      stopMicTracks();
      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
      }
      if (tapTimeoutRef.current) {
        window.clearTimeout(tapTimeoutRef.current);
      }
      if (hintTimeoutRef.current) {
        window.clearTimeout(hintTimeoutRef.current);
      }
      ttsUtils.stop();
    };
  }, []);

  const triggerButtonFeedback = (buttonId: string, hint?: string) => {
    setActiveTap(buttonId);
    if (tapTimeoutRef.current) {
      window.clearTimeout(tapTimeoutRef.current);
    }
    tapTimeoutRef.current = window.setTimeout(() => {
      setActiveTap("");
    }, 220);

    if (hint) {
      setActionHint(hint);
      if (hintTimeoutRef.current) {
        window.clearTimeout(hintTimeoutRef.current);
      }
      hintTimeoutRef.current = window.setTimeout(() => {
        setActionHint("");
      }, 1600);
    }
  };

  const handleTtsClick = (messageId: string, text: string) => {
    if (playingId === messageId) {
      // Stop if already playing
      ttsUtils.stop();
      setPlayingId("");
    } else {
      // Start playing
      ttsUtils.speak(text, { rate: 1, pitch: 1, volume: 1 }, () => {
        setPlayingId("");
      });
      setPlayingId(messageId);
    }
  };

  useEffect(() => {
    if (!userId.trim()) {
      return;
    }
    window.localStorage.setItem("lexispeak_user_id", userId.trim());
    loadLearningProfile(userId);
  }, [userId]);

  useEffect(() => {
    const saveResultToHistory = async () => {
      if (!result || sessionSaved || !userId.trim()) {
        return;
      }

      try {
        await fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            mode,
            domain,
            topicLabel,
            chatModel: activeModel || chatModel,
            bandScore: result.bandScore,
            cefr: result.cefr,
            answersCount: answers.length,
            detail: result.detail,
            notes: result.notes,
            qaTranscripts: qaRecords,
          }),
        });
        setSessionSaved(true);
        loadHistory(userId);
        loadLearningProfile(userId);
      } catch {
        // Non-blocking: app can still show results without history persistence.
      }
    };

    saveResultToHistory();
  }, [result, sessionSaved, userId, mode, domain, topicLabel, answers, qaRecords, activeModel, chatModel]);

  const getAudioDurationSeconds = (blob: Blob): Promise<number> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        const duration = Number(audio.duration);
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(duration) ? duration : 0);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Gagal baca durasi audio"));
      };
      audio.src = url;
    });

  const startRecording = async () => {
    setError("");
    try {
      clearRecordedAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setRecordedAudioUrl(url);
        stopMicTracks();
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);

      let seconds = MAX_RECORD_SECONDS;
      setRecordSecondsLeft(seconds);
      recordTickerRef.current = window.setInterval(() => {
        seconds -= 1;
        setRecordSecondsLeft(Math.max(0, seconds));
      }, 1000);

      recordTimeoutRef.current = window.setTimeout(() => {
        stopRecording(true);
      }, MAX_RECORD_SECONDS * 1000);
    } catch {
      setError("Microphone tidak bisa diakses. Cek izin browser.");
    }
  };

  const stopRecording = (auto = false) => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      return;
    }
    clearRecordTimers();
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecording(false);
    if (auto) {
      appendChatRow("system", `Recording otomatis dihentikan di ${MAX_RECORD_SECONDS} detik.`);
    }
  };

  const onUploadAudio = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const duration = await getAudioDurationSeconds(file);
      if (duration > MAX_RECORD_SECONDS) {
        setUploadedAudioFile(null);
        setError(`Durasi file ${duration.toFixed(1)}s. Maksimal ${MAX_RECORD_SECONDS}s.`);
        return;
      }
      setError("");
      setUploadedAudioFile(file);
    } catch {
      setError("File audio gagal dibaca. Coba format lain (wav/mp3/m4a/webm).");
      setUploadedAudioFile(null);
    }
  };

  const transcribeRecording = async () => {
    const sourceBlob = uploadedAudioFile || audioBlob;
    if (!sourceBlob) {
      setError("Belum ada audio rekaman/upload untuk ditranscribe.");
      return;
    }

    setError("");
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.set("audio", sourceBlob, uploadedAudioFile?.name || "recording.webm");
      formData.set("language", "en");
      if (sttModel.trim()) {
        formData.set("model", sttModel);
      }
      const durationSeconds = await getAudioDurationSeconds(sourceBlob);
      formData.set("durationSeconds", String(durationSeconds));

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as {
        transcript?: string;
        polishedTranscript?: string;
        metrics?: {
          durationSeconds?: number | null;
          wordCount?: number;
          wpm?: number | null;
        };
        actualTranscriptConfidenceLine?: string;
        actualTranscriptWordConfidence?: Array<{ word: string; confidence: number }>;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message || "Transcribe gagal");
      }

      const rawTranscript = (payload.transcript || "").trim();
      const polishedTranscript = (payload.polishedTranscript || rawTranscript).trim();
      const transcriptMetrics = payload.metrics;
      const confidenceLine = payload.actualTranscriptConfidenceLine || "";

      appendChatRow(
        "system",
        `-----Transcripts-----\nActual Audio Transcript (what native speakers are likely to hear):\n${confidenceLine || rawTranscript}\n\nPolished Transcript:\n${polishedTranscript}\n\nMetrics: duration=${transcriptMetrics?.durationSeconds ?? "-"}s | words=${transcriptMetrics?.wordCount ?? "-"} | WPM=${transcriptMetrics?.wpm ?? "-"}`
      );
      setQaRecords((prev) => [
        ...prev,
        {
          index: prev.length,
          question: TRANSCRIPT_ENTRY_KEY,
          transcript: `-----Transcripts-----\nActual Audio Transcript (what native speakers are likely to hear):\n${confidenceLine || rawTranscript}\n\nPolished Transcript:\n${polishedTranscript}\n\nMetrics: duration=${transcriptMetrics?.durationSeconds ?? "-"}s | words=${transcriptMetrics?.wordCount ?? "-"} | WPM=${transcriptMetrics?.wpm ?? "-"}`,
        },
      ]);
      const fallbackTranscript = polishedTranscript || rawTranscript || "";
      setDraftAnswer((prev) => {
        const merged = [prev.trim(), fallbackTranscript].filter(Boolean).join("\n\n");
        return merged;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcribe gagal");
    } finally {
      setIsTranscribing(false);
    }
  };

  const moveToNextQuestion = () => {
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    if (nextIndex < questions.length) {
      appendChatRow("assistant", questions[nextIndex]);
    }
  };

  const finalizeEvaluation = async (updatedAnswers: string[]) => {
    setIsScoring(true);
    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: updatedAnswers }),
      });

      if (!response.ok) {
        throw new Error("Gagal menghitung skor.");
      }

      const data = (await response.json()) as EvaluateResult;
      setResult(data);
      setStarted(false);
      appendChatRow(
        "assistant",
        `Final after ${TARGET_QA_ACTIVITIES} activities: Band ${data.bandScore.toFixed(1)} (${data.cefr})`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghitung skor.");
    } finally {
      setIsScoring(false);
    }
  };

  const startSession = async () => {
    setError("");
    setResult(null);
    clearRecordedAudio();
    setSessionSaved(false);
    setActiveModel("");
    setActiveModelSource("none");

    if (!userId.trim()) {
      setError("Isi User ID dulu biar progress tersimpan.");
      return;
    }

    setIsStarting(true);
    try {
      const response = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          mode,
          domain,
          anchorTopic,
          customTopic,
          chatModel,
          count: 1,
        }),
      });

      if (!response.ok) {
        throw new Error("Gagal generate question set.");
      }

      const data = (await response.json()) as {
        questions: string[];
        activeModel?: string | null;
        modelSource?: ModelSource;
        personalization?: {
          focusTags: string[];
          coachingMode: "stabilize" | "improve" | "push";
          levelLabel: string;
        } | null;
      };
      if (!data.questions?.length) {
        throw new Error("Question kosong, coba ulangi.");
      }

      const backendModel = data.activeModel || null;
      setActiveModel(backendModel || "");
      setActiveModelSource(data.modelSource || "none");

      setQuestions(data.questions);
      setCurrentIndex(0);
      setAnswers([]);
      setQaRecords([]);
      setChatRows([]);
      setDraftAnswer("");
      setStarted(true);
      setAwaitingFollowup(false);
      setPendingFollowup("");
      setPendingRequiredComponents([]);
      if (backendModel && data.modelSource && data.modelSource !== "none") {
        appendChatRow("system", `Active model: ${backendModel} (${data.modelSource})`);
      }
      if (data.personalization?.focusTags?.length) {
        appendChatRow(
          "system",
          `Learning focus: ${data.personalization.focusTags.join(", ")} (${data.personalization.coachingMode} mode)`
        );
      }
      appendChatRow("assistant", data.questions[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi error tidak dikenal.");
    } finally {
      setIsStarting(false);
    }
  };

  const nextOrFinish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let cleaned = draftAnswer.trim();

    if (!cleaned) {
      const latestTranscriptBlock = [...qaRecords]
        .reverse()
        .find((row) => String(row.question || "").trim() === TRANSCRIPT_ENTRY_KEY);
      const transcriptFallback = latestTranscriptBlock
        ? extractPolishedTranscript(String(latestTranscriptBlock.transcript || ""))
        : "";

      if (transcriptFallback) {
        cleaned = transcriptFallback;
        setDraftAnswer(transcriptFallback);
      }
    }

    if (!cleaned) {
      setError("Jawaban masih kosong.");
      return;
    }

    setError("");
    setDraftAnswer("");
    clearRecordedAudio();
    clearRecordTimers();

    if (awaitingFollowup) {
      appendChatRow("user", cleaned);
      const validateResp = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          mode: "validate",
          question: questions[currentIndex] || "",
          answer: cleaned,
          expectedComponents: pendingRequiredComponents,
        }),
      });

      const validateData = (await validateResp.json()) as {
        isRelevant?: boolean;
        challenge?: string;
        unmetComponents?: ToulminComponent[];
        feedback?: string;
        isMastered?: boolean;
      };

      if (!validateResp.ok || !validateData.isRelevant) {
        appendChatRow(
          "assistant",
          validateData.challenge ||
            "That follow-up is still unclear. Give one clear claim, one reason, and one real example."
        );
        if (Array.isArray(validateData.unmetComponents)) {
          setPendingRequiredComponents(validateData.unmetComponents);
        }
        return;
      }

      const updatedAnswers = [...answers, cleaned];
      setAnswers(updatedAnswers);
      setQaRecords((prev) => [
        ...prev,
        {
          index: prev.length,
          question: `Follow-up: ${pendingFollowup || questions[currentIndex] || ""}`,
          transcript: cleaned,
        },
      ]);
      setAwaitingFollowup(false);
      setPendingFollowup("");
      setPendingRequiredComponents([]);

      const shouldFinalizeNow = Boolean(validateData.isMastered) || updatedAnswers.length >= TARGET_QA_ACTIVITIES;

      if (validateData.feedback && !shouldFinalizeNow) {
        appendChatRow("assistant", validateData.feedback);
      }

      if (shouldFinalizeNow) {
        appendChatRow("assistant", "Good. Your response is sufficient, so I will finalize your speaking result now.");
        await finalizeEvaluation(updatedAnswers);
        return;
      }
      return;
    }

    appendChatRow("user", cleaned);
    const updatedAnswers = [...answers, cleaned];
    setAnswers(updatedAnswers);
    setQaRecords((prev) => [
      ...prev,
      {
        index: prev.length,
        question: questions[currentIndex] || "",
        transcript: cleaned,
      },
    ]);

    if (updatedAnswers.length >= TARGET_QA_ACTIVITIES) {
      await finalizeEvaluation(updatedAnswers);
      return;
    }

    const followResp = await fetch("/api/followup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        mode: "challenge",
        question: questions[currentIndex] || "",
        answer: cleaned,
        modelName: activeModel || chatModel,
        recentContext: chatRows.slice(-6).map((m) => `${m.role}: ${m.text}`),
      }),
    });

    const followData = (await followResp.json()) as {
      required?: boolean;
      challenge?: string;
      isRelevant?: boolean;
      activeModel?: string | null;
      modelSource?: ModelSource;
      requiredComponents?: ToulminComponent[];
      personalization?: {
        focusTags: string[];
        coachingMode: "stabilize" | "improve" | "push";
        levelLabel: string;
      } | null;
    };

    if (followData.activeModel) {
      setActiveModel(followData.activeModel);
    }
    if (followData.modelSource) {
      setActiveModelSource(followData.modelSource);
    }
    if (followData.personalization?.focusTags?.length) {
      setLearningPlan((prev) =>
        prev
          ? {
              ...prev,
              focusTags: followData.personalization?.focusTags || prev.focusTags,
              coachingMode: followData.personalization?.coachingMode || prev.coachingMode,
              levelLabel: followData.personalization?.levelLabel || prev.levelLabel,
            }
          : null
      );
    }

    const challengeText =
      followData.challenge ||
      "Challenge: Defend your argument with one rebuttal. What would critics say, and how do you respond?";

    const shouldAskFollowup = Boolean(challengeText && challengeText.trim().length > 10);

    if (!followResp.ok || followData.required || followData.isRelevant === false || shouldAskFollowup) {
      setAwaitingFollowup(true);
      setPendingFollowup(challengeText);
      setPendingRequiredComponents(Array.isArray(followData.requiredComponents) ? followData.requiredComponents : []);
      appendChatRow("assistant", challengeText);
      return;
    }

    if (!isLastQuestion) {
      moveToNextQuestion();
    } else {
      await finalizeEvaluation(updatedAnswers);
    }
  };

  const resetAll = () => {
    stopRecording();
    stopMicTracks();
    clearRecordedAudio();
    setStarted(false);
    setQuestions([]);
    setCurrentIndex(0);
    setAnswers([]);
    setQaRecords([]);
    setChatRows([]);
    setDraftAnswer("");
    setResult(null);
    setError("");
    setAwaitingFollowup(false);
    setPendingFollowup("");
    setPendingRequiredComponents([]);
    setActiveModel("");
    setActiveModelSource("none");
    clearRecordTimers();
  };

  const useQuickChip = (text: string) => {
    setDraftAnswer((prev) => {
      const next = prev.trim();
      if (!next) return text;
      return `${next}\n${text}`;
    });
  };

  return (
    <main className="chat-shell">
      <aside className="panel chat-sidebar">
        <h2>LexiSpeak</h2>
        <p className="muted">UI chat-style dengan history, model picker, dan audio tools.</p>

        <div className="profile-stack">
          <article className="profile-card">
            <div className="profile-avatar">C</div>
            <div>
              <p className="profile-name">{COACH_NAME}</p>
              <p className="profile-sub">{COACH_ROLE}</p>
            </div>
          </article>
          <article className="profile-card">
            <div className="profile-avatar user-avatar">{(userId.trim()[0] || "U").toUpperCase()}</div>
            <div>
              <p className="profile-name">{userId.trim() || "Your Profile"}</p>
              <p className="profile-sub">Speaking Candidate</p>
            </div>
          </article>
        </div>

        {learningPlan ? (
          <div className="learning-card">
            <h3>Personal Learning Plan</h3>
            <p className="muted tiny-note">Level: {learningPlan.levelLabel}</p>
            <p className="muted tiny-note">
              Progress: avg band {avgBandSnapshot.toFixed(1)} from {sessionCountSnapshot} session(s)
            </p>
            <p className="muted tiny-note">Mode: {learningPlan.coachingMode}</p>
            <div className="tag-row">
              {(learningPlan.focusTags.length ? learningPlan.focusTags : ["general-coaching"]).map((tag) => (
                <span key={tag} className="focus-tag">
                  {tag}
                </span>
              ))}
            </div>
            <ul className="drill-list">
              {learningPlan.drills.map((drill, index) => (
                <li key={`${index}-${drill}`}>{drill}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <label className="field-label" htmlFor="userId">
          User ID (untuk progress)
        </label>
        <input
          id="userId"
          className="input"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="misal: nabila_01"
          disabled={started}
        />

        <label className="field-label" htmlFor="chatModel">Chat model</label>
        <select id="chatModel" className="input" value={chatModel} onChange={(e) => setChatModel(e.target.value)}>
          {CHAT_MODELS.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        {activeModel ? (
          <p className="muted tiny-note">Active backend model: {activeModel} ({activeModelSource})</p>
        ) : null}

        <label className="field-label" htmlFor="sttModel">Transcribe model</label>
        <select id="sttModel" className="input" value={sttModel} onChange={(e) => setSttModel(e.target.value)}>
          {STT_MODELS.map((model) => (
            <option key={model.value || "auto"} value={model.value}>
              {model.label}
            </option>
          ))}
        </select>

        <label className="field-label" htmlFor="mode">Mode soal</label>
        <select
          id="mode"
          className="input"
          value={mode}
          onChange={(e) => setMode(e.target.value as SessionMode)}
          disabled={started}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        {(mode === "ai_reference" || mode === "local_domain") && (
          <>
            <label className="field-label" htmlFor="domain">
              Domain topik
            </label>
            <select
              id="domain"
              className="input"
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                setAnchorTopic(e.target.value.replaceAll("_", " "));
              }}
              disabled={started}
            >
              {DOMAINS.map((key) => (
                <option key={key} value={key}>
                  {key.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </>
        )}

        {mode === "ai_reference" && (
          <>
            <label className="field-label" htmlFor="anchor">
              Topik utama (opsional)
            </label>
            <input
              id="anchor"
              className="input"
              value={anchorTopic}
              onChange={(e) => setAnchorTopic(e.target.value)}
              placeholder="social media in high school"
              disabled={started}
            />
          </>
        )}

        {mode === "custom_topic" && (
          <>
            <label className="field-label" htmlFor="customTopic">
              Enter your own topic
            </label>
            <input
              id="customTopic"
              className="input"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="AI and student learning habits"
              disabled={started}
            />
          </>
        )}

        <div className="button-row side-actions">
          <button
            type="button"
            className={`btn-primary ${activeTap === "start-session" ? "btn-tap" : ""}`}
            onClick={() => {
              triggerButtonFeedback("start-session", "Generating session...");
              startSession();
            }}
            disabled={isStarting || started}
          >
            {isStarting ? "Generating..." : "Start Session"}
          </button>
          <button
            type="button"
            className={`btn-ghost ${activeTap === "load-history" ? "btn-tap" : ""}`}
            onClick={() => {
              triggerButtonFeedback("load-history", "Loading history...");
              loadHistory(userId);
            }}
            disabled={historyLoading || !userId.trim()}
          >
            {historyLoading ? "Loading History..." : "Load History"}
          </button>
          <button
            type="button"
            className={`btn-ghost ${activeTap === "reset-session" ? "btn-tap" : ""}`}
            onClick={() => {
              triggerButtonFeedback("reset-session", "Session reset");
              resetAll();
            }}
          >
            Reset
          </button>
        </div>
        {actionHint ? <p className="action-hint">{actionHint}</p> : null}
        <p className="muted">{progressText}</p>
        {error ? <p className="error-text">{error}</p> : null}

        <div className="side-history">
          <h3>History Chat</h3>
          <p className="muted tiny-note">Klik item riwayat untuk melihat full transcript sesi di panel chat.</p>
          {weeklyTrend.length > 0 ? (
            <div className="mini-trend-grid">
              {weeklyTrend.map((point) => (
                <div key={point.key} className="mini-trend-item" title={`${point.label} avg ${point.avg}`}>
                  <div className="mini-trend-bar" style={{ height: `${Math.max(10, (point.avg / 9) * 100)}%` }} />
                </div>
              ))}
            </div>
          ) : null}

          {!historyItems.length ? <p className="muted">Belum ada session.</p> : null}
          {historyItems.slice(0, 8).map((item) => (
            <button
              key={item.id}
              type="button"
              className="history-pill"
              onClick={() => loadHistoryToChat(item)}
            >
              <span>{new Date(item.created_at).toLocaleDateString()}</span>
              <span>Band {Number(item.band_score).toFixed(1)}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="panel chat-main">
        <div className="chat-main-head">
          <h2>Chat Session</h2>
          {started && questions[currentIndex] ? <p className="question-box">Now: {questions[currentIndex]}</p> : null}
          {awaitingFollowup && pendingFollowup ? <p className="question-box">Gocek/Rebuttal: {pendingFollowup}</p> : null}
          {(isRecording || isTranscribing || isScoring) ? (
            <div className="status-row">
              {isRecording ? <span className="status-pill status-live">Recording {recordSecondsLeft}s</span> : null}
              {isTranscribing ? <span className="status-pill">Transcribing</span> : null}
              {isScoring ? <span className="status-pill">Scoring</span> : null}
            </div>
          ) : null}
          {awaitingFollowup && pendingRequiredComponents.length ? (
            <p className="muted tiny-note">
              Improve this in your next reply: {pendingRequiredComponents.map(guidanceLabel).join(", ")}
            </p>
          ) : null}
        </div>

        <div className="chat-scroll">
          {!chatRows.length ? <p className="muted">Mulai session untuk melihat chat history.</p> : null}
          {chatRows.map((row, index) => (
            row.role === "system" ? (
              <div
                key={row.id}
                className={`chat-system-note ${isTranscriptNote(row.text) ? "chat-system-note-transcript" : ""}`}
              >
                <span style={{ whiteSpace: "pre-wrap" }}>{row.text}</span>
              </div>
            ) : (
              <div
                key={row.id}
                className={`chat-bubble chat-reveal ${row.role === "user" ? "from-user" : "from-assistant"}`}
                style={{ animationDelay: `${Math.min(index * 40, 220)}ms` }}
              >
                <div className="chat-meta">
                  <span className={`chat-avatar ${row.role === "user" ? "chat-avatar-user" : ""}`}>
                    {row.role === "user" ? (userId.trim()[0] || "U").toUpperCase() : "C"}
                  </span>
                  <span className="chat-author">{row.role === "user" ? (userId.trim() || "You") : COACH_NAME}</span>
                </div>
                <p style={{ whiteSpace: "pre-wrap" }}>{row.text}</p>
                <button
                  type="button"
                  className={`tts-button ${playingId === row.id ? "tts-playing" : ""}`}
                  onClick={() => handleTtsClick(row.id, row.text)}
                  title={playingId === row.id ? "Stop speaking" : "Listen"}
                  aria-label={playingId === row.id ? "Stop speaking" : "Listen"}
                >
                  {playingId === row.id ? (
                    <span>⏸ Stop</span>
                  ) : (
                    <span>🔊 Listen</span>
                  )}
                </button>
              </div>
            )
          ))}

          {result ? (
            <div className="chat-bubble from-assistant result-bubble">
              <p>Overall Band: {result.bandScore.toFixed(1)}</p>
              <p>CEFR: {result.cefr}</p>
              <div className="score-grid">
                <div>
                  <h3>Fluency and Coherence</h3>
                  <p>{result.detail["Fluency and Coherence"].score}</p>
                </div>
                <div>
                  <h3>Lexical Resource</h3>
                  <p>{result.detail["Lexical Resource"].score}</p>
                </div>
                <div>
                  <h3>Grammatical Range and Accuracy</h3>
                  <p>{result.detail["Grammatical Range and Accuracy"].score}</p>
                </div>
                <div>
                  <h3>Pronunciation</h3>
                  <p>{result.detail.Pronunciation.score}</p>
                </div>
              </div>

              <div className="rubric-block">
                {(Object.keys(result.detail) as Array<keyof EvaluateResult["detail"]>).map((criteria) => (
                  <article key={criteria} className="rubric-item">
                    <h4>{criteria}</h4>
                    <p>
                      Band {result.detail[criteria].score}: {result.detail[criteria].description}
                    </p>
                    <p>{result.detail[criteria].bandExplanation}</p>
                    <p>Suggestion: {result.detail[criteria].suggestion}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
          <div ref={chatEndRef} />
        </div>

        <form onSubmit={nextOrFinish} className="chat-composer">
          <div className="quick-chip-row">
            {QUICK_RESPONSE_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="quick-chip"
                onClick={() => useQuickChip(chip)}
                disabled={!started}
              >
                {chip}
              </button>
            ))}
          </div>

          <div className="voice-tools compact-tools">
            <div className="button-row">
              <button
                className={`btn-ghost ${activeTap === "start-rec" ? "btn-tap" : ""}`}
                type="button"
                onClick={() => {
                  triggerButtonFeedback("start-rec", "Microphone active");
                  startRecording();
                }}
                disabled={isRecording || isTranscribing || !started}
              >
                Start Rekam
              </button>
              <button
                className={`btn-ghost ${activeTap === "stop-rec" ? "btn-tap" : ""}`}
                type="button"
                onClick={() => {
                  triggerButtonFeedback("stop-rec", "Recording stopped");
                  stopRecording(false);
                }}
                disabled={!isRecording}
              >
                Stop
              </button>
              <button
                className={`btn-ghost ${activeTap === "transcribe" ? "btn-tap" : ""}`}
                type="button"
                onClick={() => {
                  triggerButtonFeedback("transcribe", "Transcribing audio...");
                  transcribeRecording();
                }}
                disabled={isTranscribing || (!audioBlob && !uploadedAudioFile) || !started}
              >
                {isTranscribing ? "Transcribing..." : "Transcribe"}
              </button>
            </div>
            <p className="muted tiny-note">Maksimum rekam: {MAX_RECORD_SECONDS} detik {isRecording ? `| sisa ${recordSecondsLeft}s` : ""}</p>
            <div className="upload-row">
              <label htmlFor="audioUploadInput" className="file-upload-btn">
                Import Audio
              </label>
              <span className="file-name">{uploadedAudioFile ? uploadedAudioFile.name : "Belum pilih file"}</span>
              <input
                id="audioUploadInput"
                className="hidden-file-input"
                type="file"
                accept="audio/*"
                onChange={onUploadAudio}
                disabled={!started || isRecording}
              />
            </div>
            {recordedAudioUrl ? <audio controls src={recordedAudioUrl} className="audio-preview" /> : null}
          </div>

          <textarea
            id="answer"
            className="input textarea"
            value={draftAnswer}
            onChange={(e) => setDraftAnswer(e.target.value)}
            placeholder={started ? "Tulis jawaban kamu di sini atau gunakan transcribe..." : "Start Session dulu"}
            disabled={!started}
          />

          <div className="composer-actions">
            <button className="btn-primary" type="submit" disabled={isScoring || !started}>
              {awaitingFollowup ? "Send Rebuttal" : isLastQuestion ? "Submit Main Answer" : "Send Answer"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
