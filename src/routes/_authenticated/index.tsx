import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Users, CalendarDays, Music2, TrendingUp } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — CLUB 40 Admin" },
      { name: "description", content: "CLUB 40 admin panel dashboard overview." },
    ],
  }),
  component: Dashboard,
});

interface Activity {
  id: number;
  text: string;
  time: string;
}

const initialActivity: Activity[] = [
  { id: 1, text: "New member Alex Carter joined", time: "2 min ago" },
  { id: 2, text: "Event 'Saturday Night Live' published", time: "1 hr ago" },
  { id: 3, text: "DJ Mira added to lineup", time: "3 hr ago" },
  { id: 4, text: "Announcement sent to 412 members", time: "Yesterday" },
];

function Dashboard() {
  const [activity] = useState<Activity[]>(initialActivity);

  const stats = [
    { label: "Members", value: "1,284", icon: Users, delta: "+24 this week" },
    { label: "Upcoming Events", value: "7", icon: CalendarDays, delta: "Next: Fri 11pm" },
    { label: "Tracks in Library", value: "342", icon: Music2, delta: "+12 today" },
    { label: "Engagement", value: "87%", icon: TrendingUp, delta: "+4.2% MoM" },
  ];

  return (
    <AdminShell
      title="Dashboard"
      description="Overview of your club"
      actions={
        <>
          <Badge variant="secondary">Local preview</Badge>
          <Button size="sm">New event</Button>
        </>
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {s.label}
                </CardTitle>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{s.value}</div>
                <p className="text-xs text-muted-foreground">{s.delta}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-3 text-sm">
                    <span>{a.text}</span>
                    <span className="text-xs text-muted-foreground">{a.time}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Backend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                No backend is connected yet. Wire up your external Supabase project when
                you're ready and replace the placeholder data on this dashboard.
              </p>
              <Badge variant="outline">External Supabase pending</Badge>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}
