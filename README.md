# CollegeRAG — Advanced Academic RAG Platform

> AI-powered academic knowledge assistant for college students

## Quick Start

### 1. Backend
```powershell
cd backend
# Add your LLM API key to .env (GROQ_API_KEY for free tier)
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

### 2. Frontend
```powershell
cd frontend
npm run dev
```

Open **http://localhost:5173** — register and start chatting with your documents!

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

## Features

| Feature | Status |
|---------|--------|
| PDF/DOCX/PPTX/TXT/MD parsing | ✅ |
| OCR for scanned images | ✅ (requires Tesseract) |
| Semantic vector search (ChromaDB) | ✅ |
| BM25 keyword search | ✅ |
| Hybrid RRF fusion | ✅ |
| Cohere reranking | ✅ (optional) |
| Multi-mode answers (strict/tutor/exam/revision) | ✅ |
| Source citations with page numbers | ✅ |
| Confidence scoring | ✅ |
| Course organization | ✅ |
| Flashcard generation | ✅ |
| Quiz generation | ✅ |
| Summary generation | ✅ |
| Formula sheet extraction | ✅ |
| Chat history | ✅ |
| Conversation bookmarks | ✅ |
| Follow-up question suggestions | ✅ |
| JWT authentication | ✅ |
| Duplicate document detection | ✅ |

## API Docs
Visit `http://localhost:8000/docs` for full Swagger UI.
