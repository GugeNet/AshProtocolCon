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

    def test_prompt_uses_the_role_the_old_memory_and_the_log(self):
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
        prompt = hypnos.hypnos_prompt(person, "You already traded a stim.", "Null takes frayed cable.")
        self.assertIn("You know ASH is coughing in the chapel.", prompt)
        self.assertIn("Send them to the chapel.", prompt)
        self.assertIn("Silt Dock", prompt)
        self.assertIn("You already traded a stim.", prompt)
        self.assertIn("Null takes frayed cable.", prompt)
        self.assertIn("/no_think", prompt)
        self.assertIn("Null came by", prompt)
        self.assertIn("he for Null", prompt)

    def test_update_writes_the_visit_and_leaves_a_blank_log_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)
            person = sample()
            (journals / "Old Coil.log").write_text(
                'Null comes into the Silt Dock.\nNull says "Hello, Coil. Are you well?"\n',
                encoding="utf-8",
            )
            written = hypnos.update_person(person, journals)
            self.assertEqual(written, "Null came by. He was nice. He asked if I was well.")
            text = (journals / "Old Coil.memory.txt").read_text(encoding="utf-8")
            self.assertEqual(text, "Null came by. He was nice. He asked if I was well.\n")
            self.assertTrue((journals / "Old Coil.log").read_text(encoding="utf-8").endswith("--- hypnos ---\n"))

            (journals / "Old Coil.log").write_text("", encoding="utf-8")
            self.assertIsNone(hypnos.update_person(person, journals))
            self.assertEqual(
                (journals / "Old Coil.memory.txt").read_text(encoding="utf-8"),
                "Null came by. He was nice. He asked if I was well.\n",
            )

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
        self.assertIs(body["think"], False)
        self.assertEqual(body["format"]["required"], ["memory"])
        self.assertNotIn("thinking", body["messages"][1])

    def test_a_visit_is_told_as_short_sentences(self):
        coil = "\n".join(
            [
                "Null comes into the Silt Dock.",
                'Null says "Hello, Coil. Are you well?"',
                'I reply "Silt\'s got a bite. You\'re the one who coughed for Ash. Go north of the market, kneel in the chapel, listen. Not poetic. Not the Spire. Just the cough."',
                "Null goes north.",
            ]
        )
        text = hypnos.retell_log(coil)
        self.assertTrue(text.startswith("Null came by. He was nice. He asked if I was well."))
        self.assertIn("chapel", text)
        self.assertIn("He went north.", text)
        self.assertNotIn("dry", text)
        self.assertNotIn("Not poetic", text)
        self.assertNotIn("He asked about Ash", text)

        mare = "\n".join(
            [
                "Null comes into the Lantern Market.",
                'Null says "Hello, Voss. Do you sell anything?"',
                "Null goes north.",
                "Null comes into the Lantern Market.",
            ]
        )
        mare_text = hypnos.retell_log(mare)
        self.assertIn("Null came by. He was nice. He asked if I sell anything.", mare_text)
        self.assertIn("He came back.", mare_text)

    def test_a_later_run_reads_only_the_lines_after_the_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            journals = Path(tmp)
            person = sample()
            log = journals / "Old Coil.log"
            memory = journals / "Old Coil.memory.txt"
            log.write_text('Null comes into the Silt Dock.\nNull says "Hello, Coil. Are you well?"\n', encoding="utf-8")
            preview = hypnos.update_person(person, journals, dry_run=True)
            self.assertEqual(preview, "Null came by. He was nice. He asked if I was well.")
            self.assertFalse(memory.exists())
            self.assertNotIn("--- hypnos ---", log.read_text(encoding="utf-8"))
            first = hypnos.update_person(person, journals)
            self.assertEqual(first, "Null came by. He was nice. He asked if I was well.")
            marked = log.read_text(encoding="utf-8")
            self.assertIsNone(hypnos.update_person(person, journals))
            self.assertEqual(log.read_text(encoding="utf-8"), marked)
            self.assertEqual(memory.read_text(encoding="utf-8"), first + "\n")

            log.write_text(marked + "Null goes north.\n", encoding="utf-8")
            second = hypnos.update_person(person, journals)
            self.assertEqual(second, first + "\nHe went north.")
            self.assertEqual(memory.read_text(encoding="utf-8"), second + "\n")
            lines = log.read_text(encoding="utf-8").splitlines()
            self.assertEqual(lines[-1], "--- hypnos ---")
            self.assertEqual(lines[-2], "Null goes north.")
            self.assertEqual(sum(line == "--- hypnos ---" for line in lines), 2)
            self.assertIsNone(hypnos.update_person(person, journals, dry_run=True))

    def test_real_coil_is_found_by_name(self):
        people = hypnos.load_npcs()
        coil = next(person for person in people if person["id"] == "old-coil")
        self.assertEqual(coil["script"]["name"], "Old Coil")
        self.assertEqual(coil["room"], "Silt Dock")
        self.assertIn("chapel", coil["role"]["prompt"])


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
