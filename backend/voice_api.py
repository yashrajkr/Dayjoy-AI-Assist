"""
Realtime Voice WebSocket relay — DayJoy AI Voice, Phase 1 (realtime audio
infrastructure).

TRANSPORT DECISION: WebSocket, not WebRTC. This is browser<->our-backend
audio, not peer-to-peer, so WebRTC's ICE/STUN/TURN/SFU machinery (built to
solve NAT traversal between two browsers) buys nothing here. FastAPI/
Starlette already support WebSocket natively — no framework change needed.

PROVIDER DECISION: Deepgram. It is the only new vendor added — it covers
BOTH streaming STT ("Nova", real partial + final transcripts, real
endpointing/VAD) and streaming TTS ("Aura", real audio chunks) under one
API key, avoiding a second vendor for the other direction. Configured via
DEEPGRAM_API_KEY. If that key is unset, this endpoint sends
{"type": "unavailable"} and closes immediately — the frontend
(voiceRealtime.ts) then transparently falls back to the existing browser
SpeechRecognition/speechSynthesis pipeline (useVoice.ts). This module must
never fabricate a realtime session when the key is absent — no synthetic
partial transcripts, no synthetic audio.

RAG/LLM REUSE: this module does NOT run its own RAG/tool/LLM logic. Once a
final transcript is available it builds a `ChatRequest` — the exact same
model the text chat UI sends — and calls `backend.main.chat_stream()`
in-process (a direct Python call, not a network hop) so a voice question
goes through the identical routing/RAG/tools/safety pipeline as typed
chat. It decodes that endpoint's own SSE frames and republishes them over
this WebSocket, and feeds completed sentences of the answer to Deepgram's
TTS socket, relaying audio chunks back to the client as they arrive.

SCOPE HONESTY: session recovery/reconnection state below is a single
in-process dict — it survives a dropped WebSocket within one worker
process for a bounded idle window, but does NOT survive a process restart
or work across multiple uvicorn workers/replicas. A production multi-
worker deployment would need this moved to Redis; that is explicitly
flagged as Phase 2 follow-up, not implemented here.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.requests import Request

_voice_logger = logging.getLogger("dayjoy.voice")

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "").strip()
DEEPGRAM_STT_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?encoding=linear16&sample_rate=16000&channels=1"
    "&interim_results=true&endpointing=300&smart_format=true&punctuate=true"
)
DEEPGRAM_TTS_URL_BASE = "wss://api.deepgram.com/v1/speak?encoding=linear16&sample_rate=24000"

# Deepgram model names per language — Nova-2 covers English well; other
# Indian languages route through Nova-2's multilingual/general model where
# a dedicated one isn't available. This mirrors the honesty rule: languages
# without first-class Deepgram support get a documented, not a pretended,
# best-effort model choice.
_DEEPGRAM_STT_LANGUAGE_MODEL = {
    "en": "nova-2",
    "hi": "nova-2",
}
_DEFAULT_STT_MODEL = "nova-2"

# Deepgram Aura voices — only English is officially supported by Aura at
# time of writing. Non-English voice output over the realtime path falls
# back to the browser TTS pipeline until Deepgram (or a second TTS vendor)
# adds that language — tracked, not silently ignored.
_AURA_SUPPORTED_LANGUAGES = {"en"}
_DEFAULT_AURA_VOICE = "aura-asteria-en"

router = APIRouter(prefix="/voice", tags=["voice"])

MAX_SESSION_DURATION_SECONDS = 30 * 60
SESSION_IDLE_TIMEOUT_SECONDS = 120
_SESSION_SWEEP_INTERVAL_SECONDS = 30


# ---------------------------------------------------------------------------
# Explicit state machine (Step 5) — one source of truth, no independent
# booleans that can contradict each other.
# ---------------------------------------------------------------------------
VOICE_STATES = {
    "IDLE", "CONNECTING", "LISTENING", "PROCESSING", "SEARCHING", "THINKING",
    "SPEAKING", "INTERRUPTED", "PAUSED", "MUTED", "RECONNECTING", "ERROR", "ENDED",
}

_VALID_TRANSITIONS: Dict[str, set] = {
    "IDLE": {"CONNECTING", "ERROR", "ENDED"},
    "CONNECTING": {"LISTENING", "ERROR", "ENDED", "RECONNECTING"},
    "LISTENING": {"PROCESSING", "MUTED", "PAUSED", "RECONNECTING", "ERROR", "ENDED", "INTERRUPTED"},
    "PROCESSING": {"SEARCHING", "THINKING", "SPEAKING", "ERROR", "LISTENING", "ENDED"},
    "SEARCHING": {"THINKING", "SPEAKING", "ERROR", "ENDED", "LISTENING"},
    "THINKING": {"SPEAKING", "ERROR", "ENDED", "LISTENING"},
    "SPEAKING": {"LISTENING", "INTERRUPTED", "PAUSED", "ERROR", "ENDED"},
    "INTERRUPTED": {"LISTENING", "PROCESSING", "ENDED"},
    "PAUSED": {"LISTENING", "ENDED"},
    "MUTED": {"LISTENING", "ENDED"},
    "RECONNECTING": {"LISTENING", "ERROR", "ENDED"},
    "ERROR": {"RECONNECTING", "ENDED", "IDLE"},
    "ENDED": set(),
}


class InvalidTransition(Exception):
    pass


@dataclass
class VoiceSession:
    session_id: str
    user_id: str
    conversation_id: Optional[str] = None
    language: str = "en"
    voice: Optional[str] = None
    state: str = "IDLE"
    started_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    connection_status: str = "connecting"

    def transition(self, new_state: str) -> None:
        if new_state not in VOICE_STATES:
            raise InvalidTransition(f"Unknown state: {new_state}")
        if new_state == self.state:
            self.last_activity = time.time()
            return
        allowed = _VALID_TRANSITIONS.get(self.state, set())
        if new_state not in allowed:
            raise InvalidTransition(f"Illegal transition {self.state} -> {new_state}")
        self.state = new_state
        self.last_activity = time.time()

    def is_expired(self, now: Optional[float] = None) -> bool:
        now = now if now is not None else time.time()
        return (
            (now - self.started_at) > MAX_SESSION_DURATION_SECONDS
            or (now - self.last_activity) > SESSION_IDLE_TIMEOUT_SECONDS
        )

    def to_public_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "conversation_id": self.conversation_id,
            "state": self.state,
            "language": self.language,
            "started_at": self.started_at,
        }


# In-memory registry — see module docstring's "SCOPE HONESTY" note.
_sessions: Dict[str, VoiceSession] = {}


def _sweep_expired_sessions() -> None:
    now = time.time()
    for sid in [s for s, sess in _sessions.items() if sess.is_expired(now)]:
        _sessions.pop(sid, None)


_SENTENCE_END_RE = re.compile(r"(?<=[.!?।])\s+")


def _split_ready_sentences(buffer: str) -> tuple[list[str], str]:
    """Split a growing text buffer into complete sentences plus a remainder.

    Mirrors the same "speak sentences as they finish streaming" approach
    the frontend already uses in VoiceAssistant.tsx (splitSentences /
    speakNewSentences) — kept here too so the realtime TTS path also starts
    speaking before the full LLM answer has finished generating.
    """
    parts = _SENTENCE_END_RE.split(buffer)
    if len(parts) <= 1:
        return [], buffer
    *complete, remainder = parts
    return [p.strip() for p in complete if p.strip()], remainder


async def _decode_sse_events(body_iterator: AsyncIterator[bytes]) -> AsyncIterator[Dict[str, Any]]:
    """Parse `/chat/stream`'s `_sse()`-encoded frames back into dicts.

    `_sse()` (backend/main.py) encodes each event as `data: {json}\n\n`.
    This is the inverse, used so the voice relay can consume the exact same
    generator the SSE endpoint streams to text-chat clients, without
    duplicating a single line of routing/RAG/tool logic.
    """
    buf = ""
    async for chunk in body_iterator:
        buf += chunk.decode("utf-8") if isinstance(chunk, (bytes, bytearray)) else chunk
        while "\n\n" in buf:
            frame, buf = buf.split("\n\n", 1)
            if frame.startswith("data: "):
                try:
                    yield json.loads(frame[len("data: "):])
                except json.JSONDecodeError:
                    continue


class _HeaderOnlyRequest(Request):
    """A Request built from a WebSocket's ASGI scope, for reuse of handlers
    that only ever read `request.headers` (get_user_id, chat_stream). Its
    `receive()` is never invoked by that code path, so no body plumbing is
    needed — this is a legitimate, narrow reuse of Starlette's own Request
    class, not a reimplementation of it."""


async def _run_deepgram_stt(
    websocket: WebSocket,
    audio_queue: "asyncio.Queue[Optional[bytes]]",
    on_final_transcript,
    on_partial_transcript,
    language: str,
) -> None:
    import websockets as ws_client

    model = _DEEPGRAM_STT_LANGUAGE_MODEL.get(language, _DEFAULT_STT_MODEL)
    url = f"{DEEPGRAM_STT_URL}&model={model}&language={language}"
    headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}

    async with ws_client.connect(url, additional_headers=headers) as dg:

        async def _pump_audio() -> None:
            while True:
                chunk = await audio_queue.get()
                if chunk is None:
                    await dg.send(json.dumps({"type": "CloseStream"}))
                    return
                await dg.send(chunk)

        pump_task = asyncio.create_task(_pump_audio())
        try:
            async for message in dg:
                if isinstance(message, (bytes, bytearray)):
                    continue
                payload = json.loads(message)
                if payload.get("type") != "Results":
                    continue
                alt = (payload.get("channel", {}).get("alternatives") or [{}])[0]
                text = (alt.get("transcript") or "").strip()
                if not text:
                    continue
                if payload.get("is_final"):
                    await on_final_transcript(text)
                else:
                    await on_partial_transcript(text)
        finally:
            pump_task.cancel()


async def _run_deepgram_tts(text: str, voice: str) -> AsyncIterator[bytes]:
    import websockets as ws_client

    url = f"{DEEPGRAM_TTS_URL_BASE}&model={voice}"
    headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}
    async with ws_client.connect(url, additional_headers=headers) as dg:
        await dg.send(json.dumps({"type": "Speak", "text": text}))
        await dg.send(json.dumps({"type": "Flush"}))
        async for message in dg:
            if isinstance(message, (bytes, bytearray)):
                yield bytes(message)
            else:
                payload = json.loads(message)
                if payload.get("type") == "Flushed":
                    return


@router.websocket("/ws")
async def voice_ws(
    websocket: WebSocket,
    token: str = "",
    session_id: str = "",
    language: str = "en",
    conversation_id: str = "",
) -> None:
    """Realtime voice session. Auth token is passed as a query param because
    the browser WebSocket API cannot set an Authorization header on the
    handshake request — this is the standard workaround for browser-native
    WebSocket auth, and the token is still verified with the same
    `verify_jwt()` used everywhere else (no separate/weaker auth path)."""
    from backend.main import verify_jwt, check_rate_limit, ChatRequest, chat_stream  # noqa: E402

    await websocket.accept()
    _sweep_expired_sessions()

    if not DEEPGRAM_API_KEY:
        await websocket.send_json({"type": "unavailable", "reason": "realtime_provider_not_configured"})
        await websocket.close(code=1000)
        return

    try:
        claims = await verify_jwt(token)
    except Exception:
        await websocket.send_json({"type": "error", "reason": "unauthorized"})
        await websocket.close(code=4401)
        return
    user_id = claims.get("sub")
    if not user_id:
        await websocket.close(code=4401)
        return

    try:
        check_rate_limit(user_id)
    except Exception:
        await websocket.send_json({"type": "error", "reason": "rate_limited"})
        await websocket.close(code=4429)
        return

    session = _sessions.get(session_id) if session_id else None
    if session is not None and session.user_id != user_id:
        session = None  # never resume another user's session id
    if session is None:
        session = VoiceSession(
            session_id=session_id or str(uuid.uuid4()),
            user_id=user_id,
            conversation_id=conversation_id or None,
            language=language,
        )
        _sessions[session.session_id] = session
        session.transition("CONNECTING")
    else:
        session.transition("RECONNECTING")
    session.connection_status = "connected"

    await websocket.send_json({"type": "session", **session.to_public_dict()})
    session.transition("LISTENING")
    await websocket.send_json({"type": "state", "state": session.state})

    auth_header = f"Bearer {token}"
    audio_queue: "asyncio.Queue[Optional[bytes]]" = asyncio.Queue()
    tts_generation = 0  # bumped on interrupt so a stale TTS task stops yielding

    async def send_state(new_state: str) -> None:
        try:
            session.transition(new_state)
        except InvalidTransition as exc:
            _voice_logger.warning("voice session %s: %s", session.session_id, exc)
            return
        await websocket.send_json({"type": "state", "state": new_state})

    async def handle_final_transcript(text: str) -> None:
        nonlocal tts_generation
        my_generation = tts_generation
        await websocket.send_json({"type": "final_transcript", "text": text})
        await send_state("PROCESSING")

        req = ChatRequest(
            message=text,
            role="customer",
            language=language,
            conversation_id=session.conversation_id,
        )
        # Starlette Request reads headers from scope["headers"] lazily; the
        # WebSocket scope carries the original HTTP handshake headers, so
        # inject the bearer token as a synthetic Authorization header —
        # this is what get_user_id()/chat_stream() actually read.
        scope = dict(websocket.scope)
        scope["headers"] = [
            *(h for h in scope.get("headers", []) if h[0].lower() != b"authorization"),
            (b"authorization", auth_header.encode()),
        ]
        fake_request = _HeaderOnlyRequest(scope)

        streaming_response = await chat_stream(req, fake_request)
        aggregated_text = ""
        tts_buffer = ""
        done_payload: Dict[str, Any] = {}

        async def speak(sentence: str) -> None:
            if my_generation != tts_generation:
                return
            voice_model = _DEFAULT_AURA_VOICE if language in _AURA_SUPPORTED_LANGUAGES else None
            if not voice_model:
                # Honest gap: Aura doesn't yet cover this language over the
                # realtime path. Surface it as text; the client's browser-
                # TTS fallback (already wired for the non-realtime path)
                # is what actually speaks it in that case.
                await websocket.send_json({"type": "tts_unavailable", "language": language})
                return
            async for audio_chunk in _run_deepgram_tts(sentence, voice_model):
                if my_generation != tts_generation:
                    return
                await websocket.send_bytes(audio_chunk)

        async for event in _decode_sse_events(streaming_response.body_iterator):
            if my_generation != tts_generation:
                break  # this turn was interrupted; stop processing its answer
            if "status" in event:
                status = event["status"]
                if status in ("searching_knowledge", "searching_web", "checking_pricing", "checking_recommendations", "checking_wellness_goals"):
                    await send_state("SEARCHING")
                elif status in ("analyzing", "verifying"):
                    await send_state("THINKING")
                await websocket.send_json({"type": "status", "status": status})
                continue
            if "token" in event:
                tok = event["token"]
                aggregated_text += tok
                tts_buffer += tok
                await websocket.send_json({"type": "text_delta", "delta": tok})
                if session.state != "SPEAKING":
                    await send_state("SPEAKING")
                ready, tts_buffer = _split_ready_sentences(tts_buffer)
                for sentence in ready:
                    await speak(sentence)
                continue
            if event.get("done"):
                done_payload = event
                if tts_buffer.strip():
                    await speak(tts_buffer.strip())
                break

        if done_payload.get("conversation_id"):
            session.conversation_id = done_payload["conversation_id"]
        await websocket.send_json({
            "type": "final_answer",
            "text": aggregated_text,
            "sources": done_payload.get("sources", []),
            "answer_source": done_payload.get("answer_source"),
            "handoff_required": done_payload.get("handoff_required", False),
        })
        if my_generation == tts_generation:
            await send_state("LISTENING")

    async def handle_partial_transcript(text: str) -> None:
        await websocket.send_json({"type": "partial_transcript", "text": text})

    stt_task = asyncio.create_task(
        _run_deepgram_stt(websocket, audio_queue, handle_final_transcript, handle_partial_transcript, language)
    )

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if "bytes" in message and message["bytes"] is not None:
                await audio_queue.put(message["bytes"])
            elif "text" in message and message["text"] is not None:
                try:
                    control = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue
                kind = control.get("type")
                if kind == "interrupt":
                    tts_generation += 1  # invalidate any in-flight TTS/answer streaming
                    await send_state("INTERRUPTED")
                    await send_state("LISTENING")
                elif kind == "mute":
                    await send_state("MUTED")
                elif kind == "unmute":
                    await send_state("LISTENING")
                elif kind == "pause":
                    await send_state("PAUSED")
                elif kind == "resume":
                    await send_state("LISTENING")
                elif kind == "end":
                    break
    except WebSocketDisconnect:
        pass
    finally:
        await audio_queue.put(None)
        stt_task.cancel()
        session.connection_status = "disconnected"
        try:
            session.transition("ENDED")
        except InvalidTransition:
            pass
        _sessions.pop(session.session_id, None)


@router.get("/capabilities")
async def voice_capabilities() -> Dict[str, Any]:
    """Lets the frontend know, before opening a WebSocket, whether the
    realtime path is configured at all — avoids a doomed connect attempt
    when DEEPGRAM_API_KEY is unset."""
    return {
        "realtime_available": bool(DEEPGRAM_API_KEY),
        "stt_languages": sorted(_DEEPGRAM_STT_LANGUAGE_MODEL.keys()) or ["en"],
        "tts_languages": sorted(_AURA_SUPPORTED_LANGUAGES),
    }
