"""
Dayjoy AI Assist — Configuration validation at startup.

Validates that all required environment variables are present.
Raises a clear error listing all missing variables before the app starts.
"""

import os
import sys
from typing import Dict, List, Tuple

# Required variables grouped by category
REQUIRED_VARS: Dict[str, List[Tuple[str, str]]] = {
    "Supabase": [
        ("SUPABASE_URL", "Supabase project URL (https://<ref>.supabase.co)"),
        ("SUPABASE_ANON_KEY", "Supabase anon/public key"),
    ],
    "AI/LLM": [
        ("GROQ_API_KEY", "Groq API key for LLM inference"),
    ],
}

# Optional but recommended
OPTIONAL_VARS: Dict[str, List[Tuple[str, str]]] = {
    "Supabase (optional)": [
        ("SUPABASE_SERVICE_ROLE_KEY", "Service role key for admin operations"),
    ],
    "AI/LLM (optional)": [
        ("JINA_API_KEY", "Jina AI API key (production RAG embeddings: jina-embeddings-v3)"),
        ("OPENAI_API_KEY", "OpenAI API key (fallback LLM + embeddings)"),
        ("RAG_EMBEDDING_PROVIDER", "Embedding provider: jina | openai | groq | local"),
        ("RAG_EMBEDDING_MODEL", "Embedding model name"),
    ],
    "Web search (optional)": [
        ("TAVILY_API_KEY", "Tavily search API key (primary web search provider)"),
        ("BRAVE_API_KEY", "Brave Search API key (fallback web search provider)"),
    ],
    "RAG (optional)": [
        ("RAG_CHUNK_SIZE", "Chunk size in tokens (default: 800)"),
        ("RAG_CHUNK_OVERLAP", "Chunk overlap in tokens (default: 120)"),
        ("RAG_TOP_K", "Top-K chunks to retrieve (default: 5)"),
        ("RAG_CONFIDENCE_FLOOR", "Confidence floor (default: 0.55)"),
        ("RAG_HANDOFF_THRESHOLD", "Handoff threshold (default: 0.40)"),
    ],
    "Security (optional)": [
        ("ALLOWED_ORIGINS", "Comma-separated CORS origins"),
        ("RATE_LIMIT_MAX", "Max requests per window (default: 30)"),
    ],
    "Infrastructure (optional)": [
        ("REDIS_URL", "Redis connection URL for caching + job queue"),
    ],
    "Storage (optional)": [
        ("RAG_STORAGE_BUCKET", "Storage bucket for knowledge documents"),
    ],
}


def validate_config() -> Dict[str, List[str]]:
    """Validate all required environment variables.

    Returns a dict with 'missing' and 'warnings' lists.
    """
    missing: List[str] = []
    warnings: List[str] = []

    for category, vars_list in REQUIRED_VARS.items():
        for var_name, description in vars_list:
            value = os.getenv(var_name, "").strip()
            if not value:
                missing.append(f"  {var_name}: {description}")

    for category, vars_list in OPTIONAL_VARS.items():
        for var_name, description in vars_list:
            value = os.getenv(var_name, "").strip()
            if not value:
                warnings.append(f"  {var_name}: {description}")

    return {"missing": missing, "warnings": warnings}


def print_config_report():
    """Print a configuration report at startup."""
    result = validate_config()

    print("\n" + "=" * 60)
    print("Dayjoy AI Assist — Configuration Check")
    print("=" * 60)

    if result["missing"]:
        print(f"\n❌ MISSING REQUIRED VARIABLES ({len(result['missing'])}):")
        for var in result["missing"]:
            print(var)
        print("\n⚠️  The application will start but some features will not work.")
        print("    Set these in your .env file or environment.\n")
    else:
        print("\n✅ All required environment variables are set.")

    if result["warnings"]:
        print(f"\n⚠️  OPTIONAL VARIABLES NOT SET ({len(result['warnings'])}):")
        for var in result["warnings"]:
            print(var)
        print("\n    These are optional but recommended for full functionality.\n")

    print("=" * 60 + "\n")


def fail_if_missing():
    """Exit if required variables are missing. Use in strict production mode."""
    result = validate_config()
    if result["missing"]:
        print("\n❌ FATAL: Missing required environment variables:")
        for var in result["missing"]:
            print(var)
        sys.exit(1)
