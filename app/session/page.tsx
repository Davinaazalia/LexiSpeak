"use client";

import { FormEvent, useState } from "react";

type ChatRow = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function SessionPage() {
  const [messages, setMessages] = useState<ChatRow[]>([
    {
      id: createId(),
      role: "assistant",
      text: "Halo! Saya LexiSpeak Coach. Ceritakan tujuan latihan Anda hari ini.",
    },
  ]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    const nextMessage: ChatRow = {
      id: createId(),
      role: "user",
      text: trimmed,
    };

    setMessages((prev) => [...prev, nextMessage]);
    setPrompt("");
    setSending(true);

    window.setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "assistant",
          text: `Terima kasih! Saya sudah menerima pesan Anda: "${trimmed}". Silakan lanjutkan dengan pertanyaan atau latihan lain.`,
        },
      ]);
      setSending(false);
    }, 700);
  };

  return (
    <main className="dashboard-shell">
      <section className="dashboard-hero-card">
        <div>
          <p className="status-pill">Session</p>
          <h1 className="dashboard-title">Chatbot Latihan</h1>
          <p className="dashboard-subtitle">Gunakan chat untuk latihan percakapan dan dukungan sesi secara real-time.</p>
        </div>
      </section>

      <section className="panel dashboard-nav-panel">
        <div className="section-header">
          <div>
            <h2 className="section-title">Chat Session</h2>
            <p className="section-subtitle">Mudah digunakan di halaman Session untuk percakapan interaktif.</p>
          </div>
        </div>
      </section>

      <section className="dashboard-panel">
        <div className="panel chat-main">
          <div className="chat-main-head">
            <div className="page-title-row">
              <div>
                <h2 className="page-title">LexiSpeak Chatbox</h2>
                <p className="muted">Tanyakan soal latihan, minta saran band score, atau diskusikan progress pengguna.</p>
              </div>
            </div>
          </div>

            {messages.map((message) => (
              <div key={message.id} className={`chat-bubble ${message.role === "user" ? "from-user" : "from-assistant"} chat-reveal`}>
                <div className="chat-meta">
                  <span className={`chat-avatar ${message.role === "user" ? "chat-avatar-user" : ""}`}>{message.role === "user" ? "U" : "A"}</span>
                  <span className="chat-author">{message.role === "user" ? "Anda" : "LexiSpeak"}</span>
                </div>
                <p>{message.text}</p>
              </div>
            ))}

          <form className="chat-composer" onSubmit={handleSend}>
            <label className="field-label" htmlFor="sessionMessage">
              Kirim pesan ke chatbot
            </label>
            <textarea
              id="sessionMessage"
              className="textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Tulis pesan Anda..."
            />
            <div className="composer-actions">
              <button type="submit" className="btn-primary" disabled={sending || !prompt.trim()}>
                {sending ? "Mengirim..." : "Kirim"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setPrompt("")}
                disabled={sending}
              >
                Hapus
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
