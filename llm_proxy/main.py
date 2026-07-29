"""
Lovable Clone — Cloud LLM Proxy
================================
Deploy this to Render (free tier). It holds your API keys securely
as environment variables and forwards OpenAI-compatible /chat/completions
requests from any local agent server to the real LLM providers.

Users never see your keys. The local agent just calls:
    POST https://your-proxy.onrender.com/proxy/completions
"""

import os
import json
import logging
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from typing import Any, Dict, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("llm_proxy")

app = FastAPI(title="Lovable Clone LLM Proxy")

# Allow local agent servers from any origin to call this proxy
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API Keys (set these in Render's Environment Variables dashboard) ──────────
PROVIDER_KEYS: Dict[str, str] = {
    "gemini":      os.getenv("GEMINI_API_KEY", ""),
    "groq":        os.getenv("GROQ_API_KEY", ""),
    "together":    os.getenv("TOGETHER_API_KEY", ""),
    "mistral":     os.getenv("MISTRAL_API_KEY", ""),
    "openrouter":  os.getenv("OPENROUTER_API_KEY", ""),
    "openai":      os.getenv("OPENAI_API_KEY", ""),
    "github":      os.getenv("GITHUB_TOKEN", ""),
}

# ── Provider base URLs (OpenAI-compatible endpoints) ──────────────────────────
PROVIDER_URLS: Dict[str, str] = {
    "gemini":      "https://generativelanguage.googleapis.com/v1beta/openai",
    "groq":        "https://api.groq.com/openai/v1",
    "together":    "https://api.together.xyz/v1",
    "mistral":     "https://api.mistral.ai/v1",
    "openrouter":  "https://openrouter.ai/api/v1",
    "openai":      "https://api.openai.com/v1",
    "github":      "https://models.inference.ai.azure.com",
}


def _build_headers(provider: str, key: str) -> Dict[str, str]:
    """Build provider-specific auth headers."""
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    p = provider.lower()
    if p == "gemini":
        headers["x-goog-api-key"] = key
        headers["Authorization"] = f"Bearer {key}"
    elif p == "openrouter":
        headers["Authorization"] = f"Bearer {key}"
        headers["HTTP-Referer"] = "https://github.com/lovable-clone"
        headers["X-Title"] = "Lovable Clone AI Agent"
    else:
        headers["Authorization"] = f"Bearer {key}"
    return headers


@app.get("/")
async def health():
    """Health check endpoint — confirms the proxy is online."""
    configured = [p for p, k in PROVIDER_KEYS.items() if k]
    return {
        "status": "ok",
        "service": "Lovable Clone LLM Proxy",
        "providers_configured": configured,
    }


@app.post("/proxy/completions")
async def proxy_completions(request: Request):
    """
    Main proxy endpoint.

    Expects JSON body:
    {
        "provider": "gemini",          # which LLM provider to use
        "model": "gemini-2.0-flash",   # model ID for that provider
        "messages": [...],             # OpenAI-format messages array
        "tools": [...],                # optional tool definitions
        "tool_choice": "auto",         # optional
        "temperature": 0.2,            # optional
        "response_format": {...}       # optional
    }

    Returns the raw JSON response from the LLM provider,
    or a structured error dict on failure.
    """
    try:
        body: Dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    provider = body.pop("provider", "gemini").lower()
    model = body.get("model")

    # Validate provider
    if provider not in PROVIDER_URLS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown provider '{provider}'. Valid: {list(PROVIDER_URLS.keys())}"
        )

    key = PROVIDER_KEYS.get(provider, "")
    if not key:
        raise HTTPException(
            status_code=503,
            detail=f"Provider '{provider}' is not configured on this proxy. "
                   f"Add {provider.upper()}_API_KEY to Render environment variables."
        )

    base_url = PROVIDER_URLS[provider]
    url = f"{base_url}/chat/completions"
    headers = _build_headers(provider, key)

    # Gemini model name normalisation (same logic as local llm_client.py)
    if provider == "gemini" and model in ("gemini-1.5-flash", "gemini-3.5-flash", "gemini-2.5-flash-lite"):
        body["model"] = "gemini-2.0-flash"

    logger.info(f"[proxy] Forwarding → {provider}/{body.get('model')} | messages={len(body.get('messages', []))}")

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(url, headers=headers, json=body)

        logger.info(f"[proxy] ← {provider} responded {response.status_code}")

        # Pass the raw response back (status code + body) so the local
        # llm_client.py can handle 429 / 402 / 404 exactly as before.
        return JSONResponse(
            status_code=response.status_code,
            content=response.json() if response.headers.get("content-type", "").startswith("application/json")
                    else {"raw": response.text},
        )

    except httpx.TimeoutException:
        logger.error(f"[proxy] Timeout forwarding to {provider}")
        return JSONResponse(
            status_code=504,
            content={"error": {"code": 504, "message": f"Upstream timeout for provider '{provider}'"}}
        )
    except Exception as ex:
        logger.error(f"[proxy] Unexpected error: {ex}")
        return JSONResponse(
            status_code=500,
            content={"error": {"code": 500, "message": str(ex)}}
        )
