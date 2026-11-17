import { pageUser } from "@/lib/auth";
import { Shell } from "@/components/shell";
import { PageHeading } from "@/components/display";
import { Logout } from "@/components/controls";
import { roleLabels } from "@/lib/domain";
export default async function Profile() {
  const user = await pageUser("shift");
  return (
    <Shell user={user} active="profile">
      <PageHeading title="Профиль" />
      <div className="card max-w-lg">
        <p className="text-xl font-medium">{user.name}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {roleLabels[user.role]}
        </p>
        <dl className="my-6 border-y border-border py-5">
          <dt className="text-xs text-muted-foreground">Логин</dt>
          <dd className="mt-2">{user.login}</dd>
        </dl>
        <Logout />
      </div>
    </Shell>
  );
}
