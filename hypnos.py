"""Hypnos writes each NPC's memory file from their log.

The memory is a short recollection of Null's visit, taken from the log.

    python hypnos.py
    python hypnos.py --npc old-coil
    python hypnos.py --dry-run
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


def life_brief(person: dict) -> str:
    script = person["script"]
    role = person["role"] or {}
    lines = [
        f"Name: {script.get('name', person['id'])}",
        f"Id: {person['id']}",
        f"Room: {person.get('room') or 'unknown'}",
        f"Presence: {script.get('presence', '')}",
        f"Greeting: {script.get('greeting', '')}",
    ]
    topics = script.get("topics") or {}
    if topics:
        lines.append("Topics: " + ", ".join(topics))
    shop = script.get("shop") or {}
    if shop:
        sells = ", ".join(shop.get("sells") or []) or "nothing"
        buys = ", ".join(shop.get("buys") or []) or "nothing"
        lines.append(f"Sells: {sells}. Buys: {buys}.")
    prompt = str(role.get("prompt") or "").strip()
    if prompt:
        lines.extend(["", "ROLE", prompt])
    objectives = role.get("objectives") or []
    if objectives:
        lines.extend(["", "OBJECTIVES"])
        for item in objectives:
            flag = item.get("flag", "")
            goal = item.get("goal", "")
            lines.append(f"- {flag}: {goal}")
    return "\n".join(lines)


def clip_log(log: str, limit: int = LOG_LIMIT) -> str:
    lines = [line for line in log.splitlines() if line.strip()]
    if len(lines) <= limit:
        return "\n".join(lines)
    omitted = len(lines) - limit
    kept = "\n".join(lines[-limit:])
    return f"(Earlier log lines omitted: {omitted}.)\n{kept}"


def hypnos_prompt(person: dict, old_memory: str, log: str) -> str:
    script = person["script"]
    name = str(script.get("name") or person["id"])
    remembered = old_memory.strip() or "(none)"
    seen = clip_log(log) or "(nothing)"
    return "\n".join(
        [
            "/no_think",
            f"Write what {name} remembers about Null's visit.",
            "This text is pasted into their prompt before they speak.",
            "Use I for yourself and he for Null.",
            "Short sentences, as if telling a friend who stopped by.",
            "Null came by. If he said hello or thank you, he was polite. Do not give him your mood, and do not invent his voice.",
            "He asked only what his own words ask. Then one sentence: I told him the answer. Do not copy the speech. Then where he went. If he came back, say he came back.",
            "Go through the log in order. Include every visit, question, answer, trade, and leaving.",
            "Do not describe your clothes, your post, or your duties.",
            "Do not invent places, prices, items, or visits.",
            "Keep what MEMORY already has. Add what the log adds. Drop what the log undid.",
            'Reply with JSON only: {"memory": "the sentences"}',
            "",
            "LOG",
            seen,
            "",
            "MEMORY",
            remembered,
            "",
            "LIFE",
            "Use this only to keep names straight. Do not retell it.",
            life_brief(person),
        ]
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
        "think": False,
        "keep_alive": "10m",
        "format": MEMORY_SCHEMA,
        "options": {"temperature": 0.3, "num_predict": 500},
        "messages": [
            {
                "role": "system",
                "content": "Retell the log as a short memory of Null's visit. Use I and he. No quotes. No character description.",
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
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as error:
        raise RuntimeError(
            f"Ollama did not answer. Is it running {MODEL}? {error.reason}"
        ) from error
    message = payload.get("message") or {}
    if not isinstance(message, dict):
        return ""
    return message_memory(message)


_ASIDE = re.compile(r"(?i)^(not|just)\b")
_IMPERATIVE = re.compile(
    r"^(Go|Kneel|Listen|Take|Save|Come|Wait|Leave|Bring|Hold|Keep|Give|Put|Look|Stay|Stop|Remember)\b"
)
_PRESENT = {"have": "has", "are": "is", "do": "does", "go": "goes"}
_PAST = {
    "ask": "asked",
    "sell": "sold",
    "have": "had",
    "are": "were",
    "is": "was",
    "do": "did",
    "go": "went",
    "come": "came",
    "say": "said",
    "tell": "told",
    "know": "knew",
    "get": "got",
    "leave": "left",
}


def third_person(verb: str) -> str:
    word = verb.lower()
    if word in _PRESENT:
        return _PRESENT[word]
    if word.endswith(("s", "ch", "sh", "x", "z")):
        return word + "es"
    if word.endswith("y") and len(word) > 1 and word[-2] not in "aeiou":
        return word[:-1] + "ies"
    return word + "s"


def past_tense(verb: str) -> str:
    word = verb.lower()
    if word in _PAST:
        return _PAST[word]
    if word.endswith("e"):
        return word + "d"
    if word.endswith("y") and len(word) > 1 and word[-2] not in "aeiou":
        return word[:-1] + "ied"
    return word + "ed"


def flip_rest(text: str) -> str:
    flipped = re.sub(r"(?i)\byourself\b", "himself", text)
    flipped = re.sub(r"(?i)\byou're\b", "he is", flipped)
    flipped = re.sub(r"(?i)\byou are\b", "he is", flipped)
    flipped = re.sub(r"(?i)\byour\b", "his", flipped)

    def you_verb(match: re.Match[str]) -> str:
        return "he " + third_person(match.group(1)) + match.group(2)

    flipped = re.sub(r"(?i)\byou (\w+)(.*)", you_verb, flipped)
    return re.sub(r"(?i)\byou\b", "him", flipped)


def flip_listener(text: str) -> str:
    leading = re.match(r"(?i)^you(?:'re| are) (.+)$", text)
    if leading:
        return "that he was " + flip_rest(leading.group(1))
    leading_verb = re.match(r"(?i)^you (\w+)(.*)$", text)
    if leading_verb:
        return "that he " + past_tense(leading_verb.group(1)) + flip_rest(leading_verb.group(2))
    return flip_rest(text)


def split_sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part.strip()]


def join_and(parts: list[str]) -> str:
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]}, and {parts[1]}"
    return ", ".join(parts[:-1]) + ", and " + parts[-1]


def soften(bit: str) -> str:
    if not bit or bit.startswith(("to ", "that ")):
        return bit
    return bit[0].lower() + bit[1:]


def worth_keeping(sentence: str) -> int:
    score = 2 if _IMPERATIVE.match(sentence) else 0
    if re.search(r"(?i)\b(sells?|market|gate|chapel|ash|metals?|scrip|credit)\b", sentence):
        score += 2
    return score


def report_clause(sentence: str) -> str | None:
    bare = sentence.strip().rstrip(".!?")
    if not bare or re.fullmatch(r"(?i)null", bare):
        return None
    if _ASIDE.match(bare) and len(bare.split()) <= 4:
        return None
    told = flip_listener(bare)
    if _IMPERATIVE.match(bare):
        told = "to " + told[0].lower() + told[1:]
        told = re.sub(r", (listen|kneel|wait|look)$", r", and \1", told, flags=re.IGNORECASE)
    return told


def told_him(speech: str) -> str:
    pairs = []
    for sentence in split_sentences(speech):
        bare = sentence.strip().rstrip(".!?")
        bit = report_clause(sentence)
        if bit:
            pairs.append((bare, bit))
    if not pairs:
        return ""
    if len(pairs) > 4:
        picked = {id(pairs[0])}
        rest = sorted(pairs[1:], key=lambda item: worth_keeping(item[0]), reverse=True)
        for item in rest:
            if len(picked) >= 4:
                break
            if worth_keeping(item[0]) > 0:
                picked.add(id(item))
        pairs = [item for item in pairs if id(item) in picked]
    return "I told him " + join_and([soften(bit) for _, bit in pairs]) + "."


def room_said(speech: str) -> str:
    sentences = split_sentences(speech)
    pointed = [
        sentence
        for sentence in sentences
        if _IMPERATIVE.match(sentence.rstrip(".!?")) or re.search(r"(?i)\b(word|both|metals)\b", sentence)
    ]
    chosen = pointed if len(speech.split()) > 40 and pointed else sentences
    bits: list[str] = []
    for sentence in chosen:
        bare = sentence.strip().rstrip(".!?")
        if not bare or (_ASIDE.match(bare) and len(bare.split()) <= 4):
            continue
        told = flip_listener(bare)
        if _IMPERATIVE.match(bare):
            told = "to " + told[0].lower() + told[1:]
        bits.append(soften(told))
    if not bits:
        return "The room spoke."
    return "The room said " + join_and(bits) + "."


def indirect_question(question: str) -> str:
    asked = question[:-1].strip() if question.endswith("?") else question.strip()
    are_you = re.match(r"(?i)^are you (.+)$", asked)
    if are_you:
        return "if I was " + are_you.group(1)
    do_you = re.match(r"(?i)^do you (.+)$", asked)
    if do_you:
        return "if I " + do_you.group(1)
    could_be = re.match(r"(?i)^could (.+?) be (.+)$", asked)
    if could_be:
        return f"if {could_be.group(1)} could be {could_be.group(2)}"
    can_i = re.match(r"(?i)^can i (.+)$", asked)
    if can_i:
        return "if he could " + can_i.group(1)
    return asked[0].lower() + asked[1:] if asked else asked


def null_speech(utterance: str) -> list[str]:
    raw = utterance.strip()
    if re.fullmatch(r"(?i)thanks?[.!]?", raw) or re.fullmatch(r"(?i)thank you[.!]?", raw):
        return ["He thanked me."]
    body = re.sub(r"(?i)^(hello|hi),?\s+[^,.!]{1,40}[.,]\s*", "", raw).strip()
    body = re.sub(r"^[A-Z][\w' -]{0,30},\s*", "", body).strip()
    if re.fullmatch(r"(?i)(hello|hi|thanks?|thank you)[.!]?", body) or not body:
        return []
    if re.fullmatch(r"(?i)thanks?[.!]?", body) or re.fullmatch(r"(?i)thank you[.!]?", body):
        return ["He thanked me."]
    if body.endswith("?"):
        return [f"He asked {indirect_question(body)}."]
    said = flip_listener(body.rstrip(".!"))
    return [f"He said {said[0].lower() + said[1:]}."]


def retell_line(line: str, arrived: bool) -> tuple[list[str], bool]:
    arrive = re.match(r"^Null comes into the (.+)\.$", line)
    if arrive:
        if arrived:
            return ["He came back."], True
        return ["Null came by."], True
    said = re.match(r'^Null says "(.*)"$', line)
    if said:
        return null_speech(said.group(1)), arrived
    reply = re.match(r'^I reply "(.*)"$', line)
    if reply:
        told = told_him(reply.group(1))
        return ([told] if told else []), arrived
    other = re.match(r'^(.+) replies "(.*)"$', line)
    if other:
        return [f"{other.group(1)} spoke."], arrived
    goes = re.match(r"^Null (goes|flees) (\w+)\.$", line)
    if goes:
        verb = "fled" if goes.group(1) == "flees" else "went"
        return [f"He {verb} {goes.group(2)}."], arrived
    tried = re.match(r"^Null tries to go (\w+)\.$", line)
    if tried:
        return [f"He tried to go {tried.group(1)}."], arrived
    simple = {
        "Null listens.": "He listened.",
        "Null searches.": "He searched.",
        "Null waits.": "He waited.",
        "Null falls.": "He fell.",
        "Null looks around.": "He looked around.",
        "Null looks at himself.": "He looked at himself.",
        "Null looks over the wares.": "He looked over the wares.",
        "Null swings at nothing.": "He swung at nothing.",
        "Null tries to flee.": "He tried to flee.",
    }
    if line in simple:
        return [simple[line]], arrived
    room = re.match(r'^The room says "(.*)"$', line)
    if room:
        return [room_said(room.group(1))], arrived
    trade = re.match(r"^Trade happens - (.+)\.$", line)
    if trade:
        return [f"We traded {trade.group(1)}."], arrived
    door = re.match(r"^Door to (\w+) opens\.$", line)
    if door:
        return [f"The door to the {door.group(1)} opened."], arrived
    takes = re.match(r"^Null takes (.+)\.$", line)
    if takes:
        return [f"He took {takes.group(1)}."], arrived
    drops = re.match(r"^Null drops (.+)\.$", line)
    if drops:
        return [f"He dropped {drops.group(1)}."], arrived
    uses = re.match(r"^Null uses (.+)\.$", line)
    if uses:
        return [f"He used {uses.group(1)}."], arrived
    finds = re.match(r"^Null finds (.+)\.$", line)
    if finds:
        return [f"He found {finds.group(1)}."], arrived
    looks = re.match(r"^Null looks at (.+)\.$", line)
    if looks:
        return [f"He looked at {looks.group(1)}."], arrived
    gives = re.match(r"^I give Null (.+)\.$", line)
    if gives:
        return [f"I gave him {gives.group(1)}."], arrived
    pays = re.match(r"^Null pays me (\d+) scrip\.$", line)
    if pays:
        return [f"He paid me {pays.group(1)} scrip."], arrived
    offers = re.match(r"^Null offers (.+) to me\.$", line)
    if offers:
        return [f"He offered me {offers.group(1)}."], arrived
    hands = re.match(r"^Null hands over (.+)\.$", line)
    if hands:
        return [f"He handed over {hands.group(1)}."], arrived
    talks = re.match(r"^Null talks to me(?: about (.+))?\.$", line)
    if talks:
        about = f" about {talks.group(1)}" if talks.group(1) else ""
        return [f"He talked to me{about}."], arrived
    if not line:
        return [], arrived
    leftover = re.sub(r"^Null\b", "He", line).rstrip(".")
    return [leftover + "."], arrived


def since_marker(log: str) -> str:
    lines = log.splitlines()
    last = -1
    for index, line in enumerate(lines):
        if line.strip() == MARKER:
            last = index
    if last < 0:
        return log
    return "\n".join(lines[last + 1 :])


def retell_log(log: str) -> str:
    lines = [line.strip() for line in log.splitlines() if line.strip() and line.strip() != MARKER]
    polite = any(re.search(r"(?i)\b(hello|hi|thanks|thank you|please)\b", line) for line in lines)
    sentences: list[str] = []
    arrived = False
    told: list[str] = []
    nice = False
    for line in lines:
        batch, arrived = retell_line(line, arrived)
        for sentence in batch:
            if sentence == "Null came by." and polite and not nice:
                sentences.append(sentence)
                sentences.append("He was nice.")
                nice = True
                continue
            if sentence.startswith("I told him "):
                core = sentence.removeprefix("I told him ").rstrip(".")
                if any(core in earlier for earlier in told):
                    continue
                told.append(sentence)
            sentences.append(sentence)
    return " ".join(sentences)


def update_person(person: dict, journals: Path, dry_run: bool = False) -> str | None:
    name = str(person["script"].get("name") or person["id"])
    path = log_path(journals, name)
    raw = read_text(path)
    fresh = since_marker(raw).strip()
    if not fresh:
        return None
    updated = retell_log(fresh)
    if not updated:
        raise RuntimeError(f"{name}: the log has no memory in it")
    had_marker = any(line.strip() == MARKER for line in raw.splitlines())
    old = read_text(memory_path(journals, name)).strip()
    if had_marker and old:
        updated = f"{old}\n{updated}"
    if dry_run:
        return updated
    journals.mkdir(parents=True, exist_ok=True)
    memory_path(journals, name).write_text(updated + "\n", encoding="utf-8")
    text = raw if raw.endswith("\n") or not raw else raw + "\n"
    path.write_text(text + MARKER + "\n", encoding="utf-8")
    return updated


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write each NPC memory file from their log.")
    parser.add_argument("--npc", help="Update only this npc id")
    parser.add_argument("--dry-run", action="store_true", help="Print the memory and do not write it")
    args = parser.parse_args(argv)
    people = load_npcs()
    if args.npc:
        people = [person for person in people if person["id"] == args.npc]
        if not people:
            print(f"No NPC named {args.npc}.", file=sys.stderr)
            return 1
    for person in people:
        name = str(person["script"].get("name") or person["id"])
        try:
            result = update_person(person, JOURNALS, dry_run=args.dry_run)
        except RuntimeError as error:
            print(str(error), file=sys.stderr)
            return 1
        if result is None:
            print(f"{name}: nothing new, memory left as it is")
            continue
        if args.dry_run:
            print(f"--- {name} ---")
            print(result)
            print()
            continue
        print(f"{name}: wrote {memory_path(JOURNALS, name)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
