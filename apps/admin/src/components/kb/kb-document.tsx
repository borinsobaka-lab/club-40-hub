/**
 * Документ статьи базы знаний — редактор BlockNote (MPL-2.0, собран в наш
 * бандл, облака и внешних запросов нет; выбор эмодзи — он тянул данные с CDN —
 * выключен). Один компонент на чтение и правку: `editable={false}` — читатель
 * видит ту же разметку. Грузится отдельным чанком (lazy).
 *
 * Блоки: все стандартные, кроме блока кода (по брифу не нужен), и свои —
 * «PDF» (просмотр в статье) и «Галерея» (картинки в ряд). Файлы — в закрытом
 * бакете kb-media (lib/kb/files.ts): в документе ссылка `kbfile:…`, на
 * показ — подписанная ссылка. Внешние адреса в документ не попадают: панель
 * файлов — только «Загрузить», картинки из вставленного текста (Word, Google
 * Docs) перезаливаются к нам.
 */
import "@blocknote/shadcn/style.css";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  filterSuggestionItems,
  type PartialBlock,
} from "@blocknote/core";
import { ru } from "@blocknote/core/locales";
import {
  createReactBlockSpec,
  FileBlockWrapper,
  FilePanelController,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useBlockNoteEditor,
  useCreateBlockNote,
  useResolveUrl,
  type DefaultReactSuggestionItem,
  type FilePanelProps,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, FileText, Images, Link2, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import {
  formatFileSize,
  isKbFile,
  KB_MAX_FILE_BYTES,
  KbFileTooLarge,
  resolveKbFileUrl,
  uploadKbFile,
} from "@/lib/kb/files";
import { documentHeadings, type KbHeading } from "@/lib/kb/document";
import { cn } from "@/lib/utils";

// --- PDF ----------------------------------------------------------------------

/**
 * PDF в статье: просмотр браузера (через blob — ему не мешают заголовки
 * Storage о встраивании) и «Открыть» в новой вкладке. Высота — у блока.
 */
const PdfBlock = createReactBlockSpec(
  {
    type: "pdf",
    propSchema: {
      name: { default: "" },
      url: { default: "" },
      caption: { default: "" },
      showPreview: { default: true },
    },
    content: "none",
  },
  {
    meta: { fileBlockAccept: ["application/pdf"] },
    render: (props) => (
      // Обёртка файлового блока (кнопка «Добавить файл», подпись) типизирована
      // под стандартный блок файла — свойства у PDF те же.
      <FileBlockWrapper
        {...(props as unknown as Parameters<typeof FileBlockWrapper>[0])}
        buttonIcon={<FileText className="size-6" />}
      >
        <PdfPreview url={props.block.props.url} name={props.block.props.name} />
      </FileBlockWrapper>
    ),
  },
);

function PdfPreview({ url, name }: { url: string; name: string }) {
  const resolved = useResolveUrl(url);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const href = resolved.loadingState === "loaded" ? resolved.downloadUrl : null;

  useEffect(() => {
    if (!href) return;
    let revoked = false;
    let objectUrl: string | null = null;
    fetch(href)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(new Blob([b], { type: "application/pdf" }));
        setBlobUrl(objectUrl);
      })
      .catch(() => setBlobUrl(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [href]);

  return (
    <div
      className="kb-pdf w-full overflow-hidden rounded-lg border bg-muted/30"
      contentEditable={false}
    >
      <div className="flex items-center gap-2 border-b bg-background px-3 py-2 text-sm">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{name || "Документ PDF"}</span>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
            Открыть
          </a>
        )}
      </div>
      {blobUrl ? (
        <iframe
          title={name || "PDF"}
          src={blobUrl}
          className="h-[70vh] max-h-[900px] w-full bg-white"
        />
      ) : (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Загружаем документ…
        </div>
      )}
    </div>
  );
}

// --- Галерея ------------------------------------------------------------------

type GalleryImage = { url: string; name: string };

/** Что галерее нужно от редактора (типы BlockNote зависят от схемы). */
type GalleryEditor = {
  isEditable: boolean;
  uploadFile?: (file: File, blockId?: string) => Promise<string | Record<string, unknown>>;
  updateBlock: (id: string, update: { props: { images: string } }) => unknown;
  getBlock: (id: string) => { props: { images: string } } | undefined;
};

