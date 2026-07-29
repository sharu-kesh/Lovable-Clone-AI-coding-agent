import httpx
import os
import re
import json
import time
import asyncio
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Tuple
import logging

logger = logging.getLogger("llm_client")


# ─── Model Slot ───────────────────────────────────────────────────────────────

@dataclass
class ModelSlot:
    """
    Represents one (provider, model) pair in the global model queue.

    Sorting key (lowest = tried first):
      1. is_available  - models blocked by TTL go to the back
      2. priority      - lower number = higher preference
      3. last_success  - tie-break: most recently successful model wins
    """
    provider: str
    model: Optional[str]          # None = use provider's built-in default
    priority: int                 # lower number = tried sooner
    display: str                  # human-readable label for logs

    # Circuit-breaker state (mutated at runtime)
    available_at: float = 0.0     # epoch timestamp; 0 = available right now
    consecutive_failures: int = 0
    last_success: float = 0.0

    def is_available(self) -> bool:
        return time.time() >= self.available_at

    def seconds_until_available(self) -> float:
        return max(0.0, self.available_at - time.time())

    def sort_key(self) -> Tuple:
        # (blocked?, priority, recency of last success descending)
        return (not self.is_available(), self.priority, -self.last_success)

    def on_success(self):
        self.available_at = 0.0
        self.consecutive_failures = 0
        self.last_success = time.time()

    def on_rate_limit(self, retry_after_seconds: float):
        """Push this model back with a precise TTL from the API response."""
        self.available_at = time.time() + retry_after_seconds
        self.consecutive_failures += 1
        logger.info(
            f"[queue] {self.display} rate-limited: available again in "
            f"{retry_after_seconds:.0f}s (at {time.strftime('%H:%M:%S', time.localtime(self.available_at))})"
        )

    def on_deprecated(self):
        """Mark as permanently unavailable (404 deprecated / 402 out of credits)."""
        self.available_at = float("inf")
        logger.warning(f"[queue] {self.display} permanently disabled: removed from rotation")

    def on_error(self):
        self.consecutive_failures += 1
        # Exponential back-off: 5s, 10s, 20s, ... capped at 120s
        penalty = min(5 * (2 ** (self.consecutive_failures - 1)), 120)
        self.available_at = time.time() + penalty
        logger.info(f"[queue] {self.display} errored: cooling off for {penalty}s")


# ─── Default global model queue ───────────────────────────────────────────────
# Each entry: (provider, model_id, priority, display_label)
# priority: lower = tried sooner. Adjust freely.
DEFAULT_MODEL_QUEUE = [
    # ── Cloud Proxy (highest priority when PROXY_URL is configured) ───────────
    # Routes all LLM calls through your Render gateway; hides your API keys.
    ("proxy",     "gemini-2.0-flash",    0,  "Cloud Proxy (Gemini 2.0 Flash)"),
    # ── Direct provider fallbacks (used only when PROXY_URL is not set) ──────
    # GitHub Models - free prototyping quota and OpenAI-compatible tool calling
    ("github",    "openai/gpt-4.1",     1,  "GitHub Models GPT-4.1"),
    # Gemini - generous free quota, fast
    ("gemini",    "gemini-2.0-flash",    2,  "Gemini 2.0 Flash"),
    ("gemini",    "gemini-flash-latest", 3,  "Gemini Flash Latest (2.5)"),
    # Groq - fastest inference, 30 RPM free tier
    ("groq",      "llama-3.3-70b-versatile", 4, "Groq Llama 3.3 70B"),
    ("groq",      "llama-3.1-8b-instant",     5, "Groq Llama 3.1 8B"),
    # Together AI - open-source, large free credits
    ("together",  "meta-llama/Llama-4-Scout-17B-16E-Instruct", 6, "Together Llama 4 Scout"),
    ("together",  "Qwen/Qwen2.5-Coder-32B-Instruct",           7, "Together Qwen 2.5 Coder"),
    # Mistral - strong coding models
    ("mistral",   "codestral-latest",        8, "Mistral Codestral"),
    ("mistral",   "mistral-medium-latest",   9, "Mistral Medium"),
    # OpenRouter - aggregator, wide model choice
    ("openrouter", None,                    10, "OpenRouter (auto)"),
    # OpenAI - last resort (costs money)
    ("openai",    "gpt-4o-mini",            11, "OpenAI GPT-4o Mini"),
]


