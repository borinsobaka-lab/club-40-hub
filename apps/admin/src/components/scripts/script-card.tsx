/**
 * Карточка скрипта.
 *
 * Всегда раскрыта — сворачивания нет (решение владельца в «Аудиоаналитике»):
 * всё, что было в документе вокруг текста, видно сразу — когда отправлять,
 * ветки «если выбирают…», варианты по студиям и что сделать после отправки.
 * Каждое сообщение — целиком, на подложке и с кнопкой «Копировать».
 *
 * Внизу всегда полоса: кто, когда и что изменил в последний раз. Скрипт
 * меняется у всех сразу, и у стойки должно быть видно, почему текст другой.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Link2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Formatted, Highlight, RichText } from "@/components/scripts/rich-text";
import { logCopy } from "@/lib/scripts/data";
import {
  copyText,
  formatWhen,
  KIND_LABELS,
  langInfo,
  messageText,
  pickVariant,
  resolveText,
  scriptUrl,
  type VarResolver,
} from "@/lib/scripts/logic";
import type {
  ScriptItem,
  ScriptKind,
  ScriptLang,
  ScriptMessage,
  ScriptSection,
} from "@/lib/scripts/types";
import { cn } from "@/lib/utils";

const KIND_CHIP: Record<ScriptKind, string> = {
  chat: "bg-blue-100 text-blue-700",
  call: "bg-emerald-100 text-emerald-700",
  task: "bg-amber-100 text-amber-800",
  info: "bg-muted text-muted-foreground",
};

/** Кнопка, которая на пару секунд отвечает на себе: «Скопировано». */
function useFlash() {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = (ok: boolean) => {
    setState(ok ? "done" : "fail");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  };
  return [state, flash] as const;
}

/**
 * «Копировать» с ответом прямо на кнопке: всплывашка вдали от пальца
 * остаётся незамеченной, а сомнение «скопировалось ли» гонит копировать
 * второй раз.
 */
export function CopyButton({ text, onCopied }: { text: string; onCopied?: () => void }) {
  const [state, flash] = useFlash();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!text.trim()}
      aria-live="polite"
      className={cn(state === "done" && "border-emerald-300 text-emerald-700")}
      onClick={async () => {
        const ok = await copyText(text);
        flash(ok);
        if (ok) onCopied?.();
      }}
    >
      {state === "done" ? <Check /> : <Copy />}
      {state === "done" ? "Скопировано" : state === "fail" ? "Не вышло" : "Копировать"}
    </Button>
  );
}

/**
 * Ссылка на скрипт — значок слева от «Копировать». Её кладут в CRM, базу
 * знаний, чат с коллегой: по ней скрипт открывается и подсвечивается.
 */
function LinkButton({ url }: { url: string }) {
  const [state, flash] = useFlash();
  const label = state === "done" ? "Ссылка скопирована" : "Копировать ссылку на скрипт";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      aria-live="polite"
      className={cn("text-muted-foreground", state === "done" && "text-emerald-700")}
      onClick={async () => flash(await copyText(url))}
    >
      {state === "done" ? <Check /> : <Link2 />}
    </Button>
  );
}

/** Одно сообщение: подпись, «Копировать» и текст на подложке. */
function MessageBlock({
  message,
  index,
  total,
  lang,
  terms,
  resolveVar,
  linkUrl,
  onCopied,
}: {
  message: ScriptMessage;
  index: number;
  total: number;
  lang: ScriptLang;
  terms: string[];
  resolveVar: VarResolver;
  /** Ссылка на скрипт — только у первого сообщения: одна на карточку. */
  linkUrl?: string;
  /** Скопировали текст — на каком языке он был на самом деле. */
  onCopied: (lang: ScriptLang) => void;
}) {
  const shown = messageText(message, lang);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase">
          {message.label || (total > 1 ? `Сообщение ${index + 1}` : "Текст")}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {linkUrl && <LinkButton url={linkUrl} />}
          <CopyButton
            text={resolveText(shown.text, resolveVar)}
            onCopied={() => onCopied(shown.lang)}
          />
        </span>
      </div>
      {shown.fallback && (
        <p className="text-xs font-medium text-amber-800">
          Текста на {langInfo(lang).inName} нет — показан {langInfo(shown.lang).name}.
        </p>
      )}
      <div
        className="rounded-md bg-muted/50 px-3 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap"
        lang={shown.lang}
      >
        <RichText text={shown.text} terms={terms} resolveVar={resolveVar} />
      </div>
    </div>
  );
}

