"""Tool wrappers — each module here is a thin, dynamically-dispatched wrapper
around an existing function elsewhere in the codebase (backend.main,
backend.rag, backend.search_providers). None of these reimplement retrieval,
RAG, or search logic.

Wrappers import `backend.main` lazily, inside the function body, and call
through the module object (`backend_main.retrieve_context(...)`) rather than
`from backend.main import retrieve_context` — this is required, not just a
style preference: backend/tests/test_router.py monkeypatches
`backend_main.retrieve_context` / `backend_main.web_search_multi` per test
case, and a name-bound import would silently stop seeing those patches.
"""
