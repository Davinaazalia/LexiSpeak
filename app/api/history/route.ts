import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { upsertUserMemory } from "@/lib/user-memory";
import { enforceRateLimit, isAllowedOrigin } from "@/lib/security";

const TABLE_NAME = "speaking_sessions";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const rateLimit = enforceRateLimit(request, "history-get", { max: 60, windowMs: 60_000 });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { message: "Terlalu banyak request, coba lagi sebentar." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  const userId = (request.nextUrl.searchParams.get("userId") || "").trim();
  if (!userId) {
    return NextResponse.json({ message: "userId wajib diisi" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ sessions: [], message: "Supabase belum dikonfigurasi" }, { status: 200 });
  }

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("id, user_id, mode, domain, topic_label, band_score, cefr, answers_count, score_detail, notes, qa_transcripts, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessions: data || [] });
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ message: "Origin tidak diizinkan" }, { status: 403 });
  }

  const rateLimit = enforceRateLimit(request, "history-post", { max: 30, windowMs: 60_000 });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { message: "Terlalu banyak request, coba lagi sebentar." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    const userId = String(body?.userId || "").trim();

    if (!userId) {
      return NextResponse.json({ message: "userId wajib diisi" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ message: "Supabase belum dikonfigurasi" }, { status: 503 });
    }

    const payload = {
      user_id: userId,
      mode: String(body?.mode || "unknown"),
      domain: String(body?.domain || "unknown"),
      topic_label: String(body?.topicLabel || ""),
      band_score: Number(body?.bandScore || 0),
      cefr: String(body?.cefr || ""),
      answers_count: Number(body?.answersCount || 0),
      score_detail: body?.detail || {},
      notes: Array.isArray(body?.notes) ? body.notes.map(String) : [],
      qa_transcripts: Array.isArray(body?.qaTranscripts)
        ? body.qaTranscripts.map((item: unknown, index: number) => {
            const row = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
            return {
              index,
              question: String(row.question || ""),
              transcript: String(row.transcript || ""),
            };
          })
        : [],
    };

    const qaForMemory = payload.qa_transcripts.filter(
      (row: { index: number; question: string; transcript: string }) =>
        String(row.question || "").trim() !== "__TRANSCRIPT_BLOCK__"
    );

    const { data, error } = await supabase.from(TABLE_NAME).insert(payload).select("id").single();

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }

    await upsertUserMemory({
      userId,
      qaTranscripts: qaForMemory,
      bandScore: payload.band_score,
      preferredModel: String(body?.chatModel || "").trim() || undefined,
    });

    return NextResponse.json({ saved: true, id: data?.id || null });
  } catch {
    return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
  }
}
