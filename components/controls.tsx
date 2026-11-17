"use client";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogClose,
} from "./ui/dialog";
export { post } from "@/services/api";
import { post } from "@/services/api";
import { dateOffset, workDate, workDayStart } from "@/lib/domain";
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p
      role="alert"
      className="my-3 rounded-xl border border-neutral-300 bg-neutral-50 p-3 text-sm"
    >
      {message}
    </p>
  ) : null;
}
export function Submit({
  busy,
  children,
}: {
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button type="submit" disabled={busy} className="w-full">
      {busy && <Loader2 size={18} className="animate-spin" />}
      {children}
    </Button>
  );
}
export function AutoRefresh() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible")
        startTransition(() => router.refresh());
    };
    const timer = setInterval(refresh, 15000);
    let dayTimer: ReturnType<typeof setTimeout>;
    const scheduleDayRefresh = () => {
      const nextDay = workDayStart(dateOffset(workDate(), 1));
      dayTimer = setTimeout(
        () => {
          refresh();
          scheduleDayRefresh();
        },
        Math.max(1, nextDay.getTime() - Date.now()),
      );
    };
    scheduleDayRefresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      clearTimeout(dayTimer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
export function Logout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await post("/api/logout", {});
            router.replace("/login");
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <LogOut size={18} />
        Выйти
      </Button>
      <ErrorMessage message={error} />
    </>
  );
}
export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await post("/api/login", Object.fromEntries(form));
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="field">
        Логин
        <input name="login" autoComplete="username" required maxLength={80} />
      </label>
      <label className="field">
        Пароль
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      <ErrorMessage message={error} />
      <Submit busy={busy}>
        Войти
        <ArrowRight size={18} />
      </Submit>
    </form>
  );
}
export function ShiftControl({
  stations,
  active,
  total = 0,
  completed = 0,
}: {
  stations: { id: string; name: string }[];
  active: boolean;
  total?: number;
  completed?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await post(
        "/api/shift",
        active
          ? { action: "close" }
          : { action: "open", stationId: form.get("stationId") },
      );
      setOpen(false);
      router.replace(active ? "/?closed=1" : "/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant={active ? "outline" : "default"}
            className={active ? "" : "w-full"}
          >
            {active ? "Закрыть смену" : "Открыть смену"}
            {!active && <ArrowRight size={18} />}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>
            {active ? "Закрыть смену?" : "Выберите станцию"}
          </DialogTitle>
          <DialogDescription>
            {active
              ? "Невыполненные задачи не будут перенесены на следующую смену."
              : "Станция выбирается на текущую смену."}
          </DialogDescription>
          <form onSubmit={submit} className="space-y-5">
            {active ? (
              <div className="rounded-2xl bg-neutral-50 p-4">
                <p>
                  Выполнено {completed} / {total}
                </p>
                <p className="mt-2 text-muted-foreground">
                  Не выполнено {total - completed}
                </p>
              </div>
            ) : (
              <label className="field">
                Станция
                <select name="stationId" required defaultValue="">
                  <option value="" disabled>
                    Выберите станцию
                  </option>
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ErrorMessage message={error} />
            <Submit busy={busy}>
              {active ? "Закрыть смену" : "Открыть смену"}
            </Submit>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={busy}
              >
                Отмена
              </Button>
            </DialogClose>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
