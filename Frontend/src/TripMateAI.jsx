import { useState, useRef, useEffect } from "react";

const API_BASE = "http://127.0.0.1:8000";
// const API_BASE = "https://ai-tenerary-v3.onrender.com";
const STORAGE_KEY = "aitinerary_searches";
const MAX_SEARCHES = 10;

const AGENTS = [
  { id: "weather",   label: "Weather",   icon: "🌤️" },
  { id: "flight",    label: "Flights",   icon: "✈️" },
  { id: "itinerary", label: "Itinerary", icon: "🗺️" },
  { id: "transport", label: "Transport", icon: "🚌" },
  { id: "hotel",     label: "Hotels",    icon: "🏨" },
  { id: "final",     label: "Final Plan",icon: "📋" },
];

// ── markdown renderer ─────────────────────────────────────────────────────────
function md(text) {
  if (!text) return "";
  text = String(text);
  return text
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
    .replace(/\n/g, "<br/>");
}

// ── localStorage helpers ──────────────────────────────────────────────────────
function loadSearches() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch { return []; }
}

function saveSearch(query, result) {
  try {
    const searches = loadSearches();
    const entry = {
      id: Date.now(),
      query,
      date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      result: {
        answer:          (result.answer        || "").slice(0, 3000),
        weather_results: (result.weather_results|| "").slice(0, 500),
        flight_results:  (result.flight_results || "").slice(0, 1000),
        hotel_results:   (result.hotel_results  || "").slice(0, 1000),
        itinerary:       (result.itinerary      || "").slice(0, 3000),
        images:          (result.images         || []).slice(0, 6),
        llm_calls:       result.llm_calls       || 0,
        thread_id:       result.thread_id       || "",
      }
    };
    const filtered = searches.filter(s => s.query.toLowerCase() !== query.toLowerCase());
    const updated = [entry, ...filtered].slice(0, MAX_SEARCHES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.warn("saveSearch failed:", e);
    return loadSearches();
  }
}


function deleteSearch(id) {
  try {
    const updated = loadSearches().filter(s => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch { return []; }
}

// ── PDF export ────────────────────────────────────────────────────────────────
function exportPDF(result, query) {
  const win = window.open("", "_blank");
  if (!win) { alert("Please allow popups for PDF export."); return; }

  const imageRows = (result.images || [])
    .filter(img => img.url || img.image_url)
    .slice(0, 6)
    .map(img => `
      <div style="display:inline-block;margin:6px;text-align:center;vertical-align:top">
        <img src="${img.url || img.image_url}"
             style="width:160px;height:110px;object-fit:cover;border-radius:8px;border:1px solid #ddd"
             onerror="this.style.display='none'" />
        <div style="font-size:11px;color:#666;margin-top:4px;max-width:160px">${img.title || img.place || ""}</div>
      </div>
    `).join("");

  const content = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8"/>
      <title>AI-tinerary — ${query}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', sans-serif; color: #1a1a1a; padding: 40px; max-width: 900px; margin: auto; }
        h1 { font-size: 26px; color: #0284C7; border-bottom: 2px solid #0EA5E9; padding-bottom: 10px; margin-bottom: 6px; }
        .meta { font-size: 12px; color: #888; margin-bottom: 24px; }
        h2 { font-size: 18px; color: #0284C7; margin: 24px 0 8px; border-left: 4px solid #0EA5E9; padding-left: 10px; }
        h3 { font-size: 15px; color: #F59E0B; margin: 16px 0 6px; }
        p, li { font-size: 13px; line-height: 1.8; color: #333; }
        ul { padding-left: 20px; margin: 6px 0; }
        strong { color: #111; }
        .section { margin-bottom: 28px; padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
        .images { margin-bottom: 24px; }
        .images-title { font-size: 15px; font-weight: 600; color: #555; margin-bottom: 10px; }
        .weather-box { background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 14px; margin-bottom: 20px; font-size: 13px; white-space: pre-line; }
        .footer { margin-top: 40px; font-size: 11px; color: #aaa; text-align: center; border-top: 1px solid #eee; padding-top: 16px; }
        @media print {
          body { padding: 20px; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <h1>🌍 AI-tinerary Travel Plan</h1>
      <div class="meta">Query: <strong>${query}</strong> &nbsp;|&nbsp; Generated: ${new Date().toLocaleString("en-IN")}</div>

      ${result.weather_results ? `
      <div class="weather-box">
        <strong>🌤️ Weather</strong><br/><br/>
        ${result.weather_results.replace(/\n/g, "<br/>")}
      </div>` : ""}

      ${imageRows ? `
      <div class="images">
        <div class="images-title">📸 Places</div>
        ${imageRows}
      </div>` : ""}

      <div class="section">
        <h2>📋 Full Travel Plan</h2>
        ${md(result.answer)}
      </div>

      ${result.flight_results ? `
      <div class="section">
        <h2>✈️ Flights</h2>
        ${md(result.flight_results)}
      </div>` : ""}

      ${result.hotel_results ? `
      <div class="section">
        <h2>🏨 Hotels</h2>
        ${md(result.hotel_results)}
      </div>` : ""}

      ${result.itinerary ? `
      <div class="section">
        <h2>🗺️ Itinerary</h2>
        ${md(result.itinerary)}
      </div>` : ""}

      <div class="footer">
        Generated by AI-tinerary &nbsp;|&nbsp; LangGraph Multi-Agent Travel Planner &nbsp;|&nbsp; ⚡ ${result.llm_calls} LLM calls
      </div>

      <script>
        window.onload = function() { window.print(); }
      </script>
    </body>
    </html>
  `;
  win.document.write(content);
  win.document.close();
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ img, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={styles.lightboxOverlay}>
      <div onClick={e => e.stopPropagation()} style={styles.lightboxBox}>
        <button onClick={onClose} style={styles.lightboxClose}>✕</button>
        <img
          src={img.url || img.image_url}
          alt={img.title || img.place || ""}
          style={styles.lightboxImg}
        />
        {(img.title || img.place) && (
          <div style={styles.lightboxCaption}>{img.title || img.place}</div>
        )}
      </div>
    </div>
  );
}

// ── Recent Searches sidebar ───────────────────────────────────────────────────
function RecentSearches({ searches, onSelect, onDelete, onClearAll }) {
  if (searches.length === 0) return (
    <div style={styles.recentEmpty}>
      <span style={{ fontSize: 32 }}>🔍</span>
      <p style={{ color: "#475569", fontSize: 12, marginTop: 8, textAlign: "center" }}>
        Your recent searches will appear here
      </p>
    </div>
  );

  return (
    <div style={styles.recentList}>
      <div style={styles.recentHeader}>
        <span style={styles.recentTitle}>Recent Searches</span>
        <button onClick={onClearAll} style={styles.clearAllBtn}>Clear all</button>
      </div>
      {searches.map(s => (
        <div key={s.id} style={styles.recentItem}>
          <div onClick={() => onSelect(s)} style={styles.recentItemMain}>
            <div style={styles.recentQuery}>✈️ {s.query}</div>
            <div style={styles.recentDate}>{s.date} · {s.time}</div>
          </div>
          <button
            onClick={() => onDelete(s.id)}
            style={styles.recentDeleteBtn}
            title="Remove"
          >✕</button>
        </div>
      ))}
    </div>
  );
}

// ── AgentPipeline ─────────────────────────────────────────────────────────────
function AgentPipeline({ activeAgent, done }) {
  return (
    <div style={styles.pipeline}>
      {AGENTS.map((a, i) => {
        const isDone   = done.includes(a.id);
        const isActive = activeAgent === a.id;
        return (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{
              ...styles.agentDot,
              background: isDone ? "#0EA5E9" : isActive ? "#F59E0B" : "#1E293B",
              boxShadow: isActive ? "0 0 12px #F59E0B" : isDone ? "0 0 8px #0EA5E9" : "none",
              transform: isActive ? "scale(1.15)" : "scale(1)",
            }}>
              <span style={{ fontSize: 14 }}>{a.icon}</span>
              <span style={styles.agentLabel}>{a.label}</span>
              {isActive && <span style={styles.spinner} />}
            </div>
            {i < AGENTS.length - 1 && (
              <div style={{ ...styles.connector, background: isDone ? "#0EA5E9" : "#1E293B" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── ResultTabs ────────────────────────────────────────────────────────────────
function ResultTabs({ result, onExportPDF, query }) {
  const [tab, setTab] = useState("plan");
  const tabs = [
    { id: "plan",      label: "📋 Full Plan" },
    { id: "weather",   label: "🌤️ Weather" },
    { id: "flights",   label: "✈️ Flights" },
    { id: "hotels",    label: "🏨 Hotels" },
    { id: "itinerary", label: "🗺️ Itinerary" },
  ];
  const content = {
    plan:      result.answer,
    weather:   result.weather_results,
    flights:   result.flight_results,
    hotels:    result.hotel_results,
    itinerary: result.itinerary,
  }[tab] || "No data available.";

  return (
    <div style={styles.resultBox}>
      <div style={styles.tabRow}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ ...styles.tab, ...(tab === t.id ? styles.tabActive : {}) }}>
            {t.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => onExportPDF(result, query)} style={styles.pdfBtn}>
            📄 Export PDF
          </button>
          <span style={styles.llmBadge}>⚡ {result.llm_calls} LLM calls</span>
        </div>
      </div>
      <div style={styles.resultContent} dangerouslySetInnerHTML={{ __html: md(content) }} />
    </div>
  );
}

// ── ImageGallery ──────────────────────────────────────────────────────────────
function ImageGallery({ images = [], onImageClick }) {
  if (!images || images.length === 0) return null;
  const validImages = images.filter(img => img.url || img.image_url);
  if (validImages.length === 0) return null;

  return (
    <div style={styles.gallery}>
      <p style={styles.galleryTitle}>📸 Places ({validImages.length}) — click to enlarge</p>
      <div style={styles.galleryGrid}>
        {validImages.map((img, i) => (
          <div key={i} style={styles.galleryItem} onClick={() => onImageClick(img)}
            title="Click to enlarge">
            <img
              src={img.url || img.image_url}
              alt={img.title || img.place || "place"}
              style={{ ...styles.galleryImg, cursor: "zoom-in" }}
              onError={e => { e.target.style.display = "none"; }}
            />
            <span style={styles.galleryCaption}>{img.title || img.place || ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── WeatherCard ───────────────────────────────────────────────────────────────
function WeatherCard({ weather }) {
  if (!weather) return null;
  return (
    <div style={styles.weatherCard}>
      <span style={{ fontSize: 20 }}>🌤️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.weatherTitle}>Current Weather</div>
        <div style={styles.weatherText}>{weather.slice(0, 200)}…</div>
      </div>
    </div>
  );
}

// ── ChatBubble ────────────────────────────────────────────────────────────────
function ChatBubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 12 }}>
      {!isUser && <span style={styles.avatar}>🌍</span>}
      <div style={{ ...styles.bubble, ...(isUser ? styles.bubbleUser : styles.bubbleBot) }}>
        {msg.content}
      </div>
      {isUser && <span style={styles.avatar}>🧑</span>}
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function TripMateAI() {
  const [messages, setMessages]       = useState([
    { role: "bot", content: "Hey! 👋 I'm AI-tinerary — tell me where you want to go and I'll handle weather, flights, hotels, and a full itinerary for you." }
  ]);
  const [input, setInput]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [threadId, setThreadId]       = useState(null);
  const [activeAgent, setActiveAgent] = useState(null);
  const [doneAgents, setDoneAgents]   = useState([]);
  const [result, setResult]           = useState(null);
  const [currentQuery, setCurrentQuery] = useState("");
  const [error, setError]             = useState(null);
  const [lightboxImg, setLightboxImg] = useState(null);
  const [searches, setSearches]       = useState(() => loadSearches());
  const [showRecent, setShowRecent]   = useState(false);
  const bottomRef                     = useRef(null);
  const timersRef                     = useRef([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    fetch(`${API_BASE}/health`).catch(() => {});
  }, []);

  function simulatePipeline() {
    const sequence = [
      { agent: "weather",   delay: 0 },
      { agent: "flight",    delay: 0 },
      { agent: "itinerary", delay: 5000 },
      { agent: "transport", delay: 25000 },
      { agent: "hotel",     delay: 33000 },
      { agent: "final",     delay: 40000 },
    ];
    const done = [];
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    sequence.forEach(({ agent, delay }, i) => {
      const t = setTimeout(() => {
        setActiveAgent(agent);
        if (i > 0) { done.push(sequence[i - 1].agent); setDoneAgents([...done]); }
      }, delay);
      timersRef.current.push(t);
    });
  }

  function clearAllTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  async function sendMessage(overrideText) {
    const text = (overrideText || input).trim();
    if (!text || loading) return;

    setInput("");
    setError(null);
    setResult(null);
    setCurrentQuery(text);
    setActiveAgent(null);
    setDoneAgents([]);
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setShowRecent(false);

    simulatePipeline();

    try {
      const res = await fetch(`${API_BASE}/api/travel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, thread_id: overrideText ? null : threadId }),
      });
      const data = await res.json();
      clearAllTimers();

      if (!data.success) throw new Error(data.error || "Something went wrong.");

      setThreadId(data.thread_id);
      setActiveAgent(null);
      setDoneAgents(AGENTS.map(a => a.id));
      setResult(data);

      // ✅ Save to recent searches
      const updated = saveSearch(text, data);
      setSearches(updated);

      setMessages(prev => [...prev, {
        role: "bot",
        content: "✅ Your travel plan is ready! Check the results panel →"
      }]);
    } catch (err) {
      clearAllTimers();
      setActiveAgent(null);
      setError(err.message);
      setMessages(prev => [...prev, { role: "bot", content: `❌ Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function reset() {
    clearAllTimers();
    setMessages([{ role: "bot", content: "Hey! 👋 Tell me where you want to go next!" }]);
    setThreadId(null); setResult(null); setCurrentQuery("");
    setActiveAgent(null); setDoneAgents([]); setError(null);
  }

  // load a past search result
  function handleSelectSearch(s) {
    setResult(s.result);
    setCurrentQuery(s.query);
    setShowRecent(false);
    setMessages([
      { role: "bot", content: "Hey! 👋 I'm AI-tinerary — tell me where you want to go!" },
      { role: "user", content: s.query },
      { role: "bot", content: "✅ Loaded from recent searches! Check the results panel →" },
    ]);
  }

  function handleDeleteSearch(id) {
    setSearches(deleteSearch(id));
  }

  function handleClearAll() {
    localStorage.removeItem(STORAGE_KEY);
    setSearches([]);
  }

  return (
    <div style={styles.root}>
      {/* ── lightbox ── */}
      {lightboxImg && (
        <Lightbox img={lightboxImg} onClose={() => setLightboxImg(null)} />
      )}

      {/* ── left: chat panel ── */}
      <div style={styles.chatPanel}>

        {/* header */}
        <div style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={styles.logo}>🌍</span>
            <div>
              <div style={styles.headerTitle}>AI-tinerary</div>
              <div style={styles.headerSub}>LangGraph Multi-Agent Travel Planner</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setShowRecent(v => !v)}
              style={{ ...styles.resetBtn, position: "relative" }}
              title="Recent searches"
            >
              🕐 History
              {searches.length > 0 && (
                <span style={styles.badge}>{searches.length}</span>
              )}
            </button>
            <button onClick={reset} style={styles.resetBtn}>＋ New</button>
          </div>
        </div>

        {/* recent searches dropdown */}
        {showRecent && (
          <div style={styles.recentPanel}>
            <RecentSearches
              searches={searches}
              onSelect={handleSelectSearch}
              onDelete={handleDeleteSearch}
              onClearAll={handleClearAll}
            />
          </div>
        )}

        {/* agent pipeline */}
        {loading && (
          <div style={styles.pipelineWrap}>
            <AgentPipeline activeAgent={activeAgent} done={doneAgents} />
          </div>
        )}

        {/* messages */}
        <div style={styles.messages}>
          {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
          {loading && (
            <div style={{ display: "flex", gap: 6, paddingLeft: 40, alignItems: "center" }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{ ...styles.dot, animationDelay: `${i * 0.2}s` }} />
              ))}
              <span style={{ color: "#64748B", fontSize: 13, marginLeft: 4 }}>Agents working…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* input */}
        <div style={styles.inputRow}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="e.g. Plan a 5-day trip from Kolkata to Manali under ₹30,000…"
            rows={2}
            disabled={loading}
            style={styles.textarea}
          />
          <button onClick={() => sendMessage()} disabled={loading || !input.trim()} style={styles.sendBtn}>
            {loading ? "⏳" : "➤"}
          </button>
        </div>
        {threadId && <div style={styles.threadTag}>🔗 Thread: {threadId.slice(0, 20)}…</div>}
      </div>

      {/* ── right: results panel ── */}
      <div style={styles.resultsPanel}>
        {!result && !loading && (
          <div style={styles.emptyResults}>
            <span style={{ fontSize: 64 }}>✈️</span>
            <p style={{ color: "#475569", marginTop: 16, fontSize: 15 }}>
              Your full travel plan will appear here.
            </p>
            <div style={styles.exampleChips}>
              {["5 days in Goa under ₹20k", "Weekend Delhi to Shimla", "10 days Europe backpacking"].map(ex => (
                <button key={ex} style={styles.chip} onClick={() => sendMessage(ex)}>{ex}</button>
              ))}
            </div>
            {searches.length > 0 && (
              <div style={{ marginTop: 24, width: "100%", maxWidth: 420 }}>
                <div style={{ color: "#475569", fontSize: 12, marginBottom: 8, textAlign: "left" }}>
                  🕐 Recent searches:
                </div>
                {searches.slice(0, 4).map(s => (
                  <div key={s.id} onClick={() => handleSelectSearch(s)} style={styles.recentChip}>
                    ✈️ {s.query}
                    <span style={{ color: "#334155", fontSize: 10, marginLeft: "auto" }}>{s.date}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loading && !result && (
          <div style={styles.emptyResults}>
            <span style={{ fontSize: 56 }}>🤖</span>
            <p style={{ color: "#94A3B8", marginTop: 16, fontSize: 15, textAlign: "center" }}>
              AI agents are collaborating…<br />Weather, flights, itinerary, hotels — all being planned.
            </p>
          </div>
        )}

{result && (() => {
  try {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "auto" }}>
        {result.weather_results && <WeatherCard weather={result.weather_results} />}
        <ImageGallery images={result.images || []} onImageClick={setLightboxImg} />
        <ResultTabs result={result} query={currentQuery} onExportPDF={exportPDF} />
      </div>
    );
  } catch(e) {
    return <div style={{color:"#EF4444",padding:20}}>⚠️ Display error: {String(e.message)}</div>;
  }
})()}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0B0F1A; font-family: 'Inter', sans-serif; }
        ul { padding-left: 1.2em; }
        h2 { color: #0EA5E9; font-family: 'Space Grotesk', sans-serif; margin: 12px 0 6px; font-size: 17px; }
        h3 { color: #F59E0B; font-family: 'Space Grotesk', sans-serif; margin: 10px 0 4px; font-size: 15px; }
        strong { color: #E2E8F0; }
        li { margin-bottom: 4px; color: #CBD5E1; }
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1E293B; border-radius: 4px; }
      `}</style>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────
const styles = {
  root: {
    display: "flex", height: "100vh",
    background: "#0B0F1A", fontFamily: "'Inter', sans-serif",
    color: "#E2E8F0", overflow: "hidden",
  },

  // chat
  chatPanel: {
    width: 420, minWidth: 340,
    display: "flex", flexDirection: "column",
    borderRight: "1px solid #1E293B", background: "#0D1424",
    position: "relative",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 20px", borderBottom: "1px solid #1E293B", background: "#0B0F1A",
  },
  logo: { fontSize: 28 },
  headerTitle: {
    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700,
    fontSize: 18, color: "#F0F4FF", letterSpacing: "-0.3px",
  },
  headerSub: { fontSize: 11, color: "#475569", marginTop: 1 },
  resetBtn: {
    background: "transparent", border: "1px solid #1E293B",
    borderRadius: 8, color: "#0EA5E9", fontSize: 12,
    padding: "5px 10px", cursor: "pointer", fontFamily: "'Inter', sans-serif",
    position: "relative",
  },
  badge: {
    position: "absolute", top: -6, right: -6,
    background: "#0EA5E9", color: "#fff",
    borderRadius: "50%", width: 16, height: 16,
    fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 700,
  },

  // recent panel
  recentPanel: {
    borderBottom: "1px solid #1E293B", background: "#0B0F1A",
    maxHeight: 280, overflowY: "auto",
    animation: "fadeIn .2s ease",
  },
  recentList: { padding: "8px 0" },
  recentHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "6px 16px 4px", marginBottom: 4,
  },
  recentTitle: { fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" },
  clearAllBtn: {
    background: "transparent", border: "none",
    color: "#EF4444", fontSize: 11, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  recentItem: {
    display: "flex", alignItems: "center",
    padding: "7px 16px", cursor: "pointer",
    transition: "background .15s",
    gap: 8,
  },
  recentItemMain: { flex: 1, minWidth: 0 },
  recentQuery: {
    fontSize: 13, color: "#CBD5E1",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },
  recentDate: { fontSize: 10, color: "#475569", marginTop: 2 },
  recentDeleteBtn: {
    background: "transparent", border: "none",
    color: "#475569", fontSize: 12, cursor: "pointer",
    padding: "2px 4px", flexShrink: 0,
    fontFamily: "'Inter', sans-serif",
  },
  recentEmpty: {
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "24px 16px",
  },

  pipelineWrap: {
    padding: "10px 16px", borderBottom: "1px solid #1E293B",
    background: "#0B0F1A", overflowX: "auto",
  },
  pipeline: { display: "flex", alignItems: "center", gap: 4, flexWrap: "nowrap" },
  agentDot: {
    display: "flex", alignItems: "center", gap: 5,
    padding: "4px 9px", borderRadius: 20, border: "1px solid #1E293B",
    fontSize: 11, color: "#CBD5E1", transition: "all .4s ease",
    whiteSpace: "nowrap", cursor: "default", userSelect: "none",
  },
  agentLabel: { fontSize: 10, fontWeight: 500 },
  connector: { width: 14, height: 2, borderRadius: 2, flexShrink: 0, transition: "background .4s" },
  spinner: {
    width: 8, height: 8, border: "2px solid transparent",
    borderTop: "2px solid #F59E0B", borderRadius: "50%",
    display: "inline-block", animation: "spin .8s linear infinite",
  },

  messages: {
    flex: 1, overflowY: "auto", padding: "16px",
    display: "flex", flexDirection: "column", gap: 4,
  },
  avatar: { fontSize: 20, margin: "0 6px", alignSelf: "flex-end" },
  bubble: { maxWidth: "78%", padding: "10px 14px", borderRadius: 16, fontSize: 14, lineHeight: 1.55 },
  bubbleUser: { background: "linear-gradient(135deg, #0EA5E9, #0284C7)", color: "#fff", borderBottomRightRadius: 4 },
  bubbleBot: { background: "#1E293B", color: "#CBD5E1", borderBottomLeftRadius: 4 },
  dot: { width: 8, height: 8, borderRadius: "50%", background: "#0EA5E9", animation: "bounce 1.2s infinite", display: "inline-block" },

  inputRow: {
    display: "flex", gap: 8, padding: "12px 16px",
    borderTop: "1px solid #1E293B", alignItems: "flex-end",
  },
  textarea: {
    flex: 1, background: "#1E293B", border: "1px solid #334155",
    borderRadius: 12, color: "#E2E8F0", fontSize: 13,
    padding: "10px 14px", resize: "none", outline: "none",
    fontFamily: "'Inter', sans-serif", lineHeight: 1.5,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 12,
    background: "linear-gradient(135deg, #0EA5E9, #0284C7)",
    border: "none", color: "#fff", fontSize: 18, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  threadTag: { fontSize: 10, color: "#334155", padding: "4px 16px 8px", fontFamily: "monospace" },

  // results
  resultsPanel: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 20 },
  emptyResults: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", color: "#334155", textAlign: "center",
  },
  exampleChips: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20, justifyContent: "center" },
  chip: {
    background: "#1E293B", border: "1px solid #334155", borderRadius: 20,
    color: "#94A3B8", fontSize: 12, padding: "6px 14px", cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  recentChip: {
    display: "flex", alignItems: "center", gap: 8,
    background: "#1E293B", border: "1px solid #1E293B",
    borderRadius: 10, padding: "8px 14px", marginBottom: 6,
    cursor: "pointer", fontSize: 13, color: "#CBD5E1",
    transition: "border-color .2s",
  },

  // weather card
  weatherCard: {
    display: "flex", alignItems: "flex-start", gap: 10,
    background: "#0D1F33", border: "1px solid #0EA5E933",
    borderRadius: 12, padding: "10px 14px", flexShrink: 0,
  },
  weatherTitle: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 12, color: "#0EA5E9", marginBottom: 3 },
  weatherText: { fontSize: 12, color: "#94A3B8", lineHeight: 1.5 },

  // gallery
  gallery: { flexShrink: 0 },
  galleryTitle: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 14, color: "#94A3B8", marginBottom: 8 },
  galleryGrid: { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 },
  galleryItem: {
    flexShrink: 0, width: 130, borderRadius: 10,
    overflow: "hidden", background: "#1E293B",
    transition: "transform .2s, box-shadow .2s",
  },
  galleryImg: { width: 130, height: 90, objectFit: "cover", display: "block" },
  galleryCaption: {
    display: "block", fontSize: 10, color: "#64748B",
    padding: "4px 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },

  // lightbox
  lightboxOverlay: {
    position: "fixed", inset: 0,
    background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, cursor: "pointer",
  },
  lightboxBox: {
    position: "relative", maxWidth: "85vw", maxHeight: "85vh",
    cursor: "default", background: "#0D1424",
    borderRadius: 16, overflow: "hidden",
    border: "1px solid #1E293B",
    boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
  },
  lightboxImg: { display: "block", maxWidth: "85vw", maxHeight: "75vh", objectFit: "contain" },
  lightboxCaption: {
    padding: "10px 16px", fontSize: 14, color: "#94A3B8",
    fontFamily: "'Space Grotesk', sans-serif", textAlign: "center",
    borderTop: "1px solid #1E293B",
  },
  lightboxClose: {
    position: "absolute", top: 10, right: 12,
    background: "#1E293B", border: "1px solid #334155",
    color: "#CBD5E1", borderRadius: 8, width: 30, height: 30,
    cursor: "pointer", fontSize: 14, display: "flex",
    alignItems: "center", justifyContent: "center",
    fontFamily: "'Inter', sans-serif", zIndex: 10,
  },

  // tabs
  resultBox: {
    flex: 1, display: "flex", flexDirection: "column",
    background: "#0D1424", border: "1px solid #1E293B",
    borderRadius: 16, overflow: "hidden", minHeight: 0,
  },
  tabRow: {
    display: "flex", gap: 2, padding: "10px 12px",
    borderBottom: "1px solid #1E293B", alignItems: "center",
    flexWrap: "wrap", background: "#0B0F1A",
  },
  tab: {
    background: "transparent", border: "1px solid transparent",
    borderRadius: 8, color: "#475569", fontSize: 12,
    padding: "5px 10px", cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all .2s",
  },
  tabActive: { background: "#1E293B", border: "1px solid #334155", color: "#0EA5E9", fontWeight: 600 },
  pdfBtn: {
    background: "#1E293B", border: "1px solid #334155",
    borderRadius: 8, color: "#94A3B8", fontSize: 11,
    padding: "4px 10px", cursor: "pointer", fontFamily: "'Inter', sans-serif",
    transition: "all .2s",
  },
  llmBadge: {
    background: "#1E293B", border: "1px solid #F59E0B44",
    borderRadius: 20, color: "#F59E0B", fontSize: 11, padding: "3px 10px",
  },
  resultContent: {
    flex: 1, overflowY: "auto", padding: "16px 20px",
    fontSize: 14, lineHeight: 1.7, color: "#CBD5E1",
  },
};
