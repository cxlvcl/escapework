import { pageUser } from "@/lib/auth";
import {
  stationList,
  stationTasks,
  fridgeTasks,
  currentStats,
} from "@/lib/data";
import { Shell } from "@/components/shell";
import {
  Checklist,
  PageHeading,
  ProgressCard,
  StationGrid,
} from "@/components/display";
import { ShiftControl } from "@/components/controls";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string }>;
}) {
  const closed = (await searchParams).closed === "1";
  const user = await pageUser();
  const stations = await stationList();
  if (user.role === "cook") {
    if (!user.activeStationId)
      return (
        <Shell user={user}>
          <PageHeading
            eyebrow="Ваша кухня"
            title={`Здравствуйте, ${user.name}`}
            description="Откройте смену, чтобы приступить к задачам станции."
          />
          <section className="card max-w-lg py-10">
            <p className="eyebrow mb-4">Начало работы</p>
            <h2 className="mb-3">Всё начинается с чистоты</h2>
            <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
              Выберите станцию, на которой работаете сегодня. Чек-лист и
              прогресс общие для всех поваров станции.
            </p>
            {closed && (
              <p role="status" className="mb-5 text-lg font-medium">
                Смена завершена
              </p>
            )}
            <ShiftControl stations={stations} active={false} />
          </section>
        </Shell>
      );
    const [tasks, fridges] = await Promise.all([
      stationTasks(user.activeStationId),
      fridgeTasks(user.activeStationId),
    ]);
    const all = [...tasks, ...fridges],
      completed = all.filter((t) => t.completedAt).length;
    return (
      <Shell user={user}>
        <PageHeading
          eyebrow="Ваша станция"
          title={
            stations.find((s) => s.id === user.activeStationId)?.name ??
            "Станция"
          }
          action={
            <ShiftControl
              stations={stations}
              active
              total={all.length}
              completed={completed}
            />
          }
        />
        <ProgressCard completed={completed} total={all.length} />
        <Checklist tasks={tasks} fridges={fridges} canComplete />
      </Shell>
    );
  }
  const stats = await currentStats();
  return (
    <Shell user={user}>
      <PageHeading
        eyebrow="Контроль кухни"
        title="Порядок в каждом цехе"
        description={
          user.role !== "sous_chef"
            ? "Общий обзор выполнения. Режим просмотра."
            : "Текущая картина кухни — задачи, станции и результат."
        }
      />
      <ProgressCard {...stats.overall} label="Вся кухня · сегодня" />
      <section className="section">
        <div className="section-heading">
          <h2>Станции</h2>
          <span className="count-pill">9 станций</span>
        </div>
        <StationGrid stations={stations} stats={stats.stations} />
      </section>
    </Shell>
  );
}
