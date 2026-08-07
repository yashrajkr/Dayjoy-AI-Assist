import os
import sys
from pathlib import Path

# Repo root (two levels up: backend/tests/conftest.py -> backend/ -> repo root)
# so `import backend.main` resolves regardless of the invocation cwd.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# backend/main.py prints a config report at import time via
# `config.print_config_report()`, which just warns on missing vars — but
# set a harmless SUPABASE_URL so any accidental JWKS URL construction
# doesn't blow up on an empty string.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("GROQ_API_KEY", "")
os.environ.setdefault("OPENAI_API_KEY", "")
