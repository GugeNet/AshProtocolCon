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
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CARTRIDGE = ROOT / "public" / "ash"
JOURNALS = ROOT / "journals"
DEFAULT_MODEL = r"C:\Users\Geir Gundersen\OneDrive\models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
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
    return journals / f"{person_file_name(name)}.memory.json"


def legacy_memory_path(journals: Path, name: str) -> Path:
    return journals / f"{person_file_name(name)}.memory.txt"


def model_path() -> str:
    return os.environ.get("ASH_MODEL") or DEFAULT_MODEL


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def read_memory(journals: Path, name: str) -> str:
    path = memory_path(journals, name)
    if path.exists():
        try:
            row = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return ""
        if isinstance(row, dict) and isinstance(row.get("memory"), str):
            return row["memory"]
        return ""
    return read_text(legacy_memory_path(journals, name))


def write_memory(journals: Path, name: str, text: str) -> None:
    memory_path(journals, name).write_text(
        json.dumps({"memory": text}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


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


# "Trade happens - A for B" means Null gave A and received B.
# A sleeper who writes "I" reads that as their own trade and swaps the items.
_TRADE_LINE = re.compile(r"^Trade happens - (?P<gave>.+?) for (?P<got>.+?)\.$", re.IGNORECASE)
_NOUN = r"[A-Za-z0-9'-]+(?:\s+[A-Za-z0-9'-]+){0,3}?"
_KEPT_PREP = r"(?:his |her |their |the |a |an )?"
_GAVE_PREP = r"(?:(?:him |her |them |Null )?(?:the |a |an |his )?)"
_TOOK_GAVE = re.compile(
    rf"\bI took (?P<kprep>{_KEPT_PREP})(?P<kept>{_NOUN})(?P<join>,? and )gave (?P<gprep>{_GAVE_PREP})(?P<gave>{_NOUN})",
    re.IGNORECASE,
)
_GAVE_TOOK = re.compile(
    rf"\bI gave (?P<gprep>{_GAVE_PREP})(?P<gave>{_NOUN})(?P<join>,? and )took (?P<kprep>{_KEPT_PREP})(?P<kept>{_NOUN})",
    re.IGNORECASE,
)


def _scrip(text: str) -> bool:
    return bool(re.search(r"\bscrip\b", text, re.IGNORECASE))


def gloss_trade_line(line: str, player: bool) -> str:
    match = _TRADE_LINE.match(line.strip())
    if not match or _scrip(match.group("gave")) or _scrip(match.group("got")):
        return line
    gave = match.group("gave").strip()
    got = match.group("got").strip()
    if player:
        return f"I hand over the {gave} and receive the {got}."
    return f"Null hands over the {gave} and receives the {got}."


def gloss_log(log: str, player: bool) -> str:
    return "\n".join(gloss_trade_line(line, player) if line.strip() else line for line in log.splitlines())


def trade_hint(log: str, player: bool) -> str:
    has_trade = re.search(r"\bhands over the\b|\bhand over the\b", log, re.IGNORECASE)
    has_exchange = re.search(r"\bI took\b[^\n]+?\band gave\b|\bI gave\b[^\n]+?\band took\b", log, re.IGNORECASE)
    if not has_trade and not has_exchange:
        return ""
    if player:
        direction = "You hand over A and receive B means you gave A away and left with B."
    else:
        direction = "Null hands over A and receives B means he gave A away and left with B. It does not mean you gave A or took B."
    return " ".join(
        [
            "An unquoted line is what happened. A quoted line is only what was said.",
            "Believe the unquoted line about who held an item.",
            direction,
            "If you took one item and gave another, keep that direction. Do not swap the two items.",
        ]
    )


def _unquoted(text: str) -> str:
    text = re.sub(r"“[^”]*”", " ", text)
    return re.sub(r'"[^"]*"', " ", text)


def _item_words(phrase: str) -> list[str]:
    phrase = re.sub(r"^(his|her|their|the|a|an|my|your)\s+", "", phrase.lower().strip())
    words = re.findall(r"[a-z0-9']+", phrase)

    def stem(word: str) -> str:
        if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            return word[:-1]
        return word

    return [stem(word) for word in words]


def _same_item(left: str, right: str) -> bool:
    aw = _item_words(left)
    bw = _item_words(right)
    if not aw or not bw:
        return False
    if aw == bw:
        return True
    smaller, larger = (aw, bw) if len(aw) <= len(bw) else (bw, aw)
    if not set(smaller) <= set(larger):
        return False
    return smaller[0] == larger[0] or smaller[-1] == larger[-1]


def exchange_facts(log: str, player: bool = False) -> list[tuple[str, str]]:
    """Pairs of (item kept, item given away) in the sleeper's own words."""
    bare = _unquoted(log)
    facts: list[tuple[str, str]] = []
    for match in _TOOK_GAVE.finditer(bare):
        facts.append((match.group("kept"), match.group("gave")))
    for match in _GAVE_TOOK.finditer(bare):
        facts.append((match.group("kept"), match.group("gave")))
    if player:
        for line in bare.splitlines():
            match = _TRADE_LINE.match(line.strip())
            if not match or _scrip(match.group("gave")) or _scrip(match.group("got")):
                continue
            facts.append((match.group("got"), match.group("gave")))
    return facts


def _reversed_exchange(kept: str, gave: str, facts: list[tuple[str, str]]) -> bool:
    aligned = any(_same_item(kept, fact_kept) and _same_item(gave, fact_gave) for fact_kept, fact_gave in facts)
    if aligned:
        return False
    return any(_same_item(kept, fact_gave) and _same_item(gave, fact_kept) for fact_kept, fact_gave in facts)


def _swap_nouns(match: re.Match) -> str:
    text = match.group(0)
    base = match.start()
    spans = [
        (match.start("gave") - base, match.end("gave") - base, match.group("kept")),
        (match.start("kept") - base, match.end("kept") - base, match.group("gave")),
    ]
    for start, end, replacement in sorted(spans, key=lambda span: span[0], reverse=True):
        text = text[:start] + replacement + text[end:]
    return text


def _quoted_spans(text: str) -> list[tuple[int, int]]:
    return [match.span() for match in re.finditer(r'"[^"]*"|“[^”]*”', text)]


def settle_exchanges(memory: str, log: str, player: bool = False) -> str:
    facts = exchange_facts(log, player)
    if not facts or not memory:
        return memory
    quotes = _quoted_spans(memory)
    matches = []
    for pattern in (_TOOK_GAVE, _GAVE_TOOK):
        for match in pattern.finditer(memory):
            if any(start <= match.start() < end for start, end in quotes):
                continue
            if _reversed_exchange(match.group("kept"), match.group("gave"), facts):
                matches.append(match)
    if not matches:
        return memory
    text = memory
    for match in sorted(matches, key=lambda item: item.start(), reverse=True):
        text = text[: match.start()] + _swap_nouns(match) + text[match.end() :]
    return text


def compose_prompt(speaker: str, voice: str, old_memory: str, log: str, player: bool) -> str:
    remembered = old_memory.strip() or "(none yet)"
    seen = clip_log(log).strip() or "(nothing new)"
    lines = [
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
    ]
    hint = trade_hint(seen, player)
    if hint:
        lines.append(hint)
    lines.extend(["", "OLD MEMORY", remembered, "", "NEW LOG", seen])
    return "\n".join(lines)


def hypnos_prompt(person: dict, old_memory: str, log: str) -> str:
    name = str(person["script"].get("name") or person["id"])
    return compose_prompt(
        name,
        f"You are {name}. Use I for yourself and he for Null. Say Null's name.",
        old_memory,
        gloss_log(log, False),
        False,
    )


def player_prompt(old_memory: str, log: str) -> str:
    return compose_prompt(
        "Null",
        "You are Null. Use I for yourself. Other people keep their names.",
        old_memory,
        gloss_log(log, True),
        True,
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
        "temperature": 0.3,
        "max_tokens": 1024,
        "response_format": {"type": "json_object", "schema": MEMORY_SCHEMA},
        "messages": [
            {
                "role": "system",
                "content": (
                    "Compose one new first-person memory from an old memory and a new log. "
                    "Your response is that new memory, in the memory field, with no reasoning. "
                    "Do not reverse who gave an item and who received it."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }


_LLM = None


def ask_model(prompt: str) -> str:
    global _LLM
    try:
        from llama_cpp import Llama
    except ImportError as error:
        raise RuntimeError(
            "llama-cpp-python is not installed. pip install llama-cpp-python"
        ) from error
    path = model_path()
    if not Path(path).is_file():
        raise RuntimeError(f"Model file not found: {path}")
    if _LLM is None:
        last = None
        for layers in (-1, 0):
            try:
                _LLM = Llama(
                    model_path=path,
                    n_ctx=8192,
                    n_gpu_layers=layers,
                    verbose=False,
                )
                break
            except Exception as error:
                last = error
                _LLM = None
        if _LLM is None:
            raise RuntimeError(f"The model did not load. {last}") from last
    body = chat_body(prompt)
    try:
        result = _LLM.create_chat_completion(
            messages=body["messages"],
            temperature=body["temperature"],
            max_tokens=body["max_tokens"],
            response_format={"type": "json_object"},
        )
    except TypeError:
        result = _LLM.create_chat_completion(
            messages=body["messages"],
            temperature=body["temperature"],
            max_tokens=body["max_tokens"],
        )
    choices = result.get("choices") if isinstance(result, dict) else None
    message = (choices or [{}])[0].get("message") or {}
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
    old = read_memory(journals, name).strip()
    player = bool(person.get("player"))
    prompt = player_prompt(old, fresh) if player else hypnos_prompt(person, old, fresh)
    reply = (ask or ask_model)(prompt)
    updated = kept_memory(str(reply or ""), fresh, player)
    if not updated:
        raise RuntimeError(f"{name}: the model did not return a memory")
    updated = settle_exchanges(updated, raw, player)
    updated = re.sub(r"\n{3,}", "\n\n", updated).strip()
    if dry_run:
        return updated
    journals.mkdir(parents=True, exist_ok=True)
    write_memory(journals, name, updated)
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
        "memory": read_memory(journals, name).strip(),
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
