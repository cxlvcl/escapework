import Link from "next/link";
import { pageUser } from "@/lib/auth";
import { stationList, statistics } from "@/lib/data";
import { dateLabel } from "@/lib/domain";
import { Shell } from "@/components/shell";
import { PageHeading, ProgressCard } from "@/components/display";
import { Button } from "@/components/ui/button";
export default async function Statistics({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; station?: string }>;
}) {
  const user = await pageUser("monitor");
  const query = await searchParams;
  const period =
    query.period === "yesterday" ||
    query.period === "week" ||
    query.period === "month"
      ? query.period
      : "today";
  const stations = await stationList();
  const station = stations.find((s) => s.id === query.station);
  const data = await statistics(period, station?.id);
  const labels = {
    today: "Сегодня",
    yesterday: "Вчера",
    week: "Неделя",
    month: "Месяц",
  };
  return (
    <Shell user={user} active="stats">
      <PageHeading
        eyebrow="Результаты кухни"
        title="Статистика"
        description="Рабочий день — с 04:00 до 04:00 МСК. История за 32 дня."
      />
      <Link
        href="/activity"
        className="mb-6 inline-block rounded-full border border-border bg-white px-5 py-3 text-sm"
      >
        Статистика активности →
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <nav className="stat-tabs" aria-label="Период">
          {Object.entries(labels).map(([key, label]) => (
            <Link
              aria-current={period === key ? "page" : undefined}
              href={`/statistics?period=${key}${station ? `&station=${station.id}` : ""}`}
              key={key}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form className="flex flex-1 gap-2" method="get">
          <input type="hidden" name="period" value={period} />
          <label className="sr-only" htmlFor="station-filter">
            Станция
          </label>
          <select
            className="filter-select min-w-0"
            id="station-filter"
            name="station"
            defaultValue={station?.id ?? ""}
          >
            <option value="">Вся кухня</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            Показать
          </Button>
        </form>
      </div>
      <ProgressCard
        {...data.summary}
        label={`${station?.name ?? "Вся кухня"} · ${labels[period].toLowerCase()}`}
      />
      {data.pending && (
        <p className="mt-4 text-sm text-muted-foreground">
          За предыдущий рабочий день пока нет данных. Итоги фиксируются после
          завершения дня в 04:00 МСК.
        </p>
      )}
      <section className="section">
        <h2 className="mb-4">По дням</h2>
        <div className="space-y-3">
          {data.days.map((d) => (
            <div
              className="card flex items-center justify-between gap-4"
              key={d.date}
            >
              <div>
                <p className="font-medium">{dateLabel(d.date)}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {d.finalized ? "Зафиксировано" : "Текущий прогресс"} ·{" "}
                  {d.completed} / {d.total}
                </p>
              </div>
              <strong className="text-2xl font-medium">{d.percent}%</strong>
            </div>
          ))}
          {!data.days.length && (
            <p className="empty">
              За этот период нет зафиксированной статистики.
            </p>
          )}
        </div>
      </section>
    </Shell>
  );
}
