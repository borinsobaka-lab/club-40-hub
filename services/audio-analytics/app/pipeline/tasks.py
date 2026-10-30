"""Разбор смены целиком: склейка → VAD → распознавание → диалоги → метрики → итог дня.

Логика — прежнего проекта (pipeline/tasks.py), без Celery: смену из очереди
(aa_recordings.status = 'queued') забирает воркер (app/worker.py) и зовёт
process_recording(). Отличия от прежней версии:
  * промпты и метрики — из aa_prompts / aa_metrics (общие для сети, без org_id);
  * итог смены — aa_day_summaries (одна строка на смену);
  * пересчёт работает и после того, как аудио стёрто по сроку хранения: он
    берёт сохранённую расшифровку, а склеенная запись ему не нужна;
  * повторное распознавание стёртой смены отказывает понятным текстом ДО
    того, как удалены прошлые результаты, — иначе неудачный «Распознать
    заново» стоил бы готового отчёта.
"""
import json
import logging
import tempfile
import traceback
import uuid
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .. import storage
from ..config import get_settings
from ..models import (
    AaDaySummary,
    AaDialog,
    AaDialogTurn,
    AaMetric,
    AaMetricEvaluation,
    AaPrompt,
    AaRecording,
    AaSegment,
    AaTranscript,
)
from . import audio_prep
from .asr import AsrResult, Word, get_asr
from .cost import compute_cost
from .llm import DEFAULT_PROMPTS, LlmClient, group_metrics
from .segmentation import (
    render_transcript,
    split_into_blocks,
    words_to_turns,
)
from .vad import find_speech_regions

logger = logging.getLogger(__name__)

ANALYZABLE_TYPES = ("sale", "consultation", "refusal")
# Реплики храним и у сервисных разговоров: их видно в отчёте смены, даже если
# по метрикам они не оценивались. Личные разговоры не храним вовсе.
STORED_TYPES = ("sale", "consultation", "refusal", "service")

# Формат сохранённой расшифровки: слова с таймкодами уже по исходной записи,
# чтобы пересчёт по новым метрикам не платил за распознавание второй раз.
# Сырой ответ провайдера лежит рядом, для отладки.
TRANSCRIPT_FORMAT = 2

PURGED_AUDIO_MESSAGE = (
    "аудио смены стёрто по сроку хранения — распознать речь заново нельзя. "
    "«Пересчитать» без повторного распознавания берёт сохранённую расшифровку"
)


class RecordingGone(Exception):
    """Смену удалили из админки, пока она разбиралась."""


def metric_types(settings) -> tuple[str, ...]:
    """Какие диалоги оцениваются по метрикам. Сервисные — только по
    LLM_METRICS_ON_SERVICE: метрики написаны под продажу, а сервисных
    разговоров в смене много, и каждый стоит запроса."""
    return ANALYZABLE_TYPES + (("service",) if settings.llm_metrics_on_service else ())


def skip_reason(d_type: str, turns: int, types: tuple[str, ...], min_turns: int) -> str | None:
    """Почему диалог не оценивается по метрикам; None — оценивается.
    "service" — сервисный разговор, "short" — слишком мало реплик,
    "irrelevant" — личное или не по делу."""
    if d_type not in STORED_TYPES:
        return "irrelevant"
    if d_type not in types:
        return "service"
    if turns < max(1, min_turns):
        return "short"
    return None


def load_active_prompt(db: Session, key: str) -> tuple[str, str | None]:
    """Return (content, model_override) of the active prompt; fall back to default."""
    prompt = db.scalar(
        select(AaPrompt)
        .where(AaPrompt.key == key, AaPrompt.active.is_(True))
        .order_by(AaPrompt.version.desc())
        .limit(1)
    )
    if prompt and prompt.content.strip():
        return prompt.content, (prompt.model or None)
    return DEFAULT_PROMPTS[key]["content"], None


