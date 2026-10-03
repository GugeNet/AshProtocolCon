"""Hypnos compresses each person's memory during a sleep cycle.

The model reads the old memory and the log lines after the last marker, and
its response is one new first-person memory. Read-only prints the memory and
the log and writes nothing.

    python hypnos.py
    python hypnos.py --npc old-coil
    python hypnos.py --npc null
    python hypnos.py --dry-run
    python hypnos.py --read-only --npc old-coil
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CARTRIDGE = ROOT / "public" / "ash"
JOURNALS = ROOT / "journals"
OLLAMA = "http://127.0.0.1:11434/api/chat"
MODEL = "qwen3:4b"
LOG_LIMIT = 200
MARKER = "--- hypnos ---"
PLAYER_ID = "null"


def person_file_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(". ")
    if not cleaned or cleaned in {".", ".."}:
        return "unnamed"
    return cleaned


def log_path(journals: Path, name: str) -> Path:
    return journals / f"{person_file_name(name)}.log"


def memory_path(journals: Path, name: str) -> Path:
    return journals / f"{person_file_name(name)}.memory.txt"


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def load_npcs(cartridge: Path = CARTRIDGE) -> list[dict]:
    npc_root = cartridge / "npcs"
    rooms_root = cartridge / "rooms"
    rooms: list[dict] = []
    if rooms_root.exists():
        for path in sorted(rooms_root.glob("*.json")):
            rooms.append(json.loads(path.read_text(encoding="utf-8")))
    people: list[dict] = []
    if not npc_root.exists():
        return people
    for folder in sorted(path for path in npc_root.iterdir() if path.is_dir()):
        script_path = folder / "script.json"
        if not script_path.exists():
            continue
        script = json.loads(script_path.read_text(encoding="utf-8"))
        state_path = folder / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
        role_path = folder / "role.json"
        role = json.loads(role_path.read_text(encoding="utf-8")) if role_path.exists() else {}
        room_name = ""
        for room in rooms:
            if folder.name in (room.get("npcs") or []):
                room_name = str(room.get("name") or room.get("id") or "")
                break
        people.append(
            {
                "id": folder.name,
                "script": script,
                "state": state,
                "role": role,
                "room": room_name,
            }
        )
    return people


def player_person() -> dict:
    return {
        "id": PLAYER_ID,
        "player": True,
        "script": {
            "name": "Null",
            "presence": "Null, a silt-runner.",
            "greeting": "",
            "topics": {},
        },
        "state": {},
        "role": {
            "prompt": (
                "Null remembers what he did and what he heard. "
                "Use I. Do not describe his clothes, his optic, or his job. "
                "Do not invent places, prices, items, or visits."
            )
        },
        "room": "",
    }


def load_people(cartridge: Path = CARTRIDGE) -> list[dict]:
    return [*load_npcs(cartridge), player_person()]


def clip_log(log: str, limit: int = LOG_LIMIT) -> str:
    lines = [line for line in log.splitlines() if line.strip()]
    if len(lines) <= limit:
        return "\n".join(lines)
    omitted = len(lines) - limit
    kept = "\n".join(lines[-limit:])
    return f"(Earlier log lines omitted: {omitted}.)\n{kept}"


def compose_prompt(speaker: str, voice: str, old_memory: str, log: str) -> str:
    remembered = old_memory.strip() or "(none yet)"
    seen = clip_log(log).strip() or "(nothing new)"
    return "\n".join(
        [
            f"Write {speaker}'s new memory.",
            voice,
            "You are given the old memory and the log of what happened since the last sleep.",
            "Compress both into one new memory. Keep the facts that still matter. Fold the new log into the old memory. Drop repeated steps and wording that does not change what is remembered.",
            "The new memory replaces the old one. It is the whole recollection, not a note about the log and not a list of edits.",
            "Write it in the first person, the way a person remembers, in a few short sentences.",
            "Do not invent places, prices, items, or events. Do not copy the log line by line.",
            "Do not include reasoning, a plan, a heading, or a description of clothes, duties, or the job.",
            "Your response must be in the form of a new memory. The response is that memory, not a reply about it.",
            'Put the new memory here and nowhere else: {"memory": "the new memory"}',
            "",
            "OLD MEMORY",
            remembered,
            "",
            "NEW LOG",
            seen,
        ]
    )


def hypnos_prompt(person: dict, old_memory: str, log: str) -> str:
    name = str(person["script"].get("name") or person["id"])
    return compose_prompt(
        name,
        f"You are {name}. Use I for yourself and he for Null. Say Null's name.",
        old_memory,
        log,
    )


def player_prompt(old_memory: str, log: str) -> str:
    return compose_prompt(
        "Null",
        "You are Null. Use I for yourself. Other people keep their names.",
        old_memory,
        log,
    )


_SCRATCH = re.compile(
    r"(?is)("
    r"<think>|"
    r"you are hypnos|"
    r"\bwe are writing\b|"
    r"\bwe must write\b|"
    r"\bthe memory (we|must)\b|"
    r"memory they already have|"
    r"log of what they saw|"
    r"thinking process|"
    r"^\s*steps\s*:"
    r"|\bold memory\b"
    r"|\bnew log\b"
    r"|\bthe new memory\b"
    r")"
)

MEMORY_SCHEMA = {
    "type": "object",
    "properties": {"memory": {"type": "string"}},
    "required": ["memory"],
}


def strip_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[a-zA-Z]*\n?", "", stripped)
        stripped = re.sub(r"\n?```$", "", stripped).strip()
    return stripped


def memory_from_json(text: str) -> str | None:
    candidates = [text]
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            row = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict) and isinstance(row.get("memory"), str):
            return row["memory"]
    return None


def clean_memory(text: str) -> str:
    stripped = re.sub(r"(?is)<think>.*?</think>", "", text)
    unclosed = re.search(r"(?i)<think>", stripped)
    if unclosed:
        stripped = stripped[: unclosed.start()]
    stripped = strip_fences(stripped)
    from_json = memory_from_json(stripped)
    if from_json is not None:
        stripped = from_json
    elif stripped.lstrip().startswith("{"):
        return ""
    stripped = re.sub(r"(?i)^memory\s*:\s*", "", stripped.strip()).strip()
    stripped = re.sub(
        r"(?is)^(here is|here's|this is)\s+(the\s+)?(new\s+)?memory[:,]?\s*",
        "",
        stripped,
    ).strip()
    if not stripped or _SCRATCH.search(stripped):
        return ""
    return stripped


def message_memory(message: dict) -> str:
    return clean_memory(str(message.get("content") or ""))


def visit_memory(text: str, log: str) -> str:
    memory = clean_memory(text)
    if not memory:
        return ""
    if "Null" in log and "Null" not in memory:
        return ""
    return memory


def kept_memory(text: str, log: str, player: bool) -> str:
    memory = clean_memory(text) if player else visit_memory(text, log)
    if not memory or not re.search(r"\bI\b", memory):
        return ""
    return memory


def word_runs(text: str, size: int = 10) -> set[str]:
    words = re.findall(r"[a-z0-9']+", text.lower())
    return {" ".join(words[i : i + size]) for i in range(max(0, len(words) - size + 1))}


def pastes_log(memory: str, log: str) -> bool:
    logged = word_runs(log)
    if not logged:
        return False
    return bool(word_runs(memory) & logged)


def chat_body(prompt: str) -> dict:
    return {
        "model": MODEL,
        "stream": False,
        "think": True,
        "keep_alive": "10m",
        "format": MEMORY_SCHEMA,
        "options": {"temperature": 0.3, "num_predict": 1024},
        "messages": [
            {
                "role": "system",
                "content": (
                    "Compose one new first-person memory from an old memory and a new log. "
                    "Your response is that new memory, in the memory field, with no reasoning."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }


def ask_ollama(prompt: str) -> str:
    body = json.dumps(chat_body(prompt)).encode("utf-8")
    request = urllib.request.Request(
        OLLAMA,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        reason = getattr(error, "reason", None) or error
        raise RuntimeError(
            f"Ollama did not answer. Is it running {MODEL}? {reason}"
        ) from error
    message = payload.get("message") or {}
    if not isinstance(message, dict):
        return ""
    return message_memory(message)


def since_marker(log: str) -> str:
    lines = log.splitlines()
    last = -1
    for index, line in enumerate(lines):
        if line.strip() == MARKER:
            last = index
    if last < 0:
        return log
    return "\n".join(lines[last + 1 :])


def update_person(person: dict, journals: Path, dry_run: bool = False, ask=None) -> str | None:
    name = str(person["script"].get("name") or person["id"])
    path = log_path(journals, name)
    raw = read_text(path)
    fresh = since_marker(raw).strip()
    if not fresh:
        return None
    old = read_text(memory_path(journals, name)).strip()
    player = bool(person.get("player"))
    prompt = player_prompt(old, fresh) if player else hypnos_prompt(person, old, fresh)
    reply = (ask or ask_ollama)(prompt)
    updated = kept_memory(str(reply or ""), fresh, player)
    if not updated:
        raise RuntimeError(f"{name}: the model did not return a memory")
    updated = re.sub(r"\n{3,}", "\n\n", updated).strip()
    if dry_run:
        return updated
    journals.mkdir(parents=True, exist_ok=True)
    memory_path(journals, name).write_text(updated + "\n", encoding="utf-8")
    text = raw if raw.endswith("\n") or not raw else raw + "\n"
    path.write_text(text + MARKER + "\n", encoding="utf-8")
    return updated


def read_person(person: dict, journals: Path) -> dict:
    name = str(person["script"].get("name") or person["id"])
    raw = read_text(log_path(journals, name))
    lines = [line for line in raw.splitlines() if line.strip() and line.strip() != MARKER]
    return {
        "id": person["id"],
        "name": name,
        "memory": read_text(memory_path(journals, name)).strip(),
        "log": clip_log("\n".join(lines)),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compress each person's memory from the old memory and the new log.")
    parser.add_argument("--npc", help="Update only this person id. Use null for the player.")
    parser.add_argument("--dry-run", action="store_true", help="Print the memory and do not write it")
    parser.add_argument(
        "--read-only",
        action="store_true",
        help="Print the memory and the log as JSON. Write nothing.",
    )
    args = parser.parse_args(argv)
    people = load_people()
    if args.read_only:
        if not args.npc:
            print("Read-only needs --npc.", file=sys.stderr)
            return 1
        chosen = [person for person in people if person["id"] == args.npc]
        if not chosen:
            print(f"No one named {args.npc}.", file=sys.stderr)
            return 1
        print(json.dumps(read_person(chosen[0], JOURNALS), ensure_ascii=False))
        return 0
    if args.npc:
        people = [person for person in people if person["id"] == args.npc]
        if not people:
            print(f"No NPC named {args.npc}.", file=sys.stderr)
            return 1
    failed = False
    for person in people:
        name = str(person["script"].get("name") or person["id"])
        try:
            result = update_person(person, JOURNALS, dry_run=args.dry_run)
        except RuntimeError as error:
            print(str(error), file=sys.stderr)
            failed = True
            continue
        if result is None:
            print(f"{name}: nothing new, memory left as it is")
            continue
        if args.dry_run:
            print(f"--- {name} ---")
            print(result)
            print()
            continue
        print(f"{name}: wrote {memory_path(JOURNALS, name)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
