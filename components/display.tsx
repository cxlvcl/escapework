import Link from "next/link";
import { ArrowUpRight, Check, Refrigerator } from "lucide-react";
import { progress } from "@/lib/domain";
import type { Task } from "@/lib/data";
import { TaskCard } from "./task-card";
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
export function ProgressCard({
  completed,
  total,
  label = "Текущий прогресс",
}: {
  completed: number;
  total: number;
  label?: string;
}) {
  const p = progress(completed, total);
  return (
    <section className="progress-card">
      <div>
        <p className="text-sm text-white/65">{label}</p>
        <div className="progress-value">
          {p.percent}
          <span>%</span>
        </div>
        <p className="text-sm text-white/65">
          <strong className="font-medium text-white">{completed}</strong> из{" "}
          {total} задач выполнено
        </p>
      </div>
      <div className="progress-side">
        <div
          className="progress-ring"
          style={{
            background: `conic-gradient(#fff ${p.percent}%, #ffffff25 0)`,
          }}
        >
          <span>
            {p.percent === 100 ? (
              <Check size={27} />
            ) : (
              <span>
                {p.remaining}
                <small>осталось</small>
              </span>
            )}
          </span>
        </div>
      </div>
      <div className="progress-track">
        <div style={{ width: `${p.percent}%` }} />
      </div>
    </section>
  );
}
export function StationGrid({
  stations,
  stats,
}: {
  stations: { id: string; name: string }[];
  stats: {
    id: string;
    completed: number;
    total: number;
    percent: number;
    remaining: number;
  }[];
}) {
  return (
    <div className="station-grid">
      {stations.map((s, i) => {
        const p = stats.find((p) => p.id === s.id) ?? progress(0, 0);
        return (
          <Link className="station-card" key={s.id} href={`/stations/${s.id}`}>
            <div className="flex items-center justify-between">
              <span className="station-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <ArrowUpRight size={19} className="text-muted-foreground" />
            </div>
            <h3>{s.name}</h3>
            <div className="mt-6 flex items-end justify-between">
              <strong className="text-3xl font-medium tracking-tight">
                {p.percent}
                <span className="ml-1 text-base">%</span>
              </strong>
              <span className="text-sm text-muted-foreground">
                {p.completed} / {p.total}
              </span>
            </div>
            <div className="small-progress">
              <span style={{ width: `${p.percent}%` }} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {p.remaining === 0
                ? "Все задачи выполнены"
                : `Не выполнено: ${p.remaining}`}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
export function Checklist({
  tasks,
  fridges,
  canComplete,
}: {
  tasks: Task[];
  fridges: Task[];
  canComplete: boolean;
}) {
  return (
    <>
      <section className="section">
        <div className="section-heading">
          <h2>Задачи станции</h2>
          <span className="count-pill">
            {tasks.filter((t) => t.completedAt).length} / {tasks.length}
          </span>
        </div>
        <div className="task-list">
          {tasks
            .filter((t) => t.taskType === "main")
            .map((t) => (
              <TaskCard key={t.id} task={t} canComplete={canComplete} />
            ))}
          {tasks.some((t) => t.taskType === "individual") && (
            <h3 className="mt-4 mb-1 text-sm text-muted-foreground">
              Индивидуальные задачи
            </h3>
          )}
          {tasks
            .filter((t) => t.taskType === "individual")
            .map((t) => (
              <TaskCard key={t.id} task={t} canComplete={canComplete} />
            ))}
          {!tasks.length && <p className="empty">Задач станции пока нет.</p>}
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <h2>Холодильники</h2>
          <span className="count-pill">
            {new Set(fridges.map((t) => t.refrigeratorId)).size}
          </span>
        </div>
        <div className="fridge-grid">
          {[...new Set(fridges.map((t) => t.refrigeratorId))].map((id) => {
            const rows = fridges.filter((t) => t.refrigeratorId === id);
            return (
              <details key={id} className="fridge-card">
                <summary>
                  <span className="flex items-center gap-3">
                    <Refrigerator size={20} />
                    Холодильник №{rows[0].refrigeratorNumber}
                  </span>
                  <span className="count-pill">
                    {rows.filter((t) => t.completedAt).length} / {rows.length}
                  </span>
                </summary>
                <div className="mt-4 space-y-2">
                  {rows.map((t) => (
                    <TaskCard key={t.id} task={t} canComplete={canComplete} />
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </section>
    </>
  );
}
