import tempfile
import unittest
from pathlib import Path

import hypnos


class HypnosTests(unittest.TestCase):
    def test_file_names_follow_the_person(self):
        self.assertEqual(hypnos.person_file_name("Old Coil"), "Old Coil")
        self.assertEqual(hypnos.person_file_name("  the Archivist  "), "the Archivist")
        self.assertEqual(hypnos.person_file_name("a/b\\c"), "abc")
        self.assertEqual(hypnos.person_file_name(".."), "unnamed")
        self.assertEqual(hypnos.person_file_name("dot."), "dot")
        coil = json_name()
        self.assertEqual(hypnos.log_path(Path("journals"), coil).name, f"{coil}.log")
        self.assertEqual(hypnos.memory_path(Path("journals"), coil).name, f"{coil}.memory.txt")

    def test_prompt_asks_for_a_new_memory_from_the_old_one_and_the_new_log(self):
        person = {
            "id": "old-coil",
            "room": "Silt Dock",
            "script": {
                "name": "Old Coil",
                "presence": "Old Coil sits in a deckchair.",
                "greeting": "You selling, or drifting?",
                "topics": {"ash": {}},
            },
            "state": {"mood": "dry"},
            "role": {
                "prompt": "You know ASH is coughing in the chapel.",
                "objectives": [{"flag": "heard_coil_ash", "goal": "Send them to the chapel."}],
            },
        }
        prompt = hypnos.hypnos_prompt(person, "I already traded a stim.", "Null takes frayed cable.")
        self.assertIn("in the form of a new memory", prompt)
        self.assertIn("first person", prompt)
        self.assertIn("OLD MEMORY", prompt)
        self.assertIn("NEW LOG", prompt)
        self.assertIn("I already traded a stim.", prompt)
        self.assertIn("Null takes frayed cable.", prompt)
        self.assertIn("he for Null", prompt)
        self.assertNotIn("/no_think", prompt)
        self.assertNotIn("You know ASH is coughing in the chapel.", prompt)
        self.assertNotIn("Send them to the chapel.", prompt)

    def test_update_writes_the_memory_and_leaves_a_blank_log_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)
            person = sample()
            (journals / "Old Coil.log").write_text(
                'Null comes into the Silt Dock.\nNull says "Hello, Coil. Are you well?"\n',
                encoding="utf-8",
            )
            memory = "Null came by. I saw him on the dock."

            def ask(prompt):
                self.assertIn("(none yet)", prompt)
                self.assertIn("Are you well?", prompt)
                return f"<think>We are writing the memory.</think>\n{memory}"

            written = hypnos.update_person(person, journals, ask=ask)
            self.assertEqual(written, memory)
            text = (journals / "Old Coil.memory.txt").read_text(encoding="utf-8")
            self.assertEqual(text, memory + "\n")
            self.assertNotIn("think", text)
            self.assertTrue((journals / "Old Coil.log").read_text(encoding="utf-8").endswith("--- hypnos ---\n"))

            def refuse(prompt):
                raise AssertionError(prompt)

            (journals / "Old Coil.log").write_text("", encoding="utf-8")
            self.assertIsNone(hypnos.update_person(person, journals, ask=refuse))
            self.assertEqual((journals / "Old Coil.memory.txt").read_text(encoding="utf-8"), memory + "\n")

    def test_reasoning_is_dropped_and_a_memory_sentence_is_kept(self):
        scratch = "We are writing the memory for the player.\nSteps:\n1. Keep the facts."
        self.assertEqual(hypnos.clean_memory(scratch), "")
        self.assertEqual(hypnos.clean_memory("<think>We are writing the memory.</think>"), "")
        kept = "You waited on the dock when Null arrived."
        self.assertEqual(hypnos.clean_memory(f"<think>plan the notes</think>\n{kept}"), kept)
        self.assertEqual(hypnos.clean_memory(f'{{"memory": "{kept}"}}'), kept)
        self.assertEqual(hypnos.clean_memory('{"memory": "We are writing the memory for the player."}'), "")
        self.assertEqual(
            hypnos.message_memory({"thinking": scratch, "content": kept}),
            kept,
        )
        quote = "Silt's got a bite. Go north of the market."
        log = 'Null comes into the Silt Dock.\nNull says "Hello"\n'
        self.assertEqual(hypnos.visit_memory(quote, log), "")
        told = "Null came by. He was polite. He asked if I was well. I told him to listen in the chapel. He went north."
        self.assertEqual(hypnos.visit_memory(told, log), told)
        pasted = "Null came by. I told him Silt's got a bite. Go north of the market, kneel in the chapel, listen. Not poetic. Not the Spire."
        source = 'I reply "Silt\'s got a bite. Go north of the market, kneel in the chapel, listen. Not poetic. Not the Spire. Just the cough."'
        self.assertTrue(hypnos.pastes_log(pasted, source))
        self.assertFalse(hypnos.pastes_log(told, source))
        body = hypnos.chat_body("prompt")
        self.assertIs(body["think"], True)
        self.assertEqual(body["format"]["required"], ["memory"])
        self.assertIn("new memory", body["messages"][0]["content"])
        self.assertNotIn("thinking", body["messages"][1])

    def test_a_later_run_compresses_the_old_memory_with_the_new_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)
            person = sample()
            log = journals / "Old Coil.log"
            memory = journals / "Old Coil.memory.txt"
            log.write_text('Null comes into the Silt Dock.\nNull says "Hello, Coil. Are you well?"\n', encoding="utf-8")
            first = "Null came by. I saw him on the dock."
            preview = hypnos.update_person(person, journals, dry_run=True, ask=lambda prompt: first)
            self.assertEqual(preview, first)
            self.assertFalse(memory.exists())
            self.assertNotIn("--- hypnos ---", log.read_text(encoding="utf-8"))
            written = hypnos.update_person(person, journals, ask=lambda prompt: first)
            self.assertEqual(written, first)
            marked = log.read_text(encoding="utf-8")
            self.assertIsNone(hypnos.update_person(person, journals, ask=lambda prompt: "Null came by. I should not be called."))
            self.assertEqual(log.read_text(encoding="utf-8"), marked)
            self.assertEqual(memory.read_text(encoding="utf-8"), first + "\n")

            log.write_text(marked + "Null goes north.\n", encoding="utf-8")
            second = "Null came by. I saw him on the dock, and then he went north."

            def ask(prompt):
                self.assertIn(first, prompt)
                self.assertIn("Null goes north.", prompt)
                self.assertNotIn("Are you well?", prompt)
                return second

            compressed = hypnos.update_person(person, journals, ask=ask)
            self.assertEqual(compressed, second)
            self.assertEqual(memory.read_text(encoding="utf-8"), second + "\n")
            lines = log.read_text(encoding="utf-8").splitlines()
            self.assertEqual(lines[-1], "--- hypnos ---")
            self.assertEqual(lines[-2], "Null goes north.")
            self.assertEqual(sum(line == "--- hypnos ---" for line in lines), 2)
            self.assertIsNone(hypnos.update_person(person, journals, dry_run=True, ask=lambda prompt: second))

    def test_real_coil_is_found_by_name(self):
        people = hypnos.load_npcs()
        coil = next(person for person in people if person["id"] == "old-coil")
        self.assertEqual(coil["script"]["name"], "Old Coil")
        self.assertEqual(coil["room"], "Silt Dock")
        self.assertIn("chapel", coil["role"]["prompt"])

    def test_read_only_returns_the_memory_and_the_log_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)
            person = sample()
            log = journals / "Old Coil.log"
            memory = journals / "Old Coil.memory.txt"
            log.write_text(
                "Null comes into the Silt Dock.\n--- hypnos ---\nNull waits.\n",
                encoding="utf-8",
            )
            memory.write_text("Null came by.\n", encoding="utf-8")
            before_log = log.read_text(encoding="utf-8")
            before_memory = memory.read_text(encoding="utf-8")
            row = hypnos.read_person(person, journals)
            self.assertEqual(row["id"], "old-coil")
            self.assertEqual(row["name"], "Old Coil")
            self.assertEqual(row["memory"], "Null came by.")
            self.assertIn("Null waits.", row["log"])
            self.assertNotIn("--- hypnos ---", row["log"])
            self.assertEqual(log.read_text(encoding="utf-8"), before_log)
            self.assertEqual(memory.read_text(encoding="utf-8"), before_memory)

    def test_null_remembers_in_the_first_person_and_a_bad_reply_is_not_saved(self):
        person = hypnos.player_person()
        prompt = hypnos.player_prompt("I went to the dock.", "I go north.")
        self.assertIn("in the form of a new memory", prompt)
        self.assertIn("Use I", prompt)
        self.assertIn("I went to the dock.", prompt)
        self.assertIn("I go north.", prompt)
        self.assertNotIn("he for Null", prompt)

        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)
            person = sample()
            log = journals / "Old Coil.log"
            memory = journals / "Old Coil.memory.txt"
            log.write_text("Null comes into the Silt Dock.\n--- hypnos ---\nNull goes north.\n", encoding="utf-8")
            memory.write_text("Null came by. I saw him on the dock.\n", encoding="utf-8")
            before = memory.read_text(encoding="utf-8")
            with self.assertRaises(RuntimeError):
                hypnos.update_person(person, journals, ask=lambda prompt: "He went north and left the dock behind him.")
            with self.assertRaises(RuntimeError):
                hypnos.update_person(
                    person,
                    journals,
                    ask=lambda prompt: "We are writing the memory for the player.\nSteps:\n1. Keep the facts.",
                )
            self.assertEqual(memory.read_text(encoding="utf-8"), before)
            self.assertEqual(log.read_text(encoding="utf-8").count("--- hypnos ---"), 1)

        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)
            log = journals / "Null.log"
            log.write_text("I come into the Silt Dock.\nI go north.\n", encoding="utf-8")
            remembered = "I left the dock and went north."
            written = hypnos.update_person(
                hypnos.player_person(),
                journals,
                ask=lambda prompt: '{"memory": "' + remembered + '"}',
            )
            self.assertEqual(written, remembered)
            self.assertTrue(log.read_text(encoding="utf-8").endswith("--- hypnos ---\n"))
            self.assertIsNone(hypnos.update_person(hypnos.player_person(), journals, ask=lambda prompt: remembered))
            row = hypnos.read_person(hypnos.player_person(), journals)
            self.assertEqual(row["memory"], written)
            self.assertEqual(log.read_text(encoding="utf-8").count("--- hypnos ---"), 1)
            self.assertNotIn("--- hypnos ---", row["log"])

    def test_the_player_is_readable_and_is_not_an_npc_folder(self):
        people = hypnos.load_people()
        null = next(person for person in people if person["id"] == "null")
        self.assertTrue(null["player"])
        self.assertEqual(null["script"]["name"], "Null")
        self.assertFalse(any(person["id"] == "null" for person in hypnos.load_npcs()))
        wick = next(person for person in people if person["id"] == "madam-wick")
        self.assertEqual(wick["room"], "Glass Booth")


def sample() -> dict:
    return {
        "id": "old-coil",
        "room": "Silt Dock",
        "script": {"name": "Old Coil", "presence": "here", "greeting": "hello", "topics": {}},
        "state": {"mood": "dry"},
        "role": {"prompt": "A dock sitter.", "objectives": []},
    }


def json_name() -> str:
    people = hypnos.load_npcs()
    return next(person["script"]["name"] for person in people if person["id"] == "old-coil")


if __name__ == "__main__":
    unittest.main()
