import Link from "next/link";
import {
  House,
  LayoutGrid,
  ListChecks,
  Users,
  ChartNoAxesCombined,
  UserRound,
  Images,
  CheckCheck,
  ChefHat,
} from "lucide-react";
import type { AuthUser } from "@/lib/auth";
import { roleLabels, workDate, dateLabel } from "@/lib/domain";
import { AutoRefresh, Logout } from "./controls";
const items = {
  home: { href: "/", label: "Главная", Icon: House },
  stations: { href: "/stations", label: "Станции", Icon: LayoutGrid },
  additional: { href: "/additional", label: "Доп. задачи", Icon: ListChecks },
  users: { href: "/users", label: "Пользователи", Icon: Users },
  stats: {
    href: "/statistics",
    label: "Статистика",
    Icon: ChartNoAxesCombined,
  },
  activity: {
    href: "/activity",
    label: "Статистика активности",
    Icon: ChartNoAxesCombined,
  },
  profile: { href: "/profile", label: "Профиль", Icon: UserRound },
  completed: { href: "/completed", label: "Выполненные", Icon: CheckCheck },
  photos: { href: "/photos", label: "Фотографии", Icon: Images },
};
export function Shell({
  user,
  active = "home",
  children,
}: {
  user: AuthUser;
  active?: keyof typeof items;
  children: React.ReactNode;
}) {
  const keys: (keyof typeof items)[] =
    user.role === "cook"
      ? ["home", "additional", "profile"]
      : user.role === "sous_chef"
        ? ["home", "stations", "additional", "users", "photos", "stats"]
        : ["home", "stations", "completed", "additional", "photos", "stats"];
  return (
    <div className="app-shell">
      <AutoRefresh />
      <aside className="sidebar">
        <div className="brand-label">
          <ChefHat size={23} />
          <div>
            Кухня <span>ESCAPE RESTAURANT</span>
          </div>
        </div>
        <p className="eyebrow mt-10 mb-4">Рабочее пространство</p>
        <nav className="desktop-nav" aria-label="Основная навигация">
          {[
            ...keys,
            ...(user.role !== "cook" ? ["activity" as const] : []),
          ].map((k) => {
            const { href, label, Icon } = items[k];
            return (
              <Link
                key={k}
                href={href}
                aria-current={
                  active === k || (k === "stats" && active === "activity")
                    ? "page"
                    : undefined
                }
              >
                <Icon size={19} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <p className="font-medium">{user.name}</p>
          <p className="mt-1 mb-4 text-xs text-muted-foreground">
            {roleLabels[user.role]}
          </p>
          <Logout />
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <span className="mobile-mark">
              <ChefHat size={22} />
            </span>
            <p className="text-sm">
              {roleLabels[user.role]}
              <span className="hidden text-muted-foreground sm:inline">
                {" "}
                / {user.name}
              </span>
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {dateLabel(workDate())} · МСК
          </span>
        </header>
        <main>{children}</main>
        {user.role !== "cook" && (
          <div className="mobile-logout">
            <Logout />
          </div>
        )}
      </div>
      <nav
        className={`bottom-nav ${keys.length > 3 ? "compact-nav" : ""}`}
        aria-label="Мобильная навигация"
      >
        {keys.map((k) => {
          const { href, label, Icon } = items[k];
          return (
            <Link
              key={k}
              href={href}
              aria-current={
                active === k || (k === "stats" && active === "activity")
                  ? "page"
                  : undefined
              }
            >
              <Icon size={20} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
