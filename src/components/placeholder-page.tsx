import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent } from "@/components/ui/card";

export function PlaceholderPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <AdminShell title={title} description={description}>
      <div className="mx-auto max-w-4xl">
        <Card>
          <CardContent className="flex min-h-[300px] flex-col items-center justify-center gap-2 py-12 text-center">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {children ??
                "Этот раздел — часть навигационной оболочки. Подключите его после интеграции внешнего Supabase."}
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
