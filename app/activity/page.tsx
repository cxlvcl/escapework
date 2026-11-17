import Link from "next/link";
import { pageUser } from "@/lib/auth";
import { activityView } from "@/lib/data";
import {
  activityLabels,
  roleLabels,
  dateLabel,
  dateOffset,
  type ActivityLevel,
} from "@/lib/domain";
import { Shell } from "@/components/shell";
import { PageHeading } from "@/components/display";
export default async function Activity() {
  const user = await pageUser("activity");
  const data = await activityView();
  return (
    <Shell user={user} active="activity">
      <Link
        href="/statistics"
        className="mb-5 inline-block text-sm underline underline-offset-4"
      >
        К статистике кухни
      </Link>
      <PageHeading
        eyebrow="Команда кухни"
        title="Статистика активности"
        description={`${dateLabel(data.start)} — ${dateLabel(dateOffset(data.end, -1))} · календарная неделя, МСК`}
      />
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        {(["high", "medium", "low"] as ActivityLevel[]).map((level) => (
          <div className="card" key={level}>
            <p className="text-sm text-muted-foreground">
              {activityLabels[level]}
            </p>
            <p className="mt-3 text-3xl font-semibold">{data.summary[level]}</p>
            <p className="mt-1 text-xs text-muted-foreground">поваров</p>
          </div>
        ))}
      </div>
      <section className="section">
        <h2 className="mb-4">Повара</h2>
        <div className="space-y-3">
          {data.users.map((person) => (
            <div
              className="card flex flex-wrap items-center justify-between gap-3"
              key={person.id}
            >
              <div>
                <h3 className="text-base">{person.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {roleLabels[person.role]}
                </p>
              </div>
              <span className="rounded-full bg-black/5 px-3 py-2 text-sm">
                {activityLabels[person.level]}
              </span>
            </div>
          ))}
        </div>
        {!data.users.length && <p className="empty">Поваров пока нет.</p>}
      </section>
    </Shell>
  );
}
