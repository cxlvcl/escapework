"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import type { Task } from "@/lib/data";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "./ui/dialog";
import { post, ErrorMessage, Submit } from "./controls";
import type { UserRole } from "@/lib/domain";
export function TaskManagement({
  stationId,
  tasks,
  refrigeratorId,
  refrigeratorNumber,
}: {
  stationId: string;
  tasks: Task[];
  refrigeratorId?: string;
  refrigeratorNumber?: number;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<Task | undefined>();
  const [open, setOpen] = useState(false);
  const [remove, setRemove] = useState<Task | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function mutate(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await post("/api/tasks", refrigeratorId ? { ...body, category: "refrigerator", refrigeratorId } : body);
      setOpen(false);
      setRemove(undefined);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    mutate(
      edit
        ? { action: "rename", id: edit.id, title: form.get("title") }
        : {
            action: "create",
            stationId,
            title: form.get("title"),
            taskType: form.get("taskType"),
          },
    );
  }
  return (
    <section className="section">
      <div className="section-heading">
        <h2>{refrigeratorId ? `Задания холодильника №${refrigeratorNumber}` : "Управление задачами"}</h2>
        <Button
          onClick={() => {
            setEdit(undefined);
            setError("");
            setOpen(true);
          }}
        >
          <Plus size={18} />
          Добавить
        </Button>
      </div>
      <div className="card divide-y divide-border">
        {tasks.map((task, i) => (
          <div key={task.id} className="flex flex-wrap items-center gap-2 py-3">
            <p className="min-w-0 flex-1 text-sm">{task.title}</p>
            <div className="flex">
              <Button
                variant="ghost"
                className="px-3"
                disabled={busy || i === 0}
                aria-label={`Поднять: ${task.title}`}
                onClick={() =>
                  mutate({ action: "move", id: task.id, direction: "up" })
                }
              >
                <ArrowUp size={17} />
              </Button>
              <Button
                variant="ghost"
                className="px-3"
                disabled={busy || i === tasks.length - 1}
                aria-label={`Опустить: ${task.title}`}
                onClick={() =>
                  mutate({ action: "move", id: task.id, direction: "down" })
                }
              >
                <ArrowDown size={17} />
              </Button>
              <Button
                variant="ghost"
                className="px-3"
                disabled={busy}
                aria-label={`Изменить: ${task.title}`}
                onClick={() => {
                  setEdit(task);
                  setError("");
                  setOpen(true);
                }}
              >
                <Pencil size={17} />
              </Button>
              <Button
                variant="ghost"
                className="px-3"
                disabled={busy}
                aria-label={`Удалить: ${task.title}`}
                onClick={() => {
                  setError("");
                  setRemove(task);
                }}
              >
                <Trash2 size={17} />
              </Button>
            </div>
          </div>
        ))}
        {!tasks.length && <p className="empty">Задач пока нет.</p>}
      </div>
      {!open && !remove && <ErrorMessage message={error} />}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>
            {edit ? "Изменить задачу" : "Добавить задачу"}
          </DialogTitle>
          <DialogDescription>
            {refrigeratorId ? "Задача появится в чек-листе этого холодильника." : "Задача появится в общем чек-листе станции."}
          </DialogDescription>
          <form className="space-y-5" onSubmit={submit}>
            <label className="field">
              Название
              <input
                name="title"
                required
                maxLength={300}
                defaultValue={edit?.title}
              />
            </label>
            {!edit && !refrigeratorId && (
              <label className="field">
                Тип задачи
                <select name="taskType">
                  <option value="main">Основная</option>
                  <option value="individual">Индивидуальная</option>
                </select>
              </label>
            )}
            <ErrorMessage message={error} />
            <Submit busy={busy}>Сохранить</Submit>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={(o) => {
          if (!o) setRemove(undefined);
        }}
      >
        <DialogContent>
          <DialogTitle>Удалить задачу?</DialogTitle>
          <DialogDescription>
            {remove?.title} Историческая статистика сохранится.
          </DialogDescription>
          <ErrorMessage message={error} />
          <Button
            disabled={busy}
            className="w-full"
            onClick={() => mutate({ action: "delete", id: remove?.id })}
          >
            Удалить
          </Button>
          <DialogClose asChild>
            <Button variant="ghost" className="mt-2 w-full">
              Отмена
            </Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </section>
  );
}
export function UserEditor({
  user,
  roles,
}: {
  user?: { id: string; name: string; login: string; role: UserRole };
  roles?: { id: UserRole; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await post("/api/users", {
        ...Object.fromEntries(form),
        ...(user ? { id: user.id } : {}),
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={user ? "outline" : "default"}>
          {user ? <Pencil size={17} /> : <Plus size={18} />}{" "}
          {user ? "Изменить" : "Создать аккаунт"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>
          {user ? "Редактировать аккаунт" : "Новый аккаунт"}
        </DialogTitle>
        <DialogDescription>
          Вход в приложение по логину и паролю.
        </DialogDescription>
        <form onSubmit={submit} className="space-y-4">
          <label className="field">
            Имя
            <input
              name="name"
              defaultValue={user?.name}
              required
              maxLength={100}
            />
          </label>
          <label className="field">
            Логин
            <input
              name="login"
              defaultValue={user?.login}
              required
              maxLength={80}
              autoComplete="off"
            />
          </label>
          {
            <label className="field">
              Роль
              <select name="role" required defaultValue={user?.role ?? ""}>
                <option value="" disabled>
                  Выберите роль
                </option>
                {roles?.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
          }
          <label className="field">
            {user ? "Новый пароль (необязательно)" : "Пароль"}
            <input
              name="password"
              type="password"
              required={!user}
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          {user && (
            <p className="text-xs text-muted-foreground">
              Оставьте пароль пустым, чтобы сохранить текущий.
            </p>
          )}
          <ErrorMessage message={error} />
          <Submit busy={busy}>Сохранить</Submit>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function AssignTask({
  types,
  cooks,
}: {
  types: { id: string; title: string }[];
  cooks: { id: string; name: string }[];
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
      await post("/api/additional", {
        typeId: form.get("typeId"),
        userIds: form.getAll("userIds"),
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus size={18} />
          Назначить задачу
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Назначить задачу</DialogTitle>
        <DialogDescription>
          Одна задача для одного или нескольких поваров на сегодня.
        </DialogDescription>
        {!types.length ? (
          <p className="empty">Доступных типов задач пока нет.</p>
        ) : !cooks.length ? (
          <p className="empty">Сначала создайте аккаунт повара.</p>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <label className="field">
              Задача
              <select name="typeId" required>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Повара</legend>
              {cooks.map((c) => (
                <label key={c.id} className="flex min-h-12 items-center gap-3">
                  <input
                    className="size-5 accent-black"
                    type="checkbox"
                    name="userIds"
                    value={c.id}
                  />
                  {c.name}
                </label>
              ))}
            </fieldset>
            <ErrorMessage message={error} />
            <Submit busy={busy}>Назначить</Submit>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DeleteUser({ user }: { user: { id: string; name: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await post("/api/users", { action: "delete", id: user.id });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" aria-label={`Удалить аккаунт: ${user.name}`}>
          <Trash2 size={17} />
          Удалить
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Удалить аккаунт?</DialogTitle>
        <DialogDescription>
          Аккаунт «{user.name}» потеряет доступ к приложению и исчезнет из
          списка пользователей. Выполненные задачи и фотографии сохранятся.
        </DialogDescription>
        <ErrorMessage message={error} />
        <Button className="w-full" disabled={busy} onClick={remove}>
          {busy ? "Удаление…" : "Удалить аккаунт"}
        </Button>
        <DialogClose asChild>
          <Button variant="ghost" className="mt-2 w-full" disabled={busy}>
            Отмена
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
