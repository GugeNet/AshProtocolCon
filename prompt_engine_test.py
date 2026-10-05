import json
import math
import unittest

import prompt_engine


class FakeLlama:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.calls = []

    def create_chat_completion(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "id": "completion-1",
            "choices": [{"message": {"role": "assistant", "content": "  raw reply  "}}],
            "usage": {"completion_tokens": 4},
        }


class PromptEngineTests(unittest.TestCase):
    def test_temperature_matches_the_oneiroi_range(self):
        self.assertTrue(prompt_engine.temperature_ok(0))
        self.assertTrue(prompt_engine.temperature_ok(2))
        self.assertTrue(prompt_engine.temperature_ok(1.4))
        self.assertFalse(prompt_engine.temperature_ok(-0.1))
        self.assertFalse(prompt_engine.temperature_ok(2.1))
        self.assertFalse(prompt_engine.temperature_ok(float("nan")))
        self.assertFalse(prompt_engine.temperature_ok(math.inf))

    def test_load_tries_every_gpu_layer_then_cpu(self):
        seen = []

        class Llama:
            def __init__(self, **kwargs):
                seen.append(kwargs)
                if kwargs["n_gpu_layers"] == -1:
                    raise RuntimeError("no gpu")

        _, layers = prompt_engine.load_model(Llama, "model.gguf")
        self.assertEqual(layers, 0)
        self.assertEqual([row["n_gpu_layers"] for row in seen], [-1, 0])
        self.assertEqual(seen[-1]["model_path"], "model.gguf")
        self.assertEqual(seen[-1]["n_ctx"], 8192)
        self.assertFalse(seen[-1]["verbose"])

    def test_load_reports_the_last_failure(self):
        class Llama:
            def __init__(self, **kwargs):
                raise RuntimeError(f"fail {kwargs['n_gpu_layers']}")

        with self.assertRaises(RuntimeError) as raised:
            prompt_engine.load_model(Llama, "model.gguf")
        self.assertIn("The model did not load.", str(raised.exception))
        self.assertIn("fail 0", str(raised.exception))

    def test_complete_passes_temperature_and_returns_the_dict(self):
        llm = FakeLlama()
        raw = prompt_engine.complete(llm, "  Hello  ", 1.4, 32)
        self.assertEqual(raw["choices"][0]["message"]["content"], "  raw reply  ")
        self.assertEqual(
            llm.calls[0],
            {
                "messages": [{"role": "user", "content": "  Hello  "}],
                "temperature": 1.4,
                "max_tokens": 32,
            },
        )

    def test_handle_returns_the_raw_completion(self):
        llm = FakeLlama()
        reply = prompt_engine.handle(
            llm,
            {"id": 7, "prompt": "Hello", "temperature": 0.8, "max_tokens": 32},
        )
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["id"], 7)
        self.assertEqual(reply["raw"]["id"], "completion-1")
        self.assertEqual(reply["raw"]["choices"][0]["message"]["content"], "  raw reply  ")
        self.assertNotIn("response_format", llm.calls[0])

    def test_handle_rejects_a_bad_prompt_or_temperature_before_the_model(self):
        llm = FakeLlama()
        empty = prompt_engine.handle(llm, {"id": 1, "prompt": "  ", "temperature": 0.8})
        hot = prompt_engine.handle(llm, {"id": 2, "prompt": "Hello", "temperature": 3})
        self.assertFalse(empty["ok"])
        self.assertFalse(hot["ok"])
        self.assertEqual(llm.calls, [])

    def test_a_request_line_round_trips_the_raw_object(self):
        llm = FakeLlama()
        line = json.dumps({"id": 3, "prompt": "Hello", "temperature": 0, "max_tokens": 16})
        reply = prompt_engine.reply_for_line(llm, line)
        self.assertEqual(reply["raw"]["usage"]["completion_tokens"], 4)
        self.assertIsNone(prompt_engine.reply_for_line(llm, "\n"))
        bad = prompt_engine.reply_for_line(llm, "{")
        self.assertFalse(bad["ok"])
        self.assertEqual(bad["error"], "The request was not JSON.")