def process_recording(db: Session, recording_id: uuid.UUID | str, full: bool = False) -> str:
    """Разобрать смену, уже переведённую воркером в «processing».

    `full=True` — распознать речь заново даже если расшифровка с прошлого
    раза сохранилась. Ошибка — статус «error» с текстом и хвостом трассировки
    (видно в админке); смена, удалённая во время разбора, — RecordingGone.
    """
    recording_id = uuid.UUID(str(recording_id))
    try:
        # Статус только что поменян запросом мимо ORM (claim_next): объект,
        # оставшийся в сессии с прошлого раза, перечитывается из базы, иначе
        # «done» поверх «done» не попало бы в UPDATE.
        rec = db.get(AaRecording, recording_id, populate_existing=True)
        if not rec:
            raise RecordingGone(str(recording_id))
        with tempfile.TemporaryDirectory(prefix="day_") as tmp:
            result = _run_pipeline(db, rec, Path(tmp), full=full)
        rec.set_status("done")  # status_detail already carries the run summary
        db.commit()
        return result
    except Exception as e:
        db.rollback()
        # Сессия могла держать объект смены в памяти: читаем заново из базы,
        # иначе удалённая смена выглядела бы живой.
        db.expunge_all()
        rec = db.get(AaRecording, recording_id)
        if rec is None:
            raise RecordingGone(str(recording_id)) from e
        logger.exception("recording %s failed", recording_id)
        rec.set_status("error", f"{e}\n{traceback.format_exc()[-1500:]}")
        db.commit()
        return f"error: {e}"


def _cleanup_previous_results(db: Session, rec: AaRecording, drop_transcript: bool) -> None:
    """Make reprocessing idempotent: drop results of earlier runs.

    Реплики и оценки уходят вместе с диалогами (on delete cascade), с ними и
    «согласен / не согласен» по старым оценкам: пересчёт создаёт новые
    разговоры, и голос за прежнюю оценку к ним уже не относится.
    Договорённости остаются — у них ссылка на разговор просто обнуляется."""
    db.execute(delete(AaMetricEvaluation).where(AaMetricEvaluation.recording_id == rec.id))
    db.execute(delete(AaDialog).where(AaDialog.recording_id == rec.id))
    if drop_transcript:
        db.execute(delete(AaTranscript).where(AaTranscript.recording_id == rec.id))
    db.commit()


def _progress(db: Session, rec: AaRecording, detail: str) -> None:
    """Пояснение статуса видно в админке и заодно подтверждает, что разбор
    жив: по времени последнего изменения отличают зависший разбор."""
    rec.set_status(detail=detail)
    db.commit()


def _load_saved_words(rec: AaRecording, db: Session) -> AsrResult | None:
    """Расшифровка прошлого прогона, если она сохранена в новом формате.

    Склеенная запись для этого не нужна (в прежнем проекте требовалась):
    после стирания аудио по сроку хранения пересчёт по новым метрикам должен
    работать — расшифровка для того и хранится дольше аудио."""
    transcript = db.scalar(
        select(AaTranscript)
        .where(AaTranscript.recording_id == rec.id)
        .order_by(AaTranscript.created_at.desc())
        .limit(1)
    )
    if not transcript or not transcript.raw_json_uri:
        return None
    try:
        payload = json.loads(storage.get_bytes(transcript.raw_json_uri))
    except Exception as e:  # noqa: BLE001 — нет расшифровки, распознаём заново
        logger.warning("saved transcript of %s unreadable: %s", rec.id, e)
        return None
    if not isinstance(payload, dict) or payload.get("format") != TRANSCRIPT_FORMAT:
        return None
    words = [
        Word(
            text=str(w.get("text", "")),
            start=float(w.get("start", 0.0)),
            end=float(w.get("end", 0.0)),
            speaker=str(w.get("speaker", "speaker_0")),
        )
        for w in payload.get("words", [])
    ]
    return AsrResult(
        provider=str(payload.get("provider", transcript.asr_provider)),
        language=str(payload.get("language", transcript.language_hint)),
        text=str(payload.get("text", "")),
        words=words,
        raw=payload.get("raw"),
    )


