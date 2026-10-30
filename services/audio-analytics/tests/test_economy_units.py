"""Экономия на модели: метрики одним запросом и отсев диалогов смены —
чистая логика без сети и базы. Части про CRM прежнего проекта не перенесены."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.pipeline.llm import (  # noqa: E402
    METRICS_EVAL_TEMPLATE,
    LlmClient,
    LlmUsage,
    group_metrics,
    parse_metric_evals,
    render_metrics,
)
from app.pipeline.tasks import metric_types, skip_reason  # noqa: E402

METRICS = [
    {"name": "Приветствие", "prompt": "Поздоровался ли {по имени}", "scale_max": 10},
    {"name": "Закрытие", "prompt": "Предложил ли запись", "scale_max": 5},
]


# --- метрики одним запросом ---


def test_parse_metric_evals_by_number_and_scale():
    raw = {"evaluations": [
        {"metric": 2, "applicable": True, "score": 9, "good": ["записал"], "bad": [], "comment": "ок"},
        {"metric": 1, "applicable": False, "score": None},
    ]}
    first, second = parse_metric_evals(raw, METRICS)
    assert first["applicable"] is False and first["score"] is None
    # шкала берётся у своей метрики: 9 из 5 обрезается до 5
    assert second["applicable"] is True and second["score"] == 5


def test_parse_metric_evals_by_name_or_order():
    by_name = {"evaluations": [{"metric": "«Закрытие»", "applicable": True, "score": 3}]}
    first, second = parse_metric_evals(by_name, METRICS)
    assert first is None and second["score"] == 3
    in_order = {"evaluations": [
        {"applicable": True, "score": 7},
        {"applicable": True, "score": 4},
    ]}
    assert [r["score"] for r in parse_metric_evals(in_order, METRICS)] == [7, 4]


def test_parse_metric_evals_marks_missing_metric():
    raw = {"evaluations": [{"metric": 1, "applicable": True, "score": 8}]}
    first, second = parse_metric_evals(raw, METRICS)
    assert first["score"] == 8
    assert second is None


def test_parse_metric_evals_accepts_bare_list_and_single_object():
    assert parse_metric_evals([{"metric": 1, "applicable": True, "score": 6}], METRICS[:1])[0]["score"] == 6
    assert parse_metric_evals({"applicable": True, "score": 6}, METRICS[:1])[0]["score"] == 6
    with pytest.raises(ValueError):
        parse_metric_evals({"verdict": "хорошо"}, METRICS)


def test_metrics_prompt_keeps_owner_braces_and_sends_dialog_once():
    prompt = METRICS_EVAL_TEMPLATE.format(metrics=render_metrics(METRICS), dialog="ДИАЛОГ-ТЕКСТ")
    assert "МЕТРИКА 1 — «Приветствие», шкала от 1 до 10." in prompt
    assert "МЕТРИКА 2 — «Закрытие», шкала от 1 до 5." in prompt
    assert "Поздоровался ли {по имени}" in prompt
    assert prompt.count("ДИАЛОГ-ТЕКСТ") == 1


def test_group_metrics_packs_until_limit_and_keeps_order():
    items = [SimpleNamespace(name=str(i), prompt="x" * n) for i, n in enumerate([30, 30, 50, 120, 10])]
    groups = group_metrics(items, 100)
    assert [[m.name for m in g] for g in groups] == [["0", "1"], ["2"], ["3"], ["4"]]
    # всё влезает — один запрос
    assert len(group_metrics(items, 1000)) == 1
    assert group_metrics([], 100) == []


class _Stream:
    def __init__(self, message):
        self._message = message

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return self._message


def test_evaluate_metrics_is_one_request_for_all_metrics():
    message = SimpleNamespace(
        content=[SimpleNamespace(
            type="text",
            text='{"evaluations": [{"metric": 1, "applicable": true, "score": 7}, '
                 '{"metric": 2, "applicable": false, "score": null}]}',
        )],
        stop_reason="end_turn",
        usage=SimpleNamespace(input_tokens=3000, output_tokens=400),
    )
    calls = []
    llm = LlmClient.__new__(LlmClient)
    llm.settings = SimpleNamespace(llm_max_tokens=16000)
    llm.usage = LlmUsage()
    llm.client = SimpleNamespace(messages=SimpleNamespace(
        stream=lambda **kw: calls.append(kw) or _Stream(message)
    ))
    results = llm.evaluate_metrics("ДИАЛОГ", METRICS, "claude-haiku-5-5")
    assert len(calls) == 1
    assert calls[0]["model"] == "claude-haiku-5-5"
    assert results[0]["score"] == 7 and results[1]["applicable"] is False
    assert llm.usage.cost_usd == pytest.approx((3000 * 0.10 + 400 * 0.50) / 1_000_000)


# --- какие диалоги смены оцениваются ---


def test_skip_reason_service_short_and_irrelevant():
    types = metric_types(SimpleNamespace(llm_metrics_on_service=False))
    assert skip_reason("sale", 6, types, 4) is None
    assert skip_reason("consultation", 3, types, 4) == "short"
    assert skip_reason("service", 10, types, 4) == "service"
    assert skip_reason("irrelevant", 10, types, 4) == "irrelevant"
    # включили оценку сервиса — сервис оценивается, но короткий всё равно нет
    with_service = metric_types(SimpleNamespace(llm_metrics_on_service=True))
    assert skip_reason("service", 10, with_service, 4) is None
    assert skip_reason("service", 2, with_service, 4) == "short"
    # порог 0 или 1 — оценивать всё, где есть хоть одна реплика
    assert skip_reason("refusal", 1, types, 0) is None
