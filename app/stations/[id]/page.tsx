import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { pageUser } from "@/lib/auth";
import { stationList, stationTasks, fridgeTasks, managedRefrigerators } from "@/lib/data";
import { Shell } from "@/components/shell";
import { PageHeading, ProgressCard, Checklist } from "@/components/display";
import { TaskManagement } from "@/components/manage";
export default async function Station({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await pageUser("monitor");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const stations = await stationList();
  const station = stations.find((s) => s.id === id);
  if (!station) notFound();
  const [tasks, fridges, refrigerators] = await Promise.all([
    stationTasks(id),
    fridgeTasks(id),
    managedRefrigerators(id),
  ]);
  const all = [...tasks, ...fridges];
  return (
    <Shell user={user} active="stations">
      <Link
        href="/stations"
        className="mb-5 inline-block py-2 text-sm text-muted-foreground"
      >
        ← Все станции
      </Link>
      <PageHeading eyebrow="Станция" title={station.name} />
      <ProgressCard
        completed={all.filter((t) => t.completedAt).length}
        total={all.length}
      />
      <Checklist tasks={tasks} fridges={fridges} canComplete={false} />
      {user.role === "sous_chef" && (
        <>
        <TaskManagement stationId={id} tasks={tasks} />
        {refrigerators.map(r => <TaskManagement key={r.id} stationId={id} refrigeratorId={r.id} refrigeratorNumber={r.number} tasks={fridges.filter(t => t.refrigeratorId === r.id)} />)}
        </>
      )}
    </Shell>
  );
}
