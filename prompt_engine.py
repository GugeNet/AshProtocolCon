"""Send prompts to the llama-cpp engine Hypnos and Oneiroi use.

The model file is ASH_MODEL, or the same default GGUF as hypnos.py.
The process loads it once, with the same context and GPU fallback those
tools use, then reads one JSON request per line from stdin.

    {"id": 1, "prompt": "...", "temperature": 0.8, "max_tokens": 1024}

Each line on stdout is one JSON object. A ready event means the model
loaded. A reply's raw field is the create_chat_completion return value,
with nothing removed and nothing rewritten. Free prompts are not forced
into the JSON schema Hypnos and Oneiroi use for memories and dreams.

    python prompt_engine.py
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import hypnos

MAX_TEMPERATURE = 2.0
MAX_TOP_P = 1.0
MAX_TOP_K = 500
MAX_SEED = 2_147_483_647
DEFAULT_MAX_TOKENS = 1024
MAX_TOKENS = 8192


def temperature_ok(value: float) -> bool:
    return math.isfinite(value) and 0.0 <= value <= MAX_TEMPERATURE


def temperature_value(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not temperature_ok(number):
        return None
    return number


def max_tokens_value(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if 1 <= value <= MAX_TOKENS:
        return value
    return None


def top_p_value(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or not (0.0 <= number <= MAX_TOP_P):
        return None
    return number


def top_k_value(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if 0 <= value <= MAX_TOP_K:
        return value
    return None


def seed_value(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if 0 <= value <= MAX_SEED:
        return value
    return None


def load_model(llama_cls, path: str):
    """Load the GGUF the way hypnos.ask_model and Oneiroi.ask_model do."""
    last = None
    for layers in (-1, 0):
        try:
            llm = llama_cls(
                model_path=path,
                n_ctx=8192,
                n_gpu_layers=layers,
                verbose=False,
            )
            return llm, layers
        except Exception as error:
            last = error
    raise RuntimeError(f"The model did not load. {last}") from last


def complete(llm, prompt: str, temperature: float, top_p: float, top_k: int, seed: int | None, max_tokens: int) -> dict:
    chosen_seed = seed if seed is not None else random.randint(0, MAX_SEED)
    result = llm.create_chat_completion(
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
        top_p=top_p,
        top_k=top_k,
        seed=chosen_seed,
        max_tokens=max_tokens,
    )
    if not isinstance(result, dict):
        raise RuntimeError("The engine did not return a completion object.")
    return result


def handle(llm, request: dict) -> dict:
    ident = request.get("id")
    prompt = request.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return {"id": ident, "ok": False, "error": "The prompt is empty."}
    temperature = temperature_value(request.get("temperature"))
    if temperature is None:
        return {"id": ident, "ok": False, "error": f"Temperature must be from 0 to {MAX_TEMPERATURE:g}."}
    top_p = top_p_value(request.get("top_p"))
    if top_p is None:
        return {"id": ident, "ok": False, "error": f"Top-p must be from 0 to {MAX_TOP_P:g}."}
    top_k = top_k_value(request.get("top_k"))
    if top_k is None:
        return {"id": ident, "ok": False, "error": f"Top-k must be from 0 to {MAX_TOP_K}."}
    seed = None
    if "seed" in request and request.get("seed") is not None:
        seed = seed_value(request.get("seed"))
        if seed is None:
            return {"id": ident, "ok": False, "error": f"Seed must be from 0 to {MAX_SEED}."}
    if "max_tokens" in request:
        max_tokens = max_tokens_value(request.get("max_tokens"))
        if max_tokens is None:
            return {"id": ident, "ok": False, "error": f"Max tokens must be from 1 to {MAX_TOKENS}."}
    else:
        max_tokens = DEFAULT_MAX_TOKENS
    try:
        raw = complete(llm, prompt, temperature, top_p, top_k, seed, max_tokens)
    except Exception as error:
        return {"id": ident, "ok": False, "error": str(error)}
    return {"id": ident, "ok": True, "raw": raw}


def reply_for_line(llm, line: str) -> dict | None:
    if not line.strip():
        return None
    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        return {"ok": False, "error": "The request was not JSON."}
    if not isinstance(request, dict):
        return {"ok": False, "error": "The request was not a JSON object."}
    return handle(llm, request)


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()


def serve() -> int:
    path = hypnos.model_path()
    emit({"event": "loading", "model": path})
    try:
        from llama_cpp import Llama
    except ImportError:
        emit({"event": "error", "error": "llama-cpp-python is not installed. pip install llama-cpp-python"})
        return 1
    if not Path(path).is_file():
        emit({"event": "error", "error": f"Model file not found: {path}"})
        return 1
    try:
        llm, layers = load_model(Llama, path)
    except Exception as error:
        emit({"event": "error", "error": str(error)})
        return 1
    emit({"event": "ready", "model": path, "gpu_layers": layers})
    for line in sys.stdin:
        reply = reply_for_line(llm, line)
        if reply is not None:
            emit(reply)
    return 0


if __name__ == "__main__":
    sys.exit(serve())
