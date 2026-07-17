# CollegeRAG — Advanced Academic RAG Platform

> AI-powered academic knowledge assistant for college students

## Quick Start

**Development (no Docker):**

```powershell
# Terminal 1 — Backend
cd backend
python -m uvicorn app.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Open `http://localhost:5173`

**Production (Docker):**

```powershell
docker compose up --build
```

Opens at `http://localhost` (nginx → frontend, `/api` → backend).

**Testing:**

```powershell
cd backend
python -m pytest tests/ -v
```

**API docs** at `http://localhost:8000/docs`
---

## Architecture

```
CollegeRAG/
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI app entry
│   │   ├── core/               # Config, logging
│   │   ├── db/                 # SQLAlchemy async engine
│   │   ├── models/             # User, Document, Chunk, Course, Conversation
│   │   ├── auth/               # JWT + bcrypt security
│   │   ├── ingestion/          # Parser → Chunker → Pipeline
│   │   ├── embeddings/         # ChromaDB vector store
│   │   ├── retrieval/          # Hybrid BM25 + semantic search
│   │   ├── generation/         # Multi-LLM response generator
│   │   ├── rag/                # RAG orchestrator pipeline
│   │   └── api/v1/endpoints/   # REST endpoints
│   └── .env                    # Configuration
└── frontend/
    ├── src/
    │   ├── pages/              # Login, Register, Documents, Courses, StudyTools
    │   ├── components/         # ChatLayout (integrated sidebar+chat), AppLayout
    │   │   └── shared/         # Toast, Skeleton, AnimatedPage, GlassCard, etc.
    │   ├── hooks/              # useMediaQuery, useDebounce
    │   ├── store/              # Zustand stores (auth, chat, courses, documents)
    │   └── api/                # Axios client + endpoint functions
    └── index.html
```

## Setting Up LLM

Edit `backend/.env` and set **one** of:

| Provider | Key | Free? |
|----------|-----|-------|
| Groq | `GROQ_API_KEY` | ✅ Free |
| OpenAI | `OPENAI_API_KEY` | 💳 Paid |
| Anthropic | `ANTHROPIC_API_KEY` | 💳 Paid |
| Google | `GOOGLE_API_KEY` | ✅ Free tier |

```env
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
```

Login with <admin@collegerag.com> / admin123 returns role: admin.
