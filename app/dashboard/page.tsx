import { getSupabaseServerClient } from "@/lib/supabase-server";

type SessionRecord = {
  user_id: string | null;
  band_score: number | null;
  cefr: string | null;
  created_at: string | null;
};

type UserSummary = {
  userId: string;
  sessionCount: number;
  avgBand: number;
  latestBand: number;
  bestBand: number;
  latestCefr: string;
  lastSessionDate: string;
  lastSessionTimestamp: number;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function DashboardPage() {
  const supabase = getSupabaseServerClient();
  let sessions: SessionRecord[] = [];
  let errorMessage = "";

  if (supabase) {
    const { data, error } = await supabase
      .from("speaking_sessions")
      .select("user_id, band_score, cefr, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      errorMessage = error.message || "Gagal memuat data dashboard.";
    } else {
      sessions = Array.isArray(data) ? (data as SessionRecord[]) : [];
    }
  } else {
    errorMessage = "Supabase belum dikonfigurasi.";
  }

  const usersMap = new Map<string, UserSummary>();
  const bandValues: number[] = [];

  for (const session of sessions) {
    const userId = String(session.user_id || "").trim() || "unknown";
    const bandScore = Number(session.band_score || 0);
    const cefr = String(session.cefr || "-");
    const createdAt = session.created_at || "";
    const timestamp = createdAt ? new Date(createdAt).getTime() : 0;

    if (!Number.isNaN(bandScore) && bandScore > 0) {
      bandValues.push(bandScore);
    }

    const previous = usersMap.get(userId);
    if (!previous) {
      usersMap.set(userId, {
        userId,
        sessionCount: 1,
        avgBand: bandScore,
        latestBand: bandScore,
        bestBand: bandScore,
        latestCefr: cefr,
        lastSessionDate: formatDate(createdAt),
        lastSessionTimestamp: timestamp,
      });
      continue;
    }

    const updatedCount = previous.sessionCount + 1;
    const totalBand = previous.avgBand * previous.sessionCount + bandScore;
    const newBestBand = Math.max(previous.bestBand, bandScore);
    const latest = timestamp >= previous.lastSessionTimestamp ? bandScore : previous.latestBand;
    const latestCefr = timestamp >= previous.lastSessionTimestamp ? cefr : previous.latestCefr;
    const lastSessionDate = timestamp >= previous.lastSessionTimestamp ? formatDate(createdAt) : previous.lastSessionDate;

    usersMap.set(userId, {
      userId,
      sessionCount: updatedCount,
      avgBand: totalBand / updatedCount,
      latestBand: latest,
      bestBand: newBestBand,
      latestCefr,
      lastSessionDate,
      lastSessionTimestamp: Math.max(previous.lastSessionTimestamp, timestamp),
    });
  }

  const userList = Array.from(usersMap.values()).sort((a, b) => b.lastSessionTimestamp - a.lastSessionTimestamp);
  const totalUsers = userList.length;
  const totalSessions = sessions.length;
  const avgBand = bandValues.length ? bandValues.reduce((sum, score) => sum + score, 0) / bandValues.length : 0;
  const topUser = userList
    .slice()
    .sort((a, b) => b.avgBand - a.avgBand || b.sessionCount - a.sessionCount)[0];

  return (
    <main className="dashboard-shell">
      <section className="dashboard-hero-card dashboard-hero-small">
        <div>
          <p className="status-pill">Dashboard</p>
          <h1 className="dashboard-title">Learning Analytics</h1>
          <p className="dashboard-subtitle">Overview performa pengguna dan progress pembelajaran.</p>
        </div>
      </section>

      <section className="dashboard-panel dashboard-stats-panel">
        <div className="stats-grid">
          <div className="metric-card metric-card-large">
            <div className="metric-header">
              <h3>Total Pengguna</h3>
            </div>
            <p>{totalUsers}</p>
          </div>
          <div className="metric-card metric-card-large">
            <div className="metric-header">
              <h3>Total Sesi</h3>
            </div>
            <p>{totalSessions}</p>
          </div>
          <div className="metric-card metric-card-large">
            <div className="metric-header">
              <h3>Rata-rata Band</h3>
            </div>
            <p>{avgBand.toFixed(1)}</p>
          </div>
          <div className="metric-card metric-card-large">
            <div className="metric-header">
              <h3>Top User</h3>
            </div>
            <p>{topUser?.userId || "-"}</p>
          </div>
        </div>
      </section>

      <section className="dashboard-panel">
        <div className="section-header">
          <div>
            <h2 className="section-title">Daftar Pengguna</h2>
            <p className="section-subtitle">Klik pengguna untuk melihat detail progressnya.</p>
          </div>
        </div>

        {errorMessage ? (
          <div className="metric-card">
            <p className="error-text">{errorMessage}</p>
          </div>
        ) : (
          <div className="users-table advanced">
            <div className="table-header">
              <span>User ID</span>
              <span>Sesi</span>
              <span>Rata-rata</span>
              <span>Terakhir</span>
              <span>Terbaik</span>
              <span>Tanggal Update</span>
            </div>
            {userList.length === 0 ? (
              <div className="table-row">
                <span className="cell-user-id">Tidak ada data sesi.</span>
              </div>
            ) : (
              userList.map((user) => (
                <div key={user.userId} className="table-row">
                  <span className="cell-user-id">
                    <span className="user-badge">{user.userId}</span>
                  </span>
                  <span className="cell-sessions">{user.sessionCount}</span>
                  <span className="cell-avg">{user.avgBand.toFixed(1)}</span>
                  <span className="cell-latest">{user.latestBand.toFixed(1)}</span>
                  <span className="cell-best">{user.bestBand.toFixed(1)}</span>
                  <span className="cell-date">{user.lastSessionDate}</span>
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </main>
  );
}