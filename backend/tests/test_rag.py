"""Tests for RAG pipeline components."""


class TestChunker:
    def test_chunk_document_single_page(self):
        from app.ingestion.chunker import chunk_document
        pages = [{"page_num": 1, "text": "Hello world. " * 50, "tables": []}]
        chunks = chunk_document(pages, chunk_size=100, chunk_overlap=20)
        assert len(chunks) > 1
        assert all(len(c.content) <= 140 for c in chunks)

    def test_chunk_document_short(self):
        from app.ingestion.chunker import chunk_document
        text = "Hello world. This is a test paragraph that has enough characters to pass the minimum length filter."
        pages = [{"page_num": 1, "text": text, "tables": []}]
        chunks = chunk_document(pages, chunk_size=1000, chunk_overlap=20)
        assert len(chunks) == 1
        assert "Hello world" in chunks[0].content

    def test_chunk_document_empty(self):
        from app.ingestion.chunker import chunk_document
        assert chunk_document([], chunk_size=100, chunk_overlap=20) == []
        assert chunk_document([{"page_num": 1, "text": "   ", "tables": []}], chunk_size=100, chunk_overlap=20) == []

    def test_chunk_document_with_table(self):
        from app.ingestion.chunker import chunk_document
        pages = [{"page_num": 1, "text": "Some text.", "tables": [["a", "b"], ["1", "2"]]}]
        chunks = chunk_document(pages)
        assert any(c.chunk_type == "table" for c in chunks)