def _transcribe(db: Session, rec: AaRecording, tmp: Path) -> AsrResult | None:
    """Скачать сегменты, склеить, найти речь и распознать её.

    Возвращает None, если речи в записи нет. Таймкоды слов — по исходной
    записи; расшифровка сохраняется в хранилище, чтобы пересчёт по другим
    метрикам не распознавал день заново.
    """
    settings = get_settings()
    if rec.audio_purged_at is not None:
        raise RuntimeError(PURGED_AUDIO_MESSAGE)

    # 1. Download and merge segments.
    segments = list(
        db.scalars(
            select(AaSegment).where(AaSegment.recording_id == rec.id).order_by(AaSegment.idx)
        )
    )
    if not segments:
        raise RuntimeError("на сервер не загружено ни одного сегмента записи")

    local_paths = []
    for seg in segments:
        p = tmp / f"seg_{seg.idx:05d}.opus"
        storage.download_file(seg.audio_uri, str(p))
        local_paths.append(str(p))

    merged = tmp / "merged.opus"
    audio_prep.merge_segments(local_paths, str(merged))
    merged_uri = storage.merged_key(str(rec.id))
    storage.upload_file(merged_uri, str(merged), content_type="audio/ogg")
    rec.raw_audio_uri = merged_uri
    rec.total_duration_s = audio_prep.probe_duration_s(str(merged))
    _progress(db, rec, "поиск речи (VAD)")

    # 2. VAD → speech-only audio.
    wav = tmp / "day.wav"
    audio_prep.to_wav_16k_mono(str(merged), str(wav))
    regions = find_speech_regions(
        str(wav),
        threshold=settings.vad_threshold,
        min_speech_ms=settings.vad_min_speech_ms,
        min_silence_ms=settings.vad_min_silence_ms,
    )
    if not regions:
        rec.speech_duration_s = 0.0
        rec.asr_seconds = 0.0
        return None
    speech_wav = tmp / "speech.wav"
    timeline = audio_prep.cut_speech_only(str(wav), regions, str(speech_wav))
    rec.speech_duration_s = sum(entry["duration"] for entry in timeline)
    # В ASR уходит только речь, вырезанная VAD, — по ней и считается счёт.
    rec.asr_seconds = rec.speech_duration_s
    _progress(db, rec, f"распознавание речи ({rec.speech_duration_s / 60:.0f} мин)")
    # Склеенный день и WAV дальше не нужны; на 12-часовой смене это 1.5 ГБ.
    wav.unlink(missing_ok=True)
    merged.unlink(missing_ok=True)
    for p in local_paths:
        Path(p).unlink(missing_ok=True)

    # 3. ASR with timestamps mapped back to the original timeline.
    asr_result: AsrResult = get_asr().transcribe(str(speech_wav))
    mapper = audio_prep.TimelineMapper(timeline)
    for w in asr_result.words:
        w.start = mapper.to_original(w.start)
        w.end = max(w.start, mapper.to_original(w.end))

    transcript_uri = storage.transcript_key(str(rec.id))
    storage.upload_bytes(
        transcript_uri,
        json.dumps(
            {
                "format": TRANSCRIPT_FORMAT,
                "provider": asr_result.provider,
                "language": asr_result.language,
                "text": asr_result.text,
                "words": [
                    {"text": w.text, "start": w.start, "end": w.end, "speaker": w.speaker}
                    for w in asr_result.words
                ],
                "raw": asr_result.raw or {},
            },
            ensure_ascii=False,
        ).encode(),
        content_type="application/json",
    )
    db.add(
        AaTranscript(
            recording_id=rec.id,
            asr_provider=asr_result.provider,
            language_hint=asr_result.language,
            raw_json_uri=transcript_uri,
            text=render_transcript(words_to_turns(asr_result.words)),
        )
    )
    db.commit()
    return asr_result


