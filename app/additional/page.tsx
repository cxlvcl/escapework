import Link from "next/link";
import { AdditionalTypes } from "@/components/additional-types";
import { pageUser } from "@/lib/auth";
import { additionalView } from "@/lib/data";
import { Shell } from "@/components/shell";
import { PageHeading } from "@/components/display";
import { TaskCard } from "@/components/task-card";
import { AssignTask } from "@/components/manage";
export default async function Additional({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const query = await searchParams;
  const user = await pageUser();
  const { tasks, types, cooks } = await additionalView();
  const catalog = user.role === "sous_chef" && query.tab === "types";
  return (
    <Shell user={user} active="additional">
      <PageHeading
        eyebrow="На сегодня"
        title="Дополнительные задачи"
        description={
          user.role === "cook"
            ? "Назначенные вам задачи. Выполнение общее для всех назначенных поваров."
            : "Задачи кухни вне чек-листов станций."
        }
        action={
          user.role === "sous_chef" ? (
            <AssignTask
              types={types.filter((t) => t.is_active)}
              cooks={cooks}
            />
          ) : undefined
        }
      />
      {user.role === "sous_chef" && (
        <nav className="stat-tabs mb-6" aria-label="Дополнительные задачи">
          <Link href="/additional" aria-current={!catalog ? "page" : undefined}>
            Назначенные задачи
          </Link>
          <Link
            href="/additional?tab=types"
            aria-current={catalog ? "page" : undefined}
          >
            Типы задач
          </Link>
        </nav>
      )}
      {catalog ? (
        <AdditionalTypes types={types} />
      ) : (
        <div className="task-list">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} canComplete={user.role === "cook"} />
          ))}
          {!tasks.length && (
            <p className="empty">Дополнительных задач на сегодня нет.</p>
          )}
        </div>
      )}
    </Shell>
  );
}
