"use client";

import { FormEvent, useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type HistorySession = {
  id: string;
  mode: string;
  domain: string;
  topic_label: string;
  band_score: number;
  cefr: string;
  answers_count: number;
  created_at: string;
};

type HistoryResponse = {
  sessions: HistorySession[];
  message?: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function buildTrendRows(sessions: HistorySession[]) {
  const rows = sessions
    .slice(0, 8)
    .reverse()
    .map((session, index) => ({
      label: `${formatDate(session.created_at)}`,
      value: Number(session.band_score || 0),
      id: `${session.id}-${index}`,
    }));

  const values = rows.map((row) => row.value);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 0);
  const range = Math.max(0.5, maxValue - minValue);

  return rows.map((row) => ({
    ...row,
    height: Math.round(30 + ((row.value - minValue) / range) * 60),
  }));
}

function ProgressPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialUserId = searchParams.get("userId") || "";

  const [userId, setUserId] = useState(initialUserId);
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (initialUserId.trim()) {
      setUserId(initialUserId);
      loadUserDetail(initialUserId);
    }
  }, [initialUserId]);

  const stats = useMemo(() => {
    if (!sessions.length) {
      return {
        sessionCount: 0,
        avgBand: 0,
        latestBand: 0,
        latestCefr: "-",
        bestBand: 0,
        lastSessionDate: "-",
      };
    }

    const bandValues = sessions.map((item) => Number(item.band_score || 0));
    const sorted = [...bandValues].sort((a, b) => b - a);
    return {
      sessionCount: sessions.length,
      avgBand: bandValues.reduce((sum, value) => sum + value, 0) / sessions.length,
      latestBand: Number(sessions[0].band_score || 0),
      latestCefr: sessions[0].cefr || "-",
      bestBand: sorted[0] || 0,
      lastSessionDate: formatDate(sessions[0].created_at),
    };
  }, [sessions]);

  const trendRows = useMemo(() => buildTrendRows(sessions), [sessions]);

  const loadUserDetail = async (targetUserId: string) => {
    const trimmedUserId = targetUserId.trim();
    if (!trimmedUserId) {
      setError("User ID tidak valid.");
      setHasLoaded(true);
      setSessions([]);
      return;
    }

    setError("");
    setLoading(true);

    try {
      const response = await fetch(`/api/history?userId=${encodeURIComponent(trimmedUserId)}`);
      const data = (await response.json()) as HistoryResponse;

      if (!response.ok) {
        setError(data.message || "Terjadi masalah saat memuat progress.");
        setSessions([]);
      } else {
        setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      }
    } catch (err) {
      console.error("Error loading progress:", err);
      setError("Tidak dapat terhubung ke server. Coba lagi nanti.");
      setSessions([]);
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = userId.trim();
    if (!trimmed) {
      setError("User ID tidak valid.");
      return;
    }

    router.push(`/progress?userId=${encodeURIComponent(trimmed)}`);
    await loadUserDetail(trimmed);
  };

  return (
    <main className="dashboard-shell">
      <section className="dashboard-hero-card">
        <div>
          <p className="status-pill">Progress</p>
          <h1 className="dashboard-title">Progress Detail Pengguna</h1>
          <p className="dashboard-subtitle">Cari user dan lihat rangkuman sesi, skor band, dan detail latihan.</p>
        </div>
      </section>

      <section className="dashboard-panel">
        <div className="user-input-section">
          <div className="page-title-row">
            <div>
              <p className="status-pill">User Detail</p>
              <h1 className="page-title">Lihat Progress yang Lebih Dalam</h1>
              <p className="page-subtitle">Masukkan ID pengguna untuk menampilkan riwayat dan metrik.</p>
            </div>
          </div>

          <form className="button-row" onSubmit={handleSubmit}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <label className="field-label" htmlFor="userDetailInput">
                User ID
              </label>
              <input
                id="userDetailInput"
                className="input"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="misal: alvin"
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Memuat..." : "Cari Progress"}
            </button>
          </form>

          {hasLoaded && !loading && sessions.length === 0 && !error && (
            <p className="muted tiny-note">Belum ada sesi untuk user "{userId}".</p>
          )}
          {error ? <p className="error-text">{error}</p> : null}
        </div>

        {sessions.length > 0 && (
          <>
            <div className="stats-grid">
              <div className="metric-card">
                <h3>Total sesi</h3>
                <p>{stats.sessionCount}</p>
              </div>
              <div className="metric-card">
                <h3>Rata-rata band</h3>
                <p>{stats.avgBand.toFixed(1)}</p>
              </div>
              <div className="metric-card">
                <h3>Band terakhir</h3>
                <p>{stats.latestBand.toFixed(1)}</p>
              </div>
              <div className="metric-card">
                <h3>CEFR terakhir</h3>
                <p>{stats.latestCefr}</p>
              </div>
              <div className="metric-card">
                <h3>Band terbaik</h3>
                <p>{stats.bestBand.toFixed(1)}</p>
              </div>
              <div className="metric-card">
                <h3>Tanggal sesi terakhir</h3>
                <p>{stats.lastSessionDate}</p>
              </div>
            </div>

            <div className="panel dashboard-trend">
              <div className="page-title-row">
                <div>
                  <h2 className="page-title">Trend band</h2>
                  <p className="muted tiny-note">Visualisasi progress band dari waktu ke waktu.</p>
                </div>
              </div>
              <div className="trend-bar-grid">
                {trendRows.map((point) => (
                  <div key={point.id} className="trend-bar" title={`${point.label}: ${point.value.toFixed(1)}`}>
                    <div
                      className="trend-bar-inner"
                      style={{ height: `${point.height}%` }}
                    >
                      {point.value.toFixed(1)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="page-title-row">
                <div>
                  <h2 className="page-title">Hasil Sesi</h2>
                  <p className="muted tiny-note">Detail hasil dari setiap sesi latihan pengguna.</p>
                </div>
              </div>
              <div className="sessions-list">
                {sessions.map((session, idx) => (
                  <div key={session.id} className="session-item">
                    <div className="session-header">
                      <div className="session-number">Sesi {sessions.length - idx}</div>
                      <div className="session-meta">
                        <span className="session-date">{formatDate(session.created_at)}</span>
                        <span className="session-mode">{session.mode}</span>
                      </div>
                    </div>
                    <div className="session-details">
                      <div className="detail-row">
                        <span className="detail-label">Domain:</span>
                        <span className="detail-value">{session.domain}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Topik:</span>
                        <span className="detail-value">{session.topic_label}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Band Score:</span>
                        <span className="detail-value band-badge">{session.band_score.toFixed(1)}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">CEFR Level:</span>
                        <span className="detail-value">{session.cefr}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Jumlah Jawaban:</span>
                        <span className="detail-value">{session.answers_count}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default function ProgressPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ProgressPageContent />
    </Suspense>
  );
}
