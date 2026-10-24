/**
 * Документ статьи (BlockNote, массив блоков) без React: оглавление и
 * «пустая ли статья». Схема блоков — components/kb/kb-document.tsx.
 */

export type KbHeading = { id: string; level: number; text: string };

type Inline = { type?: string; text?: string; content?: Inline[] | string };
type Block = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: Inline[] | unknown;
  children?: Block[];
};

function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Inline[])
    .map((c) => (typeof c === "string" ? c : (c.text ?? inlineText(c.content))))
    .join("");
}

/** Заголовки документа по порядку (и во вложенных блоках) — оглавление. */
export function documentHeadings(doc: unknown[] | null | undefined): KbHeading[] {
  const out: KbHeading[] = [];
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type === "heading" && b.id) {
        const text = inlineText(b.content).trim();
        if (text) out.push({ id: b.id, level: Number(b.props?.level ?? 1), text });
      }
      if (b.children?.length) walk(b.children);
    }
  };
  walk((Array.isArray(doc) ? doc : []) as Block[]);
  return out;
}

/** В документе нет ни текста, ни файлов (новая статья, пустой абзац). */
export function documentIsEmpty(doc: unknown[] | null | undefined): boolean {
  const walk = (blocks: Block[]): boolean =>
    blocks.every((b) => {
      const props = b.props ?? {};
      const hasFile = typeof props.url === "string" && props.url !== "";
      const hasGallery = typeof props.images === "string" && props.images !== "[]";
      const textless = !inlineText(b.content).trim();
      const plain = b.type === "paragraph" || b.type === "heading" || !b.type;
      return plain && textless && !hasFile && !hasGallery && walk(b.children ?? []);
    });
  return walk((Array.isArray(doc) ? doc : []) as Block[]);
}