export function ScriptCard({
  item,
  section,
  showSection,
  terms,
  lang,
  studio,
  onStudio,
  resolveRef,
  resolveId,
  resolveVar,
  flash,
  canEdit,
  onEdit,
  onSuggest,
  onMove,
  isFirst,
  isLast,
}: {
  item: ScriptItem;
  section: ScriptSection;
  /** В поиске — раздел меткой у названия. */
  showSection: boolean;
  terms: string[];
  lang: ScriptLang;
  studio: string;
  onStudio: (label: string) => void;
  resolveRef: (title: string) => (() => void) | null;
  resolveId: (id: string) => { open: () => void; title: string } | null;
  resolveVar: VarResolver;
  /** Открыли по ссылке — карточка подсвечена. */
  flash: boolean;
  canEdit: boolean;
  onEdit: () => void;
  /** «Предложить изменения» — у всех, кто видит скрипты. */
  onSuggest: () => void;
  onMove: (delta: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const variant = pickVariant(item, studio);
  const messages = variant.messages;
  const format = { terms, resolveRef, resolveVar, resolveId };

  return (
    <article
      id={`script-${item.id}`}
      className={cn(
        // Отступ при прокрутке к карточке — под закреплённой панелью поиска.
        "scroll-mt-36 sm:scroll-mt-28 overflow-hidden rounded-lg border bg-background transition-shadow duration-700",
        flash && "ring-2 ring-brand",
      )}
    >
      <header className="flex items-start gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-base leading-snug font-semibold">
            <Highlight text={item.title} terms={terms} />
          </h3>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              KIND_CHIP[item.kind] ?? KIND_CHIP.info,
            )}
          >
            {KIND_LABELS[item.kind] ?? item.kind}
          </span>
          {showSection && <Badge variant="outline">{section.title}</Badge>}
        </div>
        {/* Тихая кнопка: нужна редко и не должна спорить с названием. */}
        <Button
          variant="ghost"
          size="sm"
          className="-my-1 shrink-0 text-muted-foreground"
          title={`Предложить изменения в «${item.title}»`}
          onClick={onSuggest}
        >
          <Pencil />
          <span className="max-sm:hidden">Предложить изменения</span>
        </Button>
      </header>

      <div className="space-y-4 px-4 py-3">
        {item.note && (
          <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              Как использовать
            </span>
            <Formatted text={item.note} {...format} />
          </div>
        )}

        {item.variants.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase">Студия</span>
            <Tabs value={variant.label} onValueChange={onStudio}>
              <TabsList>
                {item.variants.map((v) => (
                  <TabsTrigger key={v.label} value={v.label}>
                    {v.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        )}

        {messages.map((message, i) => (
          <MessageBlock
            key={i}
            message={message}
            index={i}
            total={messages.length}
            lang={lang}
            terms={terms}
            resolveVar={resolveVar}
            linkUrl={i === 0 ? scriptUrl(section.id, item.id) : undefined}
            onCopied={(copiedLang) => logCopy(item.id, copiedLang, variant.label || studio)}
          />
        ))}

        {item.follow_up && (
          <div className="space-y-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm">
            <span className="text-xs font-medium text-blue-700 uppercase">❗ Дальше</span>
            <Formatted text={item.follow_up} {...format} />
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 flex-1 flex-wrap gap-x-2">
          {item.updated_at && <span className="tabular-nums">{formatWhen(item.updated_at)}</span>}
          {item.updated_by && <span>{item.updated_by}</span>}
          {item.change_note && <span className="text-foreground/80">— {item.change_note}</span>}
        </span>
        {canEdit && (
          <span className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isFirst}
              aria-label="Выше"
              title="Выше"
              onClick={() => onMove(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isLast}
              aria-label="Ниже"
              title="Ниже"
              onClick={() => onMove(1)}
            >
              <ArrowDown />
            </Button>
            {/* Удаление — в правке, с двойным подтверждением: здесь оно было
                бы в одном промахе от «Изменить». */}
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Изменить
            </Button>
          </span>
        )}
      </footer>
    </article>
  );
}