class LLMClient:
    def __init__(self):
        # If PROXY_URL is set, all LLM calls go through the cloud gateway.
        # Otherwise fall back to direct provider keys.
        self.proxy_url = os.getenv("PROXY_URL", "").strip().rstrip("/")

        self.default_provider = "proxy" if self.proxy_url else os.getenv("LLM_PROVIDER", "gemini").lower()
        self.default_model    = os.getenv("LLM_MODEL", "gemini-2.0-flash")

        self.keys = {
            # proxy — treated as a key so _has_key() returns True when PROXY_URL is set
            "proxy":      self.proxy_url,
            "gemini":     os.getenv("GEMINI_API_KEY",     "").strip(),
            "openrouter": os.getenv("OPENROUTER_API_KEY", "").strip(),
            "openai":     os.getenv("OPENAI_API_KEY",     "").strip(),
            "groq":       os.getenv("GROQ_API_KEY",       "").strip(),
            "together":   os.getenv("TOGETHER_API_KEY",   "").strip(),
            "mistral":    os.getenv("MISTRAL_API_KEY",    "").strip(),
            "github":     os.getenv("GITHUB_TOKEN",        "").strip(),
            "ollama":     "local",   # no key needed for Ollama
        }

        if self.proxy_url:
            logger.info(f"[proxy] Cloud proxy mode enabled → {self.proxy_url}")

        # ── Global circuit-breaker queue ──────────────────────────────────────
        # Built at startup from DEFAULT_MODEL_QUEUE, filtered to only providers
        # that have a configured API key.  State mutates at runtime.
        self.model_queue: List[ModelSlot] = [
            ModelSlot(provider=prov, model=mod, priority=pri, display=disp)
            for prov, mod, pri, disp in DEFAULT_MODEL_QUEUE
            if self._has_key(prov)
        ]

        if not self.model_queue:
            logger.warning("No API keys found - model queue is empty!")
        else:
            self._load_cooldowns()
            logger.info(
                f"[queue] Initialized with {len(self.model_queue)} slots: "
                + ", ".join(s.display for s in self.model_queue)
            )

    def _save_cooldowns(self):
        try:
            cooldowns = {}
            for s in self.model_queue:
                if s.available_at > time.time():
                    # Save slot by provider:model key with its absolute available_at timestamp
                    cooldowns[f"{s.provider}:{s.model or ''}"] = s.available_at
            
            os.makedirs(".sessions", exist_ok=True)
            with open(".sessions/cooldowns.json", "w", encoding="utf-8") as f:
                json.dump(cooldowns, f)
        except Exception as e:
            logger.warning(f"Could not save model cooldowns: {e}")

    def _load_cooldowns(self):
        try:
            path = ".sessions/cooldowns.json"
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    cooldowns = json.load(f)
                for s in self.model_queue:
                    key = f"{s.provider}:{s.model or ''}"
                    if key in cooldowns:
                        val = cooldowns[key]
                        if val > time.time():
                            s.available_at = val
                            hours_left = (val - time.time()) / 3600.0
                            logger.info(
                                f"[queue] Restored cooldown for {s.display}: "
                                f"available in {hours_left:.1f} hours (at {time.strftime('%H:%M:%S', time.localtime(val))})"
                            )
        except Exception as e:
            logger.warning(f"Could not load model cooldowns: {e}")

    def _has_key(self, provider: str) -> bool:
        return bool(self.keys.get(provider, "").strip())

    def _sorted_queue(self) -> List[ModelSlot]:
        """
        Returns the queue sorted by availability + priority.
        This is where TTL-based re-promotion happens automatically:
        any slot whose available_at is in the past floats back to
        its natural priority position with zero extra code.
        """
        available   = sorted([s for s in self.model_queue if s.is_available()],     key=lambda s: s.sort_key())
        unavailable = sorted([s for s in self.model_queue if not s.is_available()], key=lambda s: s.sort_key())
        return available + unavailable

    def _get_provider_config(self, provider: str, model: Optional[str]) -> Tuple[str, str, Dict[str, str]]:
        p = provider.lower()
        key = self.keys.get(p, "")

        if p == "proxy":
            # Route through the cloud gateway on Render.
            # The proxy URL is the full base URL; we append /proxy/completions in chat_completion.
            url = self.proxy_url
            tgt_model = model or "gemini-2.0-flash"
            headers = {"Content-Type": "application/json"}
            return url, tgt_model, headers

        elif p == "gemini":
            url = "https://generativelanguage.googleapis.com/v1beta/openai"
            # Normalise legacy model names
            if model in ("gemini-1.5-flash", "gemini-3.5-flash", "gemini-2.5-flash-lite"):
                model = "gemini-2.0-flash"
            tgt_model = model or "gemini-2.0-flash"
            headers = {
                "x-goog-api-key": key,
                "Authorization":  f"Bearer {key}",
            }

        elif p == "github":
            # GitHub Models exposes an OpenAI-compatible inference endpoint.
            # A fine-grained PAT needs the "models" permission.
            url = "https://models.github.ai/inference"
            tgt_model = model or "openai/gpt-4.1"
            headers = {
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {key}",
                "X-GitHub-Api-Version": "2026-03-10",
            }

        elif p == "groq":
            url       = "https://api.groq.com/openai/v1"
            tgt_model = model or "llama-3.3-70b-versatile"
            headers   = {"Authorization": f"Bearer {key}"}

        elif p == "together":
            url       = "https://api.together.xyz/v1"
            tgt_model = model or "meta-llama/Llama-4-Scout-17B-16E-Instruct"
            headers   = {"Authorization": f"Bearer {key}"}

        elif p == "mistral":
            url       = "https://api.mistral.ai/v1"
            tgt_model = model or "mistral-medium-latest"
            headers   = {"Authorization": f"Bearer {key}"}

        elif p == "openrouter":
            url       = "https://openrouter.ai/api/v1"
            tgt_model = model or "openrouter/auto"
            headers = {
                "Authorization": f"Bearer {key}",
                "HTTP-Referer":  "https://github.com/lovable-clone",
                "X-Title":       "Lovable Clone AI Agent",
            }

        elif p == "openai":
            url       = "https://api.openai.com/v1"
            tgt_model = model or "gpt-4o-mini"
            headers   = {"Authorization": f"Bearer {key}"}

        elif p == "ollama":
            url       = os.getenv("OLLAMA_API_BASE", "http://localhost:11434/v1")
            tgt_model = model or "qwen2.5-coder:14b"
            headers   = {}

        else:
            raise ValueError(f"Unknown provider: {provider}")

        return url, tgt_model, headers

    def _parse_retry_delay(self, response_text: str, default: float = 60.0) -> float:
        """
        Extract the server-provided retry delay from the error response body.
        Gemini sends a structured retryDelay field; Groq/Together send a plain number.
        
        If it detects a daily quota exhaustion (e.g. 'Quota exceeded' or 'billing details'),
        it locks the model out until midnight UTC.
        """
        try:
            text_lower = response_text.lower()
            if any(k in text_lower for k in ("quota", "billing", "limit exceeded", "exceeded your current")):
                # Daily limit resets at midnight UTC
                now = time.time()
                seconds_to_midnight = 86400 - (now % 86400)
                cooldown_seconds = seconds_to_midnight + 300  # 5 min safety buffer
                logger.warning(
                    f"[queue] Daily limit exceeded. Blocking model for "
                    f"{cooldown_seconds / 3600:.1f} hours (until midnight UTC)."
                )
                return cooldown_seconds

            data = json.loads(response_text)
            if not isinstance(data, dict):
                return default
            # Gemini structured format
            for detail in data.get("error", {}).get("details", []):
                if detail.get("@type", "").endswith("RetryInfo"):
                    delay_str = detail.get("retryDelay", "")
                    if delay_str:
                        return min(float(re.sub(r"[^0-9.]", "", delay_str)) + 2, 120)
            # Some APIs put it directly in the error message as a number
            msg = str(data.get("error", {}).get("message", ""))
            nums = re.findall(r"\b(\d+)\s*second", msg)
            if nums:
                return min(int(nums[0]) + 2, 120)
        except Exception:
            pass
        return default

    def _clean_messages(self, messages: List[Dict[str, Any]], target_provider: str) -> List[Dict[str, Any]]:
        """
        Sanitises history to match each provider's strict schema:
        - Flattens historical tool calls and responses (occurring before the latest user message)
          into plain text assistant/user messages. This completely avoids cross-provider
          schema conflicts, missing thought_signatures, and tool call order mismatches.
        - Keeps the active turn's tool calls and responses structured, cleaning them to
          conform to the target provider.
        """
        is_gemini = target_provider.lower() == "gemini"
        
        # 1. Find the active turn barrier index (whichever is greater: the latest user message, or the latest tool-calling assistant message)
        last_user_idx = -1
        last_active_assistant_idx = -1
        for idx, m in enumerate(messages):
            if m.get("role") == "user":
                last_user_idx = idx
            if m.get("role") == "assistant" and m.get("tool_calls"):
                last_active_assistant_idx = idx

        active_barrier = max(last_user_idx, last_active_assistant_idx)

        cleaned = []

        # Collect IDs of all tool executions that actually returned responses in the active turn
        responded_ids = {
            m.get("tool_call_id") for idx, m in enumerate(messages)
            if idx >= active_barrier and m.get("role") == "tool" and m.get("tool_call_id")
        }

        for idx, m in enumerate(messages):
            role       = m.get("role")
            content    = m.get("content")
            tool_calls = m.get("tool_calls")
            clean_m: Dict[str, Any] = {}

            if idx < active_barrier:
                # ── Flatten Historical Message ──
                if role == "assistant" and tool_calls:
                    calls_text = []
                    for tc in tool_calls:
                        func = tc.get("function", {})
                        calls_text.append(f"Action: called {func.get('name')} with arguments {func.get('arguments')}")
                    calls_str = "\n".join(calls_text)
                    content_str = content or ""
                    clean_m["role"] = "assistant"
                    clean_m["content"] = (content_str + "\n\n" + calls_str).strip()
                elif role == "tool":
                    # Convert tool response into a user message to maintain clean history flow
                    clean_m["role"] = "user"
                    clean_m["content"] = f"Result of {m.get('name') or 'tool'}: {content or ''}"
                else:
                    clean_m["role"] = role if role else "user"
                    clean_m["content"] = content if content is not None else ""
            else:
                # ── Keep Active Turn Message Structured ──
                if role:
                    clean_m["role"] = role

                if role == "assistant" and tool_calls:
                    if content:
                        clean_m["content"] = content

                    fixed_tcs = []
                    for tc in tool_calls:
                        tc_id = tc.get("id")
                        
                        # Strip unmatched active tool calls to prevent order errors
                        if tc_id and tc_id not in responded_ids:
                            continue

                        c_tc: Dict[str, Any] = {}
                        if "id"   in tc: c_tc["id"]   = tc["id"]
                        if "type" in tc: c_tc["type"]  = tc["type"]
                        if is_gemini:
                            c_tc["thought_signature"] = tc.get("thought_signature") or "dummy-thought-sig-for-compatibility"
                        if "function" in tc:
                            c_func = tc["function"].copy()
                            if c_func.get("arguments") is None:
                                c_func["arguments"] = "{}"
                            c_tc["function"] = c_func
                        fixed_tcs.append(c_tc)

                    if fixed_tcs:
                        clean_m["tool_calls"] = fixed_tcs
                    
                    if not fixed_tcs and not clean_m.get("content"):
                        clean_m["content"] = "Analyzing next steps..."
                else:
                    clean_m["content"] = content if content is not None else ""
                    if m.get("tool_call_id") is not None:
                        clean_m["tool_call_id"] = m["tool_call_id"]
                    if m.get("name") is not None:
                        clean_m["name"] = m["name"] or "tool_call"
                    elif role == "tool":
                        clean_m["name"] = "tool_call"

            cleaned.append(clean_m)

        return cleaned

    def queue_status(self) -> List[Dict]:
        """Returns human-readable queue state for debugging / UI display."""
        now = time.time()
        return [
            {
                "display":   s.display,
                "provider":  s.provider,
                "model":     s.model,
                "available": s.is_available(),
                "available_in_s": round(s.seconds_until_available(), 1),
                "priority":  s.priority,
                "failures":  s.consecutive_failures,
                "last_ok":   time.strftime("%H:%M:%S", time.localtime(s.last_success)) if s.last_success else "never",
            }
            for s in self._sorted_queue()
        ]

    async def chat_completion(
        self,
        messages:           List[Dict[str, Any]],
        tools:              Optional[List[Dict[str, Any]]] = None,
        tool_choice:        Optional[str]                  = None,
        require_tool_call:  bool                           = False,
        response_format:    Optional[Dict[str, Any]]       = None,
        preferred_provider: Optional[str]                  = None,
        preferred_model:    Optional[str]                  = None,
    ) -> Dict[str, Any]:
        """
        Attempts providers in queue order (sorted by availability + priority).

        If the caller specifies a preferred_provider/model, that slot is tried
        first. Then the sorted queue is tried from top to bottom.

        TTL recovery is automatic: a slot that was rate-limited with a 60-second
        cooldown will float back to the top of the queue on the very next call
        after 60 seconds have elapsed - no background thread needed.
        """
        if not self.model_queue:
            raise Exception("No API keys configured. Add at least one provider key in .env")

        last_errors: List[str] = []

        # ── Build the ordered list of slots to attempt ────────────────────────
        # Preferred slot (user-specified or env default) goes first if available.
        pref_prov  = (preferred_provider or self.default_provider).lower()
        pref_model = preferred_model or self.default_model

        # Find the preferred slot in the queue
        pref_slot = next(
            (s for s in self.model_queue
             if s.provider == pref_prov and (s.model == pref_model or s.model is None)),
            None
        )

        # Full sorted queue; move pref_slot to front if present
        ordered = self._sorted_queue()
        if pref_slot and pref_slot in ordered and pref_slot.is_available():
            ordered = [pref_slot] + [s for s in ordered if s is not pref_slot]

        logger.info(
            f"[queue] Call order: "
            + " -> ".join(f"{s.display}{'[OK]' if s.is_available() else f'({s.seconds_until_available():.0f}s)'}" for s in ordered[:5])
            + ("..." if len(ordered) > 5 else "")
        )

        # ── Try each slot in order ────────────────────────────────────────────
        for slot in ordered:
            if not slot.is_available():
                wait = slot.seconds_until_available()
                logger.info(f"[queue] Skipping {slot.display}: available in {wait:.0f}s")
                # If this is the *only* slot left and it's the preferred one,
                # wait for it rather than fail completely.
                if len([s for s in self.model_queue if s.is_available()]) == 0:
                    logger.warning(f"[queue] All slots rate-limited. Waiting {wait:.0f}s for {slot.display}...")
                    await asyncio.sleep(wait)
                else:
                    continue

            cleaned = self._clean_messages(messages, target_provider=slot.provider)

            try:
                base_url, tgt_model, headers = self._get_provider_config(slot.provider, slot.model)

                # Proxy uses a different endpoint path and needs the provider name in the body
                if slot.provider == "proxy":
                    url = f"{base_url}/proxy/completions"
                else:
                    url = f"{base_url}/chat/completions"
                logger.info(f"[queue] Trying {slot.display} ({tgt_model})")

                payload: Dict[str, Any] = {
                    "model":       tgt_model,
                    "messages":    cleaned,
                    "temperature": 0.2,
                }
                if slot.provider == "proxy":
                    # Tell the cloud proxy which upstream provider to use
                    payload["provider"] = "gemini"
                if tools:
                    payload["tools"] = [{"type": "function", "function": t} for t in tools]
                if tool_choice:
                    payload["tool_choice"] = tool_choice
                if response_format:
                    payload["response_format"] = response_format

                async with httpx.AsyncClient(timeout=120.0) as client:
                    response = await client.post(url, headers=headers, json=payload)

                # ── Success ───────────────────────────────────────────────────
                if response.status_code == 200:
                    data = response.json()
                    message = (data.get("choices") or [{}])[0].get("message") or {}
                    if require_tool_call and not message.get("tool_calls"):
                        err_text = f"{slot.display} returned prose instead of a required tool call"
                        logger.warning(f"[queue] {err_text}")
                        last_errors.append(err_text)
                        slot.on_error()
                        self._save_cooldowns()
                        continue
                    slot.on_success()
                    self._save_cooldowns()
                    logger.info(f"[queue] [OK] {slot.display} succeeded. Queue: {[s.display for s in self._sorted_queue()]}")
                    return data

                err_text = f"{slot.display} status {response.status_code}: {response.text[:400]}"
                logger.warning(f"[queue] {err_text}")
                last_errors.append(err_text)

                # ── 402 Credit limit exceeded: disable provider indefinitely ──
                if response.status_code == 402:
                    slot.on_deprecated()
                    self._save_cooldowns()
                    continue

                # ── 429 Rate limit: apply precise TTL, skip to next ───────────
                if response.status_code == 429:
                    delay = self._parse_retry_delay(response.text, default=60.0)
                    slot.on_rate_limit(delay)
                    self._save_cooldowns()
                    logger.info(f"[queue] Next order: {[s.display for s in self._sorted_queue()]}")
                    continue

                # ── 404 Deprecated/not-found: remove permanently ──────────────
                if response.status_code == 404:
                    slot.on_deprecated()
                    self._save_cooldowns()
                    continue

                # ── 400 thought_signature: Gemini model mismatch, rotate ──────
                if response.status_code == 400 and "thought_signature" in response.text:
                    slot.on_rate_limit(30.0)   # soft rotate - may recover
                    self._save_cooldowns()
                    logger.warning(f"[queue] thought_signature mismatch on {slot.display}: soft-rotating")
                    continue

                # ── 400 Mistral tool call order error: rotate ─────────────────
                if response.status_code == 400 and "function calls and responses" in response.text:
                    slot.on_error()
                    self._save_cooldowns()
                    continue

                # ── Any other error: penalise and try next slot ───────────────
                slot.on_error()
                self._save_cooldowns()
                continue

            except Exception as e:
                err_text = f"{slot.display} exception: {str(e)}"
                logger.warning(f"[queue] {err_text}")
                last_errors.append(err_text)
                slot.on_error()
                self._save_cooldowns()
                continue

        raise Exception(
            "All LLM providers exhausted. Errors:\n" + "\n".join(last_errors)
        )
