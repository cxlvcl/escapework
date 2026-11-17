"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { post, ErrorMessage, Submit } from "./controls";
type TaskType = { id: string; title: string; is_active: boolean };
export function AdditionalTypes({ types }: { types: TaskType[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<TaskType>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function show(type?: TaskType) {
    setEdit(type);
    setError("");
    setOpen(true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await post("/api/additional-types", {
        id: edit?.id,
        title: form.get("title"),
        isActive: form.get("isActive") === "on",
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
    <section className="section">
      <div className="section-heading">
        <h2>Типы задач</h2>
        <Button onClick={() => show()}>
          <Plus size={18} />
          Добавить тип
        </Button>
      </div>
      <div className="space-y-3">
        {types.map((type) => (
          <div
            key={type.id}
            className="card flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <h3 className="break-words text-base">{type.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {type.is_active
                  ? "Доступен для назначения"
                  : "Скрыт из назначения"}
              </p>
            </div>
            <Button
              variant="outline"
              aria-label={`Изменить тип: ${type.title}`}
              onClick={() => show(type)}
            >
              <Pencil size={17} />
            </Button>
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>
            {edit ? "Изменить тип задачи" : "Новый тип задачи"}
          </DialogTitle>
          <DialogDescription>
            Изменения применяются к новым назначениям. Уже назначенные задачи
            сохранят своё название.
          </DialogDescription>
          <form onSubmit={submit} className="space-y-5">
            <label className="field">
              Название
              <input
                name="title"
                required
                maxLength={300}
                defaultValue={edit?.title}
              />
            </label>
            <label className="flex min-h-12 items-center gap-3">
              <input
                type="checkbox"
                name="isActive"
                className="size-5 accent-black"
                defaultChecked={edit?.is_active ?? true}
              />
              Доступен для назначения
            </label>
            <ErrorMessage message={error} />
            <Submit busy={busy}>Сохранить</Submit>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
