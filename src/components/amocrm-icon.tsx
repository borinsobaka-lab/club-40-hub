import amocrmAsset from "@/assets/amocrm-icon.png.asset.json";
import { cn } from "@/lib/utils";

/**
 * Иконка amoCRM-ссылки. Открывает CRM-карточку клиента в новой вкладке.
 * Используется рядом с кликабельной фамилией/именем клиента, поэтому
 * по клику останавливаем всплытие, чтобы не открывалась карточка клиента.
 */
export function AmoCrmLinkIcon({
  href,
  className,
  size = 16,
  title = "Открыть в amoCRM",
}: {
  href: string | null | undefined;
  className?: string;
  size?: number;
  title?: string;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[4px] align-middle transition-opacity hover:opacity-80",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={amocrmAsset.url}
        alt="amoCRM"
        width={size}
        height={size}
        className="block h-full w-full rounded-[4px]"
        loading="lazy"
      />
    </a>
  );
}
