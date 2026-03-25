import { NextRequest, NextResponse } from "next/server";
import { buildUserLearningPlan, getUserMemory, updateUserModelPreference } from "@/lib/user-memory";
import { enforceRateLimit, isAllowedOrigin } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const rateLimit = enforceRateLimit(request, "user-memory-get", { max: 60, windowMs: 60_000 });
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

  const memory = await getUserMemory(userId);
  return NextResponse.json({
    memory,
    learningPlan: buildUserLearningPlan(memory),
  });
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ message: "Origin tidak diizinkan" }, { status: 403 });
  }

  const rateLimit = enforceRateLimit(request, "user-memory-post", { max: 30, windowMs: 60_000 });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { message: "Terlalu banyak request, coba lagi sebentar." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    const userId = String(body?.userId || "").trim();
    const preferredModel = String(body?.preferredModel || "").trim();
    const fineTunedModel = String(body?.fineTunedModel || "").trim();

    if (!userId) {
      return NextResponse.json({ message: "userId wajib diisi" }, { status: 400 });
    }

    await updateUserModelPreference({
      userId,
      preferredModel: preferredModel || undefined,
      fineTunedModel: fineTunedModel || undefined,
    });

    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
  }
}
