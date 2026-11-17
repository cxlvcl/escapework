import { usersView } from "@/lib/data";
import { roleLabels } from "@/lib/domain";
import { pageUser } from "@/lib/auth";
import { Shell } from "@/components/shell";
import { PageHeading } from "@/components/display";
import { UserEditor, DeleteUser } from "@/components/manage";
export default async function Users() {
  const user = await pageUser("manage");
  const { users: accounts, roles } = await usersView();
  return (
    <Shell user={user} active="users">
      <PageHeading
        eyebrow="Команда кухни"
        title="Пользователи"
        description="Создание и редактирование аккаунтов с выбором роли."
        action={<UserEditor roles={roles} />}
      />
      <div className="space-y-3">
        {accounts.map((c) => (
          <div
            className="card flex flex-wrap items-center justify-between gap-4"
            key={c.id}
          >
            <div>
              <h2 className="text-base">{c.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {c.login} · {roleLabels[c.role]}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <UserEditor user={c} roles={roles} />
              <DeleteUser user={c} />
            </div>
          </div>
        ))}
        {!accounts.length && <p className="empty">Аккаунтов пока нет.</p>}
      </div>
    </Shell>
  );
}