def _run_pipeline(db: Session, rec: AaRecording, tmp: Path, full: bool = False) -> str:
    settings = get_settings()

    saved = None if full else _load_saved_words(rec, db)
    if saved is None and rec.audio_purged_at is not None:
        # Проверка ДО очистки: иначе прошлый отчёт был бы стёрт, а новый не
        # получился бы — смена осталась бы и без аудио, и без разбора.
        raise RuntimeError(PURGED_AUDIO_MESSAGE)
    _cleanup_previous_results(db, rec, drop_transcript=saved is None)

    if saved is not None:
        asr_result = saved
        # Распознавание не вызывалось — в стоимость этого прогона оно не входит.
        rec.asr_seconds = 0.0
        reused_note = "расшифровка взята с прошлого разбора"
    else:
        asr_result = _transcribe(db, rec, tmp)
        reused_note = ""
        if asr_result is None:
            rec.set_status(
                detail=(
                    "речь в записи не найдена — проверьте микрофон и уровень сигнала "
                    "в приложении, затем нажмите «Распознать заново»"
                )
            )
            _write_day_summary(db, rec, 0, 0, None, None)
            rec.cost_usd = 0.0
            rec.llm_input_tokens = rec.llm_output_tokens = rec.llm_calls = 0
            db.commit()
            return "no speech detected"

    turns = words_to_turns(asr_result.words)
    if not turns:
        rec.set_status(detail="распознавание не вернуло ни одного слова")
        _write_day_summary(db, rec, 0, 0, None, None)
        cost = compute_cost(rec.asr_seconds, 0.0, settings.price_asr_per_hour_usd)
        rec.cost_usd = cost.total_usd
        rec.llm_input_tokens = rec.llm_output_tokens = rec.llm_calls = 0
        db.commit()
        return "empty transcript"

    # 4. LLM stage 1: segment the day into dialogs, block by block.
    llm = LlmClient()
    seg_content, seg_model = load_active_prompt(db, "dialog_segmentation")
    blocks = split_into_blocks(turns, settings.conversation_gap_s, settings.llm_stage1_block_chars)
    dialogs_meta: list[dict] = []
    for i, block in enumerate(blocks, start=1):
        _progress(db, rec, f"разбиение на диалоги: блок {i} из {len(blocks)}")
        dialogs_meta.extend(
            llm.segment_dialogs(
                render_transcript(block),
                seg_content,
                seg_model or settings.llm_model_stage1,
                day_duration_s=rec.total_duration_s,
            )
        )
    dialogs_meta.sort(key=lambda d: d["start_s"])

    # 5. LLM stage 2: evaluate every client dialog against every active metric.
    metrics = list(
        db.scalars(
            select(AaMetric)
            .where(AaMetric.active.is_(True))
            .order_by(AaMetric.position, AaMetric.created_at)
        )
    )

    analyses: list[dict] = []
    sales = 0
    failed_evals = 0
    evals_done = 0
    evals_applicable = 0
    types = metric_types(settings)
    min_turns = settings.llm_min_dialog_turns
    # Все метрики диалога — одним запросом; очень длинные наборы инструкций
    # делятся на несколько запросов, чтобы не уйти в дорогой тариф.
    groups = group_metrics(metrics, settings.llm_metrics_batch_chars)
    not_evaluated = {"service": 0, "short": 0}

    # Реплика относится к диалогу, если пересекается с его окном. Модель
    # видит в транскрипте только время НАЧАЛА реплик, поэтому её end_s —
    # это начало последней реплики; требование «реплика закончилась до
    # end_s» выбрасывало последнюю фразу каждого разговора.
    windows = [
        [t for t in turns if t.start < m["end_s"] + 1 and t.end > m["start_s"] - 1]
        for m in dialogs_meta
    ]
    to_evaluate = sum(
        1
        for m, w in zip(dialogs_meta, windows)
        if w and skip_reason(m["type"], len(w), types, min_turns) is None
    )
    evaluated = 0

    for meta, d_turns in zip(dialogs_meta, windows):
        # Timestamps and type are already validated by normalize_dialogs().
        d_start = meta["start_s"]
        d_end = meta["end_s"]
        d_type = meta["type"]
        if d_turns:
            d_start = min(d_start, d_turns[0].start)
            d_end = max(d_end, max(t.end for t in d_turns))

        dialog = AaDialog(
            recording_id=rec.id,
            start_s=d_start,
            end_s=d_end,
            type=d_type,
            brief=str(meta.get("brief", "")) if d_type != "irrelevant" else "",
        )
        db.add(dialog)
        db.flush()
        if d_type == "sale":
            dialog.outcome = "sale"
            sales += 1

        # Store turns for analyzable dialogs only — irrelevant (personal) talk
        # is deliberately not persisted per the privacy policy.
        if d_type in STORED_TYPES:
            for t in d_turns:
                db.add(
                    AaDialogTurn(
                        dialog_id=dialog.id,
                        speaker_label=t.speaker,
                        start_s=t.start,
                        end_s=t.end,
                        text=t.text,
                    )
                )

        reason = skip_reason(d_type, len(d_turns), types, min_turns)
        if reason in not_evaluated and d_turns and metrics:
            not_evaluated[reason] += 1
        if reason is None and d_turns and metrics:
            evaluated += 1
            _progress(db, rec, f"оценка разговоров по метрикам: {evaluated} из {to_evaluate}")
            dialog_text = render_transcript(d_turns)
            dialog_evals: dict = {}
            for group in groups:
                # Один упавший запрос не должен стоить всего отчёта смены.
                try:
                    results = llm.evaluate_metrics(
                        dialog_text,
                        [
                            {"name": m.name, "prompt": m.prompt, "scale_max": m.scale_max}
                            for m in group
                        ],
                        settings.llm_model_stage2,
                    )
                except Exception as e:  # noqa: BLE001
                    failed_evals += len(group)
                    logger.warning(
                        "metrics %s failed on dialog at %.1fs: %s",
                        [m.name for m in group], d_start, e,
                    )
                    continue
                for metric, result in zip(group, results):
                    if result is None:
                        failed_evals += 1
                        logger.warning(
                            "metric '%s' is missing in the answer for dialog at %.1fs",
                            metric.name, d_start,
                        )
                        continue
                    db.add(
                        AaMetricEvaluation(
                            recording_id=rec.id,
                            dialog_id=dialog.id,
                            metric_id=metric.id,
                            applicable=result["applicable"],
                            score=result["score"],
                            good=result["good"],
                            bad=result["bad"],
                            comment=result["comment"],
                        )
                    )
                    evals_done += 1
                    if result["applicable"]:
                        evals_applicable += 1
                        dialog_evals[metric.name] = {
                            "score": result["score"],
                            "scale": metric.scale_max,
                            "bad": result["bad"],
                        }
            if dialog_evals:
                analyses.append({"start_s": d_start, "type": d_type, "metrics": dialog_evals})

    db.commit()

    # 6. Day stats + daily summary.
    relevant = [m for m in dialogs_meta if m.get("type") in ANALYZABLE_TYPES]
    stats = {
        "date": str(rec.date),
        "dialogs_total": len(relevant),
        "sales_count": sales,
        "conversion": round(sales / len(relevant), 3) if relevant else None,
        "speech_duration_s": rec.speech_duration_s,
    }
    summary = None
    if analyses:
        _progress(db, rec, "итоги смены")
        sum_content, sum_model = load_active_prompt(db, "daily_summary")
        # The per-dialog analyses are the valuable part; a failed summary must
        # not discard them.
        try:
            summary = llm.summarize_day(
                analyses, stats, sum_content, sum_model or settings.llm_model_stage1
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("daily summary failed: %s", e)
            summary = {"error": str(e)[:500]}

    _write_day_summary(db, rec, stats["dialogs_total"], sales, stats["conversion"], summary)
    db.commit()

    # Стоимость последней обработки: цена запросов к модели посчитана по
    # тарифу каждой модели с учётом кэша, токены — для справки в админке.
    rec.llm_input_tokens = llm.usage.input_tokens
    rec.llm_output_tokens = llm.usage.output_tokens
    rec.llm_calls = llm.usage.calls
    cost = compute_cost(rec.asr_seconds, llm.usage.cost_usd, settings.price_asr_per_hour_usd)
    rec.cost_usd = cost.total_usd
    db.commit()

    # Human-readable summary shown under the "Готово" status in the dashboard,
    # so an empty report explains itself: no metrics? nothing applicable? errors?
    parts = [f"диалогов: {len(dialogs_meta)}"]
    if not metrics:
        parts.append("активных метрик не было — добавьте их и нажмите «Пересчитать»")
    else:
        parts.append(f"метрик: {len(metrics)}")
        parts.append(f"сработало оценок: {evals_applicable} из {evals_done}")
    if failed_evals:
        parts.append(f"ошибок оценки: {failed_evals}")
    skipped_parts = [
        f"{label} {not_evaluated[key]}"
        for key, label in (("service", "сервисных"), ("short", "коротких"))
        if not_evaluated[key]
    ]
    if skipped_parts:
        parts.append("без оценки: " + ", ".join(skipped_parts))
    if reused_note:
        parts.append(reused_note)
    parts.append(f"стоимость: ${cost.total_usd:.3f}")
    summary_line = ", ".join(parts)
    rec.set_status(detail=summary_line)
    db.commit()
    return summary_line


def _write_day_summary(
    db: Session,
    rec: AaRecording,
    dialogs_total: int,
    sales: int,
    conversion: float | None,
    summary: dict | None,
) -> None:
    """Итог смены — одна строка на смену; пересчёт её перезаписывает.

    Пишется и у смены без речи: иначе в списке смен у неё висели бы цифры
    прошлого разбора, хотя диалоги уже стёрты."""
    stmt = pg_insert(AaDaySummary).values(
        recording_id=rec.id,
        dialogs_total=dialogs_total,
        sales_count=sales,
        conversion=conversion,
        summary=summary,
    )
    db.execute(
        stmt.on_conflict_do_update(
            index_elements=[AaDaySummary.recording_id],
            set_={
                "dialogs_total": stmt.excluded.dialogs_total,
                "sales_count": stmt.excluded.sales_count,
                "conversion": stmt.excluded.conversion,
                "summary": stmt.excluded.summary,
            },
        )
    )
