/**
 * Теги статей базы знаний (решение владельца 2026-10-25) — логика без React.
 * Схема — db/migrations/2026-10-25_zzzzzzzzz_kb_tags.sql: теги свои у
 * каждой базы, имя без регистра уникально, у статьи — до 10 тегов.
 */

export type KbTag = { id: string; name: string };

/** Теги статей базы: статья → id её тегов. */
export type KbNodeTags = Map<string, string[]>;

export const KB_TAG_MAX_LENGTH = 40;
export const KB_TAGS_PER_ARTICLE = 10;

/** Как имя сохранит база: без «#» в начале, пробелов по краям и двойных пробелов. */
export function normalizeTagName(raw: string): string {
  return raw
    .replace(/^\s*#+/, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, KB_TAG_MAX_LENGTH);
}

const key = (s: string) => normalizeTagName(s).toLocaleLowerCase("ru");

/** Тег с тем же именем (без регистра) — чтобы не заводить второй «Касса». */
export function findTagByName(tags: KbTag[], name: string): KbTag | undefined {
  const k = key(name);
  return k ? tags.find((t) => key(t.name) === k) : undefined;
}

export function sortTags(tags: KbTag[]): KbTag[] {
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/**
 * Теги под строку поиска: имя содержит запрос («#» не мешает). Сначала
 * точное совпадение, затем начинающиеся с запроса, затем остальные по имени.
 */
export function matchTags(tags: KbTag[], query: string): KbTag[] {
  const q = key(query);
  if (!q) return [];
  const rank = (t: KbTag) => {
    const n = key(t.name);
    return n === q ? 0 : n.startsWith(q) ? 1 : 2;
  };
  return tags
    .filter((t) => key(t.name).includes(q))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ru"));
}

/** Строки kb_node_tags → статья → её теги (по имени тега). */
export function groupNodeTags(
  rows: { node_id: string; tag_id: string }[],
  tags: KbTag[],
): KbNodeTags {
  const order = new Map(sortTags(tags).map((t, i) => [t.id, i]));
  const map: KbNodeTags = new Map();
  for (const r of rows) {
    if (!order.has(r.tag_id)) continue;
    const list = map.get(r.node_id) ?? [];
    list.push(r.tag_id);
    map.set(r.node_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => order.get(a)! - order.get(b)!);
  return map;
}

/** Сколько статей с каждым тегом — только из тех, что прошли `counts`. */
export function tagArticleCounts(
  nodeTags: KbNodeTags,
  counts: (nodeId: string) => boolean,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [nodeId, ids] of nodeTags) {
    if (!counts(nodeId)) continue;
    for (const id of ids) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/** Статьи с тегом. */
export function nodesWithTag(nodeTags: KbNodeTags, tagId: string): string[] {
  return [...nodeTags].filter(([, ids]) => ids.includes(tagId)).map(([nodeId]) => nodeId);
}

/** Что поменять в kb_node_tags: какие добавить и какие снять. */
export function tagDiff(prev: string[], next: string[]): { add: string[]; remove: string[] } {
  return {
    add: next.filter((id) => !prev.includes(id)),
    remove: prev.filter((id) => !next.includes(id)),
  };
}
