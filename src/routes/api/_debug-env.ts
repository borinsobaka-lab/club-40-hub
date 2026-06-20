import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/_debug-env")({
  server: {
    handlers: {
      GET: async () => {
        const keys = Object.keys(process.env)
          .filter((k) => /supabase|sb_|lovable/i.test(k))
          .sort();
        return Response.json({ keys });
      },
    },
  },
});