function parseImages(raw: string): GalleryImage[] {
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list)
      ? list.filter((i): i is GalleryImage => !!i && typeof (i as GalleryImage).url === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Несколько картинок в один ряд (по брифу: «нельзя поставить 2 картинки в
 * ряд»). Колонок — сколько картинок, до четырёх; дальше — следующий ряд.
 * На телефоне — по две.
 */
const GalleryBlock = createReactBlockSpec(
  {
    type: "gallery",
    propSchema: {
      images: { default: "[]" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <Gallery block={block} editor={editor as unknown as GalleryEditor} />
    ),
  },
);

function Gallery({
  block,
  editor,
}: {
  block: { id: string; props: { images: string } };
  editor: GalleryEditor;
}) {
  const images = parseImages(block.props.images);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const editable = editor.isEditable;
  const set = (list: GalleryImage[]) =>
    editor.updateBlock(block.id, { props: { images: JSON.stringify(list) } });

  const add = async (files: FileList | null) => {
    if (!files?.length || !editor.uploadFile) return;
    const picked = [...files].filter((f) => f.type.startsWith("image/"));
    setUploading((n) => n + picked.length);
    const added: GalleryImage[] = [];
    for (const f of picked) {
      try {
        const url = (await editor.uploadFile(f, block.id)) as string;
        added.push({ url, name: f.name });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось загрузить картинку");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    // Документ мог поменяться, пока грузили, — берём свежий блок.
    const current = editor.getBlock(block.id);
    if (current) set([...parseImages(current.props.images), ...added]);
  };

  const cols = Math.min(Math.max(images.length, 1), 4);
  return (
    <div className="kb-gallery w-full" contentEditable={false}>
      {images.length > 0 && (
        <div
          className="grid gap-2 max-sm:!grid-cols-2"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {images.map((img, i) => (
            <GalleryItem
              key={`${img.url}-${i}`}
              image={img}
              editable={editable}
              onRemove={() => set(images.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}
      {editable && (
        <div className={cn("flex items-center gap-2", images.length > 0 && "mt-2")}>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : images.length ? (
              <Plus className="size-4" />
            ) : (
              <Images className="size-4" />
            )}
            {uploading
              ? "Загружаем…"
              : images.length
                ? "Добавить картинки"
                : "Картинки в ряд — выберите файлы"}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}

function GalleryItem({
  image,
  editable,
  onRemove,
}: {
  image: GalleryImage;
  editable: boolean;
  onRemove: () => void;
}) {
  const resolved = useResolveUrl(image.url);
  return (
    <figure className="group/gi relative overflow-hidden rounded-md bg-muted/40">
      {resolved.loadingState === "loaded" ? (
        <a
          href={resolved.downloadUrl}
          target="_blank"
          rel="noreferrer"
          tabIndex={editable ? -1 : 0}
        >
          <img
            src={resolved.downloadUrl}
            alt={image.name}
            className="h-full max-h-[420px] w-full object-cover"
          />
        </a>
      ) : (
        <div className="aspect-[4/3] animate-pulse" />
      )}
      {editable && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Убрать «${image.name}»`}
          className="absolute top-1.5 right-1.5 inline-flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover/gi:opacity-100 focus-visible:opacity-100"
        >
          <X className="size-4" />
        </button>
      )}
    </figure>
  );
}

// --- Схема ----------------------------------------------------------------------

// Блок кода по брифу не нужен — из схемы и меню «/» его убираем.
const { codeBlock: _codeBlock, ...blockSpecs } = defaultBlockSpecs;

const kbSchema = BlockNoteSchema.create({
  blockSpecs: { ...blockSpecs, pdf: PdfBlock(), gallery: GalleryBlock() },
});

type KbEditor = typeof kbSchema.BlockNoteEditor;

/** Ссылка на статью базы для меню «/» и всплывающего «Ссылка на статью». */
export type KbArticleLink = { title: string; href: string };

function slashItems(
  editor: KbEditor,
  onPickArticle?: () => Promise<KbArticleLink | null>,
): DefaultReactSuggestionItem[] {
  const insertBlock = (block: PartialBlock<typeof kbSchema.blockSchema>) => {
    const cur = editor.getTextCursorPosition().block;
    const empty = Array.isArray(cur.content) && cur.content.length === 0;
    if (empty) editor.replaceBlocks([cur], [block]);
    else editor.insertBlocks([block], cur, "after");
  };
  const items = getDefaultReactSlashMenuItems(editor);
  // Меню группирует подряд идущие пункты: свой пункт встаёт сразу после
  // последнего из его группы, иначе группа выходит в меню дважды.
  const add = (item: DefaultReactSuggestionItem) => {
    const groups = items.map((i) => i.group);
    const at = groups.lastIndexOf(item.group);
    items.splice(at < 0 ? items.length : at + 1, 0, item);
  };
  const media = ru.slash_menu.image.group;
  const basic = ru.slash_menu.paragraph.group;
  const custom: DefaultReactSuggestionItem[] = [
    {
      title: "PDF",
      subtext: "Документ с просмотром прямо в статье",
      aliases: ["pdf", "пдф", "документ"],
      group: media,
      icon: <FileText className="size-[18px]" />,
      onItemClick: () => insertBlock({ type: "pdf" }),
    },
    {
      title: "Картинки в ряд",
      subtext: "Две-четыре картинки рядом",
      aliases: ["галерея", "ряд", "картинки", "фото"],
      group: media,
      icon: <Images className="size-[18px]" />,
      onItemClick: () => insertBlock({ type: "gallery" }),
    },
  ];
  custom.forEach(add);
  if (onPickArticle) {
    add({
      title: "Ссылка на статью",
      subtext: "Другая статья этой базы знаний",
      aliases: ["ссылка", "статья", "link"],
      group: basic,
      icon: <Link2 className="size-[18px]" />,
      onItemClick: async () => {
        const link = await onPickArticle();
        if (!link) return;
        editor.insertInlineContent([{ type: "link", href: link.href, content: link.title }, " "]);
      },
    });
  }
  return items;
}

// --- Перезаливка картинок из вставленного текста ----------------------------------

type AnyBlock = { id: string; type: string; props: Record<string, unknown>; children?: AnyBlock[] };

function* walkBlocks(blocks: AnyBlock[]): Generator<AnyBlock> {
  for (const b of blocks) {
    yield b;
    if (b.children?.length) yield* walkBlocks(b.children);
  }
}

/** Картинки из Word (data:) и Google Docs (временные ссылки) — к нам в бакет. */
async function reuploadForeignImages(
  editor: KbEditor,
  pending: Set<string>,
  upload: (file: File) => Promise<string>,
) {
  for (const b of walkBlocks(editor.document as unknown as AnyBlock[])) {
    if (b.type !== "image") continue;
    const url = String(b.props.url ?? "");
    if (!url || isKbFile(url) || pending.has(b.id)) continue;
    pending.add(b.id);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const ext = (blob.type.split("/")[1] ?? "png").replace("jpeg", "jpg").slice(0, 5);
      const file = new File([blob], `pasted.${ext}`, { type: blob.type || "image/png" });
      const kbUrl = await upload(file);
      if (editor.getBlock(b.id)) editor.updateBlock(b.id, { props: { url: kbUrl } } as never);
    } catch {
      toast.error(
        "Картинку из вставленного текста не удалось перенести к нам — загрузите её файлом (кнопка «Загрузить» у картинки).",
      );
    } finally {
      pending.delete(b.id);
    }
  }
}

/** Какие файлы выбирать в панели — по типу блока. */
const FILE_ACCEPT: Record<string, string> = {
  image: "image/*",
  video: "video/mp4,video/quicktime,video/webm,video/*",
  audio: "audio/*",
  pdf: "application/pdf",
};
const FILE_HINT: Record<string, string> = {
  image: "PNG, JPG, GIF или WEBP",
  video: "MP4 (H.264) — играет во всех браузерах; MOV с iPhone — не везде",
  audio: "MP3, WAV или M4A — например, запись звонка",
  pdf: "Документ PDF — откроется прямо в статье",
  file: "Любой документ: Word, Excel, презентация, архив",
};

/**
 * Панель файла — только загрузка с компьютера: вкладка «Ссылка» BlockNote
 * вставляла бы файл с чужого сервера (решение владельца — всё на нашем).
 * Своя вёрстка вместо голого «Choose File» браузера: кнопка, что подходит,
 * лимит.
 */
function UploadOnlyFilePanel({ blockId }: FilePanelProps) {
  const editor = useBlockNoteEditor();
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const block = editor.getBlock(blockId);
  const type = block?.type ?? "file";

  const pick = async (file: File | undefined) => {
    if (!file || !editor.uploadFile) return;
    setLoading(true);
    try {
      const url = await editor.uploadFile(file, blockId);
      editor.updateBlock(blockId, { props: { name: file.name, url } } as never);
    } catch {
      // текст ошибки уже показал uploadFile
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bn-panel w-80 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md">
      <button
        type="button"
        disabled={loading}
        onClick={() => input.current?.click()}
        className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {loading ? "Загружаем…" : "Выбрать файл"}
      </button>
      <p className="mt-2 text-xs text-muted-foreground">
        {FILE_HINT[type] ?? FILE_HINT.file}. До {formatFileSize(KB_MAX_FILE_BYTES)}.
      </p>
      <input
        ref={input}
        type="file"
        hidden
        accept={FILE_ACCEPT[type]}
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// --- Компонент --------------------------------------------------------------------

export function KbDocument({
  baseId,
  nodeId,
  initial,
  editable,
  onChange,
  onHeadings,
  onPickArticle,
  onReady,
}: {
  baseId: string;
  nodeId: string;
  /** Документ BlockNote (массив блоков); null или пусто — пустая статья. */
  initial: unknown[] | null;
  editable: boolean;
  onChange?: (doc: unknown[]) => void;
  /** Заголовки — для оглавления (при каждой правке). */
  onHeadings?: (headings: KbHeading[]) => void;
  /** «Ссылка на статью» в меню «/»: окно выбора статьи. */
  onPickArticle?: () => Promise<KbArticleLink | null>;
  /** Документ, каким его открыли (уже с id блоков) — точка отсчёта правок. */
  onReady?: (doc: unknown[]) => void;
}) {
  const navigate = useNavigate();
  const pending = useRef(new Set<string>());
  const upload = useMemo(
    () => async (file: File) => {
      try {
        return await uploadKbFile(baseId, nodeId, file);
      } catch (e) {
        toast.error(
          e instanceof KbFileTooLarge
            ? e.message
            : `Не удалось загрузить файл: ${(e as Error).message}`,
        );
        throw e;
      }
    },
    [baseId, nodeId],
  );

  const editor = useCreateBlockNote(
    {
      schema: kbSchema,
      dictionary: ru,
      initialContent:
        Array.isArray(initial) && initial.length > 0
          ? (initial as PartialBlock<typeof kbSchema.blockSchema>[])
          : undefined,
      uploadFile: upload,
      resolveFileUrl: resolveKbFileUrl,
      tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
      tabBehavior: "prefer-indent",
    },
    [nodeId],
  );

  // Оглавление и точка отсчёта — при открытии документа; дальше — onChange.
  const mountRef = useRef({ onHeadings, onReady });
  mountRef.current = { onHeadings, onReady };
  useEffect(() => {
    const doc = editor.document as unknown[];
    mountRef.current.onHeadings?.(documentHeadings(doc));
    mountRef.current.onReady?.(doc);
  }, [editor]);

  return (
    <div
      className={cn("kb-document", !editable && "kb-document-read")}
      onClick={(e) => {
        // Ссылки на статьи базы — переходом внутри админки, без перезагрузки.
        if (editable) return;
        const a = (e.target as HTMLElement).closest("a");
        const href = a?.getAttribute("href");
        if (!href || !href.startsWith("/kb/") || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        void navigate({ to: href });
      }}
    >
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme="light"
        emojiPicker={false}
        filePanel={false}
        slashMenu={false}
        onChange={() => {
          const doc = editor.document as unknown[];
          onChange?.(doc);
          onHeadings?.(documentHeadings(doc));
          if (editable) void reuploadForeignImages(editor, pending.current, upload);
        }}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(slashItems(editor, onPickArticle), query)
          }
        />
        <FilePanelController filePanel={UploadOnlyFilePanel} />
      </BlockNoteView>
    </div>
  );
}
