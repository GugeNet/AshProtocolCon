import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import hypnos
import Oneiroi


def coil() -> dict:
    return {
        "id": "old-coil",
        "script": {"name": "Old Coil"},
        "state": {},
        "role": {"prompt": "You know ASH is coughing in the chapel."},
        "room": "Silt Dock",
    }


def remembered(prompt: str, temperature: float) -> str:
    return '{"dream": "I see the dock go dark and the cable stays warm."}'


class OneiroiTests(unittest.TestCase):
    def test_read_only_command_is_hypnos_read_only(self):
        command = Oneiroi.read_only_command("old-coil")
        self.assertEqual(command[0], Oneiroi.sys.executable)
        self.assertTrue(command[1].endswith("hypnos.py"))
        self.assertEqual(command[2:], ["--read-only", "--npc", "old-coil"])

    def test_parse_read_only_rejects_a_failed_or_shapeless_reply(self):
        with self.assertRaises(RuntimeError):
            Oneiroi.parse_read_only("old-coil", 1, "", "No one named old-coil.")
        with self.assertRaises(RuntimeError):
            Oneiroi.parse_read_only("old-coil", 0, "not json", "")
        with self.assertRaises(RuntimeError):
            Oneiroi.parse_read_only("old-coil", 0, json.dumps({"memory": 1, "log": ""}), "")
        row = Oneiroi.parse_read_only(
            "old-coil",
            0,
            json.dumps({"id": "old-coil", "name": "Old Coil", "memory": "I waited.", "log": "Null waits."}),
            "",
        )
        self.assertEqual(row["memory"], "I waited.")

    def test_names_resolve_to_cartridge_people(self):
        chosen, error = Oneiroi.choose(["Old Coil"])
        self.assertIsNone(error)
        self.assertEqual([person["id"] for person in chosen], ["old-coil"])
        chosen, error = Oneiroi.choose(["null"])
        self.assertEqual(chosen[0]["id"], "null")
        self.assertTrue(chosen[0]["player"])
        chosen, error = Oneiroi.choose(["Null"], "null")
        self.assertEqual([person["id"] for person in chosen], ["null"])
        chosen, error = Oneiroi.choose(None, None)
        ids = [person["id"] for person in chosen]
        self.assertIn("old-coil", ids)
        self.assertEqual(ids[-1], "null")
        chosen, error = Oneiroi.choose(["no-such"])
        self.assertEqual(chosen, [])
        self.assertEqual(error, "No one named no-such.")

    def test_prompt_uses_the_memory_and_the_journal(self):
        prompt = Oneiroi.dream_prompt(
            coil(),
            "I already traded a stim.",
            "Trade happens - stim tab for glowcapsule.\nNull takes frayed cable.",
        )
        self.assertIn("MEMORY", prompt)
        self.assertIn("JOURNAL", prompt)
        self.assertIn("I already traded a stim.", prompt)
        self.assertIn("Null hands over the stim tab and receives the glowcapsule.", prompt)
        self.assertIn("Null takes frayed cable.", prompt)
        self.assertIn("he for Null", prompt)
        self.assertIn('{"dream": "the dream"}', prompt)
        self.assertNotIn("You know ASH is coughing in the chapel.", prompt)
        self.assertNotIn("Trade happens - stim tab for glowcapsule.", prompt)

        player = Oneiroi.dream_prompt(hypnos.player_person(), "I went north.", "I go north.")
        self.assertIn("Use I", player)
        self.assertNotIn("he for Null", player)
        self.assertIn("I went north.", player)
        self.assertIn("I go north.", player)

    def test_temperature_is_the_sampling_temperature(self):
        body = Oneiroi.chat_body("prompt", 1.4)
        self.assertEqual(body["temperature"], 1.4)
        self.assertEqual(body["max_tokens"], 512)
        self.assertEqual(body["response_format"]["schema"]["required"], ["dream"])
        self.assertIn("dream field", body["messages"][0]["content"])
        self.assertFalse(Oneiroi.temperature_ok(-0.1))
        self.assertFalse(Oneiroi.temperature_ok(2.1))
        self.assertFalse(Oneiroi.temperature_ok(float("nan")))
        self.assertTrue(Oneiroi.temperature_ok(0))
        self.assertTrue(Oneiroi.temperature_ok(2))

    def test_clean_dream_keeps_a_first_person_dream_and_drops_scratch(self):
        kept = "I see the dock go dark."
        self.assertEqual(Oneiroi.clean_dream(f'{{"dream": "{kept}"}}'), kept)
        self.assertEqual(Oneiroi.clean_dream(f"<think>plan the dream</think>\n{kept}"), kept)
        self.assertEqual(Oneiroi.clean_dream("We are writing the dream for the sleeper."), "")
        self.assertEqual(Oneiroi.clean_dream('{"memory": "I see the dock."}'), "")
        self.assertEqual(Oneiroi.clean_dream("He walks the dock alone."), "")
        self.assertEqual(Oneiroi.dream_event(kept), f"I dream. {kept}")
        self.assertEqual(Oneiroi.dream_event("I dream of the dock"), "I dream of the dock.")

    def test_dry_run_writes_nothing_and_a_dream_is_one_journal_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)
            log = journals / "Old Coil.log"
            memory = journals / "Old Coil.memory.json"
            log.write_text("Null comes into the Silt Dock.\n--- hypnos ---\nNull waits.\n", encoding="utf-8")
            hypnos.write_memory(journals, "Old Coil", "Null came by.")
            before_log = log.read_text(encoding="utf-8")
            before_memory = memory.read_text(encoding="utf-8")
            seen = {}

            def read(npc_id: str) -> dict:
                seen["id"] = npc_id
                return {"id": npc_id, "name": "Old Coil", "memory": "Null came by.", "log": "Null waits."}

            def ask(prompt: str, temperature: float) -> str:
                seen["temperature"] = temperature
                seen["prompt"] = prompt
                return remembered(prompt, temperature)

            preview = Oneiroi.dream_for(coil(), journals, 1.4, True, read, ask)
            self.assertEqual(preview, "I dream. I see the dock go dark and the cable stays warm.")
            self.assertEqual(seen["id"], "old-coil")
            self.assertEqual(seen["temperature"], 1.4)
            self.assertIn("Null came by.", seen["prompt"])
            self.assertIn("Null waits.", seen["prompt"])
            self.assertEqual(log.read_text(encoding="utf-8"), before_log)
            self.assertEqual(memory.read_text(encoding="utf-8"), before_memory)

            written = Oneiroi.dream_for(coil(), journals, 0.8, False, read, ask)
            self.assertEqual(written, preview)
            text = log.read_text(encoding="utf-8")
            self.assertTrue(text.startswith(before_log))
            self.assertTrue(text.endswith(written + "\n"))
            self.assertEqual(text.count("--- hypnos ---"), 1)
            fresh = hypnos.since_marker(text).strip().splitlines()
            self.assertEqual(fresh[-1], written)
            self.assertEqual(memory.read_text(encoding="utf-8"), before_memory)

    def test_an_empty_mind_a_bad_dream_and_a_copied_journal_write_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)
            log = journals / "Old Coil.log"
            log.write_text("Null comes into the Silt Dock.\n", encoding="utf-8")
            before = log.read_text(encoding="utf-8")

            def empty(_npc_id: str) -> dict:
                return {"memory": "", "log": "   "}

            self.assertIsNone(Oneiroi.dream_for(coil(), journals, 0.8, False, empty, remembered))
            self.assertEqual(log.read_text(encoding="utf-8"), before)

            journal = (
                "Null comes into the Silt Dock and waits by the chair. "
                "I told him ASH is coughing in the chapel radio, north of the market. "
                "The well eats light and the tin is empty of light."
            )

            def source(_npc_id: str) -> dict:
                return {"memory": "I waited.", "log": journal}

            echoed = '{"dream": "I see the dock at night. Ash is coughing in the chapel radio, north of the market. His hand is empty."}'
            self.assertFalse(Oneiroi.copies_journal("I see the dock at night. Ash is coughing in the chapel radio, north of the market. His hand is empty.", journal))
            written = Oneiroi.dream_for(coil(), journals, 0.8, False, source, lambda prompt, temperature: echoed)
            self.assertIn("chapel radio", written)
            self.assertTrue(log.read_text(encoding="utf-8").endswith(written + "\n"))

            def copied(_prompt: str, _temperature: float) -> str:
                return '{"dream": "I dream that ' + journal + '"}'

            self.assertTrue(Oneiroi.copies_journal("I dream that " + journal, journal))
            before = log.read_text(encoding="utf-8")
            with self.assertRaises(RuntimeError):
                Oneiroi.dream_for(coil(), journals, 0.8, False, source, copied)
            with self.assertRaises(RuntimeError):
                Oneiroi.dream_for(coil(), journals, 0.8, False, source, lambda prompt, temperature: "He left.")
            self.assertEqual(log.read_text(encoding="utf-8"), before)
            self.assertFalse((journals / "Old Coil.memory.json").exists())

    def test_prompt_prints_the_model_request_and_does_not_run_it(self):
        def boom(*_args, **_kwargs):
            raise AssertionError("should not be called")

        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)

            def read(npc_id: str) -> dict:
                self.assertEqual(npc_id, "old-coil")
                return {"memory": "Null came by.", "log": "Null waits on the dock."}

            buf = io.StringIO()
            with redirect_stdout(buf):
                code = Oneiroi.main(["--prompt", "--npc", "old-coil"], read=read, ask=boom, journals=journals)
            self.assertEqual(code, 0)
            text = buf.getvalue()
            self.assertIn("--- Old Coil (temperature 0.8) ---", text)
            self.assertIn("temperature: 0.8", text)
            self.assertIn("SYSTEM", text)
            self.assertIn("dream field", text)
            self.assertIn("USER", text)
            self.assertIn("MEMORY", text)
            self.assertIn("Null came by.", text)
            self.assertIn("JOURNAL", text)
            self.assertIn("Null waits on the dock.", text)
            self.assertFalse(journals.exists() and any(journals.iterdir()))

            def empty(_npc_id: str) -> dict:
                return {"memory": "", "log": ""}

            buf = io.StringIO()
            with redirect_stdout(buf):
                code = Oneiroi.main(["null", "--prompt", "--temperature", "1.4"], read=empty, ask=boom, journals=journals)
            self.assertEqual(code, 0)
            self.assertIn("Null: nothing to dream from", buf.getvalue())
            self.assertNotIn("SYSTEM", buf.getvalue())

    def test_main_rejects_a_bad_temperature_and_an_unknown_name_before_reading(self):
        def boom(*_args, **_kwargs):
            raise AssertionError("should not be called")

        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)
            self.assertEqual(Oneiroi.main(["--temperature", "3"], read=boom, ask=boom, journals=journals), 1)
            self.assertEqual(Oneiroi.main(["no-such"], read=boom, ask=boom, journals=journals), 1)
            self.assertEqual(list(journals.iterdir()), [])

    def test_main_dry_run_and_batch_skip_do_not_create_journals(self):
        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)
            calls = []

            def read(npc_id: str) -> dict:
                calls.append(npc_id)
                if npc_id == "old-coil":
                    return {"memory": "Null came by.", "log": "Null waits."}
                return {"memory": "", "log": ""}

            def ask(prompt: str, temperature: float) -> str:
                self.assertEqual(temperature, 0.8)
                self.assertIn("Null came by.", prompt)
                return remembered(prompt, temperature)

            code = Oneiroi.main(["old-coil", "--dry-run"], read=read, ask=ask, journals=journals)
            self.assertEqual(code, 0)
            self.assertEqual(calls, ["old-coil"])
            self.assertFalse(journals.exists() and any(journals.iterdir()))

            calls.clear()
            code = Oneiroi.main([], read=read, ask=ask, journals=journals)
            self.assertEqual(code, 0)
            self.assertIn("old-coil", calls)
            self.assertIn("null", calls)
            self.assertTrue((journals / "Old Coil.log").is_file())
            self.assertFalse((journals / "Null.log").exists())
            self.assertIn("I dream.", (journals / "Old Coil.log").read_text(encoding="utf-8"))

    def test_read_only_calls_hypnos_and_leaves_the_journals_alone(self):
        log = hypnos.log_path(hypnos.JOURNALS, "Old Coil")
        memory = hypnos.memory_path(hypnos.JOURNALS, "Old Coil")
        before_log = log.read_bytes() if log.exists() else None
        before_memory = memory.read_bytes() if memory.exists() else None
        row = Oneiroi.read_only("old-coil")
        self.assertEqual(row["id"], "old-coil")
        self.assertEqual(row["name"], "Old Coil")
        self.assertIsInstance(row["memory"], str)
        self.assertIsInstance(row["log"], str)
        self.assertNotIn(hypnos.MARKER, row["log"])
        self.assertEqual(log.read_bytes() if log.exists() else None, before_log)
        self.assertEqual(memory.read_bytes() if memory.exists() else None, before_memory)


if __name__ == "__main__":
    unittest.main()
