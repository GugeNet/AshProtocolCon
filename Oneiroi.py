"""Oneiroi writes one dream into a person's journal.

It asks hypnos.py, in read-only mode, for that person's memory and journal.
The model writes one dream from those two texts. The dream is appended to the
journal as one event, after whatever is already there, so the next Hypnos
sleep can fold it into long-term memory. A dry run prints the dream and
writes nothing. --prompt prints the full model prompt and does not call
the model.

Omit the name to dream for every person. Raise --temperature when the
sleeper took a hallucinogen.

    python Oneiroi.py
    python Oneiroi.py old-coil
    python Oneiroi.py "Old Coil" null
    python Oneiroi.py null --temperature 1.4
    python Oneiroi.py --dry-run --npc null
    python Oneiroi.py --prompt --npc old-coil
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

import hypnos

ROOT = Path(__file__).resolve().parent
DEFAULT_TEMPERATURE = 0.8
MAX_TEMPERATURE = 2.0

DREAM_SCHEMA = {
    "type": "object",
    "properties": {"dream": {"type": "string"}},
    "required": ["dream"],
}

_LLM = None


def read_only_command(npc_id: str) -> list[str]:
    return [sys.executable, str(ROOT / "hypnos.py"), "--read-only", "--npc", npc_id]


def parse_read_only(npc_id: str, code: int, out: str, err: str) -> dict:
    if code != 0:
        detail = err.strip() or out.strip() or f"hypnos could not read {npc_id}"
        raise RuntimeError(detail)
    try:
        row = json.loads(out.lstrip("\ufeff"))
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{npc_id}: hypnos did not return JSON") from error
    if not isinstance(row, dict):
        raise RuntimeError(f"{npc_id}: hypnos did not return a record")
    memory = row.get("memory")
    log = row.get("log")
    if not isinstance(memory, str) or not isinstance(log, str):
        raise RuntimeError(f"{npc_id}: hypnos did not return memory and log")
    return row


def read_only(npc_id: str, run=None) -> dict:
    """Run hypnos.py --read-only. That mode prints JSON and writes nothing."""
    command = read_only_command(npc_id)
    if run is None:
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        completed = subprocess.run(
            command,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            check=False,
        )
        code, out, err = completed.returncode, completed.stdout, completed.stderr
    else:
        code, out, err = run(command)
    return parse_read_only(npc_id, code, out, err)


def match_people(people: list[dict], token: str) -> list[dict]:
    key = token.casefold().strip()
    by_id = [person for person in people if str(person["id"]).casefold() == key]
    if by_id:
        return by_id
    return [
        person
        for person in people
        if str(person["script"].get("name") or "").casefold() == key
    ]


def choose(names: list[str] | None, npc: str | None = None) -> tuple[list[dict], str | None]:
    people = hypnos.load_people()
    tokens = [name for name in (names or []) if name.strip()]
    if npc and npc.strip():
        tokens.append(npc.strip())
    if not tokens:
        return people, None
    chosen: list[dict] = []
    seen: set[str] = set()
    for token in tokens:
        matched = match_people(people, token)
        if not matched:
            return [], f"No one named {token}."
        if len(matched) > 1:
            return [], f"More than one person matches {token}."
        person = matched[0]
        if person["id"] in seen:
            continue
        chosen.append(person)
        seen.add(person["id"])
    return chosen, None


def temperature_ok(value: float) -> bool:
    return math.isfinite(value) and 0.0 <= value <= MAX_TEMPERATURE


def _player(person: dict) -> bool:
    return bool(person.get("player")) or person["id"] == hypnos.PLAYER_ID


def dream_prompt(person: dict, memory: str, log: str) -> str:
    name = str(person["script"].get("name") or person["id"])
    player = _player(person)
    if player:
        voice = "You are Null. Use I for yourself. Other people keep their names."
    else:
        voice = f"You are {name}. Use I for yourself and he for Null. Say Null's name when he is in the dream."
    remembered = memory.strip() or "(none yet)"
    seen = hypnos.clip_log(hypnos.gloss_log(log, player)).strip() or "(nothing in the journal)"
    lines = [
        f"Write {name}'s dream.",
        voice,
        "You are given the memory and the journal.",
        "Write one dream this person could have while asleep. Make it from that memory and that journal.",
        "A dream may join two memories, change the hour, or repeat a place. Do not add people, places, prices, or items that are not already there.",
        "A sentence from the memory may return. Do not retell the journal in order.",
        "Write it in the first person, as the dream itself, in a few short sentences.",
        "Do not include reasoning, a plan, a heading, or a description of clothes or the job.",
        "Your response must be the dream, not a reply about it.",
        'Put the dream here and nowhere else: {"dream": "the dream"}',
    ]
    hint = hypnos.trade_hint(seen, player)
    if hint:
        lines.append(hint)
    lines.extend(["", "MEMORY", remembered, "", "JOURNAL", seen])
    return "\n".join(lines)


def dream_from_json(text: str) -> str | None:
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
        if isinstance(row, dict) and isinstance(row.get("dream"), str):
            return row["dream"]
    return None


def clean_dream(text: str) -> str:
    stripped = re.sub(r"(?is)<think>.*?</think>", "", text)
    unclosed = re.search(r"(?i)<think>", stripped)
    if unclosed:
        stripped = stripped[: unclosed.start()]
    stripped = hypnos.strip_fences(stripped)
    from_json = dream_from_json(stripped)
    if from_json is not None:
        stripped = from_json
    elif stripped.lstrip().startswith("{"):
        return ""
    stripped = re.sub(r"(?i)^dream\s*:\s*", "", stripped.strip()).strip()
    stripped = re.sub(
        r"(?is)^(here is|here's|this is)\s+(the\s+)?dream[:,]?\s*",
        "",
        stripped,
    ).strip()
    kept = hypnos.clean_memory(stripped)
    if not kept or not re.search(r"\bI\b", kept):
        return ""
    return re.sub(r"\s+", " ", kept).strip()


def copies_journal(dream: str, log: str) -> bool:
    """A remembered sentence may recur. Reject a dream that is mostly the journal."""
    dream_runs = hypnos.word_runs(dream)
    log_runs = hypnos.word_runs(log)
    if not dream_runs or not log_runs:
        return False
    return len(dream_runs & log_runs) / len(dream_runs) > 0.5


def dream_event(dream: str) -> str:
    flat = re.sub(r"\s+", " ", dream).strip()
    if not flat.endswith((".", "!", "?")):
        flat += "."
    if re.match(r"(?i)^i dream\b", flat):
        return flat
    return f"I dream. {flat}"


def chat_body(prompt: str, temperature: float) -> dict:
    return {
        "temperature": temperature,
        "max_tokens": 512,
        "response_format": {"type": "json_object", "schema": DREAM_SCHEMA},
        "messages": [
            {
                "role": "system",
                "content": (
                    "Write one first-person dream from a memory and a journal. "
                    "Your response is that dream, in the dream field, with no reasoning. "
                    "Do not add people, places, prices, or items that are not in the memory or the journal."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }


def ask_model(prompt: str, temperature: float) -> str:
    global _LLM
    try:
        from llama_cpp import Llama
    except ImportError as error:
        raise RuntimeError(
            "llama-cpp-python is not installed. pip install llama-cpp-python"
        ) from error
    path = hypnos.model_path()
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
    body = chat_body(prompt, temperature)
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
    return str(message.get("content") or "")


def sleeper_texts(person: dict, read) -> tuple[str, str]:
    name = str(person["script"].get("name") or person["id"])
    row = read(str(person["id"]))
    if not isinstance(row.get("memory"), str) or not isinstance(row.get("log"), str):
        raise RuntimeError(f"{name}: hypnos did not return memory and log")
    return row["memory"].strip(), row["log"].strip()


def full_prompt(person: dict, memory: str, log: str, temperature: float) -> str:
    user = dream_prompt(person, memory, log)
    body = chat_body(user, temperature)
    system = str(body["messages"][0]["content"])
    return "\n".join(
        [
            f"temperature: {temperature:g}",
            "",
            "SYSTEM",
            system,
            "",
            "USER",
            str(body["messages"][1]["content"]),
        ]
    )


def prompt_for(person: dict, temperature: float, read) -> str | None:
    memory, log = sleeper_texts(person, read)
    if not memory and not log:
        return None
    return full_prompt(person, memory, log, temperature)


def append_event(journals: Path, name: str, event: str) -> Path:
    journals.mkdir(parents=True, exist_ok=True)
    path = hypnos.log_path(journals, name)
    raw = hypnos.read_text(path)
    if raw and not raw.endswith("\n"):
        raw += "\n"
    path.write_text(raw + event + "\n", encoding="utf-8")
    return path


def dream_for(
    person: dict,
    journals: Path,
    temperature: float,
    dry_run: bool,
    read,
    ask,
) -> str | None:
    name = str(person["script"].get("name") or person["id"])
    memory, log = sleeper_texts(person, read)
    if not memory and not log:
        return None
    prompt = dream_prompt(person, memory, log)
    reply = ask(prompt, temperature)
    dream = clean_dream(str(reply or ""))
    if not dream:
        raise RuntimeError(f"{name}: the model did not return a dream")
    if copies_journal(dream, log):
        raise RuntimeError(f"{name}: the dream copied the journal")
    event = dream_event(dream)
    if "\n" in event or hypnos.MARKER in event:
        raise RuntimeError(f"{name}: the dream is not one journal event")
    if dry_run:
        return event
    append_event(journals, name, event)
    return event


def dream_people(
    people: list[dict],
    journals: Path,
    temperature: float,
    dry_run: bool,
    read,
    ask,
    prompt_only: bool = False,
) -> int:
    failed = False
    for person in people:
        name = str(person["script"].get("name") or person["id"])
        try:
            if prompt_only:
                result = prompt_for(person, temperature, read)
            else:
                result = dream_for(person, journals, temperature, dry_run, read, ask)
        except RuntimeError as error:
            print(str(error), file=sys.stderr)
            failed = True
            continue
        if result is None:
            print(f"{name}: nothing to dream from")
            continue
        if prompt_only or dry_run:
            print(f"--- {name} (temperature {temperature:g}) ---")
            print(result)
            print()
            continue
        print(f"{name}: wrote {hypnos.log_path(journals, name)} (temperature {temperature:g})")
    return 1 if failed else 0


def main(argv: list[str] | None = None, read=None, ask=None, journals: Path | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write one dream into each journal from the Hypnos memory and log."
    )
    parser.add_argument(
        "name",
        nargs="*",
        help="NPC id or name, or Null. Repeat it to dream for several people. Omit it to dream for everyone.",
    )
    parser.add_argument("--npc", help="One NPC id or name. null is the player. Can be combined with names.")
    parser.add_argument("--dry-run", action="store_true", help="Print the dream and write nothing.")
    parser.add_argument(
        "--prompt",
        action="store_true",
        help="Print the full model prompt from the memory and journal. Do not call the model.",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=DEFAULT_TEMPERATURE,
        help=(
            f"Sampling temperature from 0 to {MAX_TEMPERATURE:g}. "
            "Raise it when the sleeper took a hallucinogen. "
            f"Default: {DEFAULT_TEMPERATURE:g}."
        ),
    )
    args = parser.parse_args(argv)
    if not temperature_ok(args.temperature):
        print(f"Temperature must be from 0 to {MAX_TEMPERATURE:g}.", file=sys.stderr)
        return 1
    chosen, error = choose(args.name, args.npc)
    if error:
        print(error, file=sys.stderr)
        return 1
    return dream_people(
        chosen,
        journals if journals is not None else hypnos.JOURNALS,
        args.temperature,
        args.dry_run,
        read or read_only,
        ask or ask_model,
        prompt_only=args.prompt,
    )


if __name__ == "__main__":
    raise SystemExit(main())
