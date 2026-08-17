# 🌍 AI-tinerary — LangGraph Multi-Agent Travel Planne

> **Plan your entire trip in one message.** AI-tinerary uses a pipeline of specialized AI agents to research flights, build day-wise itineraries, plan transportation, find hotels, preserve trip history, and deliver a complete travel guide — all automatically.

## 🔗 Live Demo → [AI-tinerary](https://aiiteneraryv2.vercel.app)

---

## 📸 Preview
![Preview](https://github.com/Nilardri2006/AI-tinerary/blob/main/preview.png?raw=true)

```
User: "Plan a 5-day trip from Kolkata to Manali in November under ₹30,000"

AI-tinerary:
  ✈️ Flight Agent     → searches live flight options
  🗺️ Itinerary Agent  → builds day-wise plan + extracts places
  🚌 Transport Agent  → plans local & intercity transport
  🏨 Hotel Agent      → finds best stay locations via Tavily
  📋 Final Agent      → compiles polished travel guide
  📸 Image Agent      → fetches Wikipedia photos of every place
```

---

## 🕘 Trip History

AI-tinerary now keeps a persistent history of your travel conversations using thread-based memory.

- 🧾 **Conversation history** — revisit previous travel planning sessions.
- 🔄 **Persistent threads** — each trip can be continued using its `thread_id`.
- 🧠 **Context-aware follow-ups** — continue a trip without starting from scratch.
- 🗂️ **Previous trip access** — keep multiple travel plans available for later reference.
- 🗄️ **PostgreSQL-backed persistence** — trip state is stored through the LangGraph checkpointer.

## 🚀 Why AI-tinerary is Better

| Feature | AI-tinerary | ChatGPT / Gemini | MakeMyTrip / Booking |
|---|---|---|---|
| Multi-agent pipeline | ✅ Specialized agents | ❌ Single LLM | ❌ No AI planning |
| Full itinerary + transport + hotels | ✅ All-in-one | ⚠️ Manual prompting | ⚠️ Separate searches |
| Persistent memory (PostgreSQL) | ✅ Remembers your trip | ❌ Session only | ❌ No context |
| Trip history | ✅ Revisit previous trips | ❌ Limited | ⚠️ Account/order based |
| Place images (Wikipedia) | ✅ Auto-fetched | ❌ No images | ✅ Manual listings |
| Live web search (Tavily) | ✅ Real-time hotels | ❌ Knowledge cutoff | ✅ Live listings |
| Open source & self-hostable | ✅ Full control | ❌ Closed API | ❌ Closed platform |
| Budget-aware planning | ✅ Budget in prompt | ⚠️ Inconsistent | ❌ No planning |
| Free to run (Groq LLM) | ✅ Fast + free tier | ❌ Paid | ❌ Commission-based |

---

## 🏗️ Architecture

```
User Message
     │
     ▼
┌─────────────┐
│ Flight Agent │  → search_flights() tool
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│ Itinerary Agent  │  → Groq LLaMA 3.3 70B (day-wise plan + place extraction)
└──────┬───────────┘
       │
   ┌───┴────┐
   ▼        ▼
┌────────┐ ┌───────────────┐
│ Image  │ │ Transport      │  → Groq LLaMA 3.3 70B
│ Agent  │ │ Agent (mtrn)   │
└───┬────┘ └──────┬────────┘
    │              │
    │         ┌────▼──────┐
    │         │ Hotel      │  → Tavily Search (real-time)
    │         │ Agent      │
    │         └────┬───────┘
    │              │
    └──────┬───────┘
           ▼
    ┌─────────────┐
    │ Final Agent  │  → Groq LLaMA 3.3 70B (complete travel guide)
    └──────┬──────┘
           │
           ▼
    FastAPI Response → React Frontend
```

### Updated Multi-Agent Graph

The current LangGraph workflow includes a dedicated **Weather Agent** and uses parallel branches to gather travel information before the final response is generated.

```text
                         ┌──→ Weather Agent ──────────────┐
                         │                                │
START ──→ Flight Agent ──→ Itinerary Agent                │
                              │                           │
                       ┌──────┴──────┐                    │
                       ↓             ↓                    │
                 Image Agent    Transport Agent           │
                       │             ↓                    │
                       │        Hotel Agent ──────────────┤
                       │                                  │
                       └──────────────┬───────────────────┘
                                      ↓
                                Final Agent
                                      ↓
                                     END
```

**Graph nodes:**
- ✈️ **Flight Agent** — searches flight information.
- 🗺️ **Itinerary Agent** — creates the day-wise itinerary and extracts places.
- 🚌 **Transport Agent** — plans local and intercity transportation.
- 🏨 **Hotel Agent** — finds accommodation using Tavily.
- 📸 **Image Agent** — fetches images for itinerary locations.
- 🌤️ **Weather Agent** — retrieves weather information for the destination.
- 📋 **Final Agent** — combines the gathered information into the final travel guide.

The graph uses parallel execution where appropriate, allowing independent travel data such as weather and the main planning branches to be processed concurrently.

**Tech Stack:**
- 🧠 **LLM:** Groq (LLaMA 3.3 70B) — fast inference, free tier available
- 🔗 **Orchestration:** LangGraph (stateful multi-agent graph)
- 🌐 **Web Search:** Tavily API (real-time hotel search)
- 🗄️ **Memory & History:** PostgreSQL via LangGraph checkpointer (persistent threads and trip history)
- 📸 **Images:** Wikipedia API (free, no key needed)
- ⚡ **Backend:** FastAPI + Uvicorn
- 🎨 **Frontend:** React + Vite

---

## 📁 Project Structure

```
AI-tinerary/
│
├── Backend/
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── flight.py          # Flight search tool
│   │   ├── tavily.py          # Tavily web search
│   │   └── wiki.py            # Wikipedia image fetcher
│   ├── src/
│   ├── static/
│   ├── templates/
│   ├── .dockerignore
│   ├── .env                   # API keys (never commit!)
│   ├── .gitignore
│   ├── app.py                 # FastAPI server
│   ├── backend.py             # LangGraph agent pipeline
│   ├── Dockerfile
│   └── requirements.txt
│
├── Frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   └── TripMateAI.jsx     # Main UI component
│   ├── public/
│   ├── .dockerignore
│   ├── .gitignore
│   ├── Dockerfile
│   ├── index.html
│   ├── nginx.conf
│   ├── package.json
│   └── vite.config.js
│
├── docker-compose.yml
├── preview.png
└── README.md
```

---

## ⚙️ Setup — Local (Manual)

### Prerequisites
- Python 3.10+
- Node.js 18+
- PostgreSQL database (local or [Render](https://render.com) free tier)
- API Keys: [Groq](https://console.groq.com), [Tavily](https://tavily.com)

### 1. Clone the repo
```bash
git clone https://github.com/Nilardri2006/AI-tinerary.git
cd AI-tinerary
```

### 2. Backend setup
```bash
cd Backend

# Create virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Create `.env` file inside `Backend/`
```bash
GROQ_API_KEY=your_groq_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

### 4. Run backend
```bash
python app.py
# Server starts at http://127.0.0.1:8000
```

### 5. Frontend setup (new terminal)
```bash
cd Frontend
npm install
npm run dev
# App opens at http://localhost:5173
```

---

## 🐳 Setup — Docker (Run everything with one command)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed

### 1. Create `.env` in project root
```bash
# .env (next to docker-compose.yml)
GROQ_API_KEY=your_groq_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here
```

### 2. Run everything
```bash
# Start all services (postgres + backend + frontend)
docker compose up --build

# Run in background
docker compose up --build -d

# Stop everything
docker compose down

# Stop and delete database volume too
docker compose down -v
```

### 3. Open in browser

| Service | URL |
|---|---|
| 🎨 Frontend | http://localhost:5173 |
| ⚡ Backend API | http://localhost:8000 |
| 📖 API Docs | http://localhost:8000/docs |

> **Note:** Docker spins up its own local PostgreSQL container.
> To use your existing Render PostgreSQL instead, set `DATABASE_URL` in `.env`
> and remove the `postgres` service from `docker-compose.yml`.

---

## ☁️ Deploy — Render + Vercel (Free)

### Backend → Render Web Service

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Fill in settings:

| Field | Value |
|---|---|
| **Root Directory** | `Backend` |
| **Runtime** | `Python 3` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn app:app --host 0.0.0.0 --port $PORT` |

4. Add environment variables:
```
GROQ_API_KEY      = your_groq_key
TAVILY_API_KEY    = your_tavily_key
DATABASE_URL      = your_render_postgres_url
```

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import your GitHub repo
3. Fill in settings:

| Field | Value |
|---|---|
| **Root Directory** | `Frontend` |
| **Framework Preset** | `Vite` |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |

4. Click **Deploy** → live in 2 minutes ✅

---

## 🔑 Getting API Keys

| Key | Where to get | Free tier |
|---|---|---|
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) | ✅ Yes |
| `TAVILY_API_KEY` | [tavily.com](https://tavily.com) | ✅ 1000 searches/month |
| PostgreSQL | [render.com](https://render.com) | ✅ Free DB |

---

## 🕘 History & Continuing Trips

The travel API uses `thread_id` to persist a trip conversation. Reusing the same `thread_id` allows AI-tinerary to continue the previous travel context instead of creating a completely new session.

```json
{
  "message": "Can you change Day 3 to a beach day?",
  "thread_id": "user_abc123..."
}
```

This makes it possible to build a trip progressively through multiple messages while keeping the previous conversation context available.

## 📡 API Reference

### `POST /api/travel`

**Request:**
```json
{
  "message": "Plan a 5-day trip from Delhi to Goa in December under ₹25,000",
  "thread_id": null
}
```

**Response:**
```json
{
  "success": true,
  "thread_id": "user_abc123...",
  "answer": "## Trip Overview...",
  "flight_results": "Flight options...",
  "hotel_results": "Hotel recommendations...",
  "itinerary": "Day 1: ...",
  "images": [
    {"title": "Baga Beach", "url": "https://upload.wikimedia.org/..."}
  ],
  "llm_calls": 7
}
```

### `GET /health`
Returns `{"status": "ok"}` — use this to verify the backend is alive.

---

## 🤝 Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Commit: `git commit -m "Add your feature"`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

## 👨‍💻 Author

Built with ❤️ using LangGraph, Groq, FastAPI, and React.

**🔗 Live Demo → [AI-tinerary.app](https://aiiteneraryv2.vercel.app)**

> ⭐ Star this repo if AI-tinerary helped you plan a trip!
