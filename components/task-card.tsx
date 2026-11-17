"use client";
/* eslint-disable @next/next/no-img-element -- Private authenticated images and local blob previews must bypass the public image optimizer. */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  X,
} from "lucide-react";
import type { Task } from "@/lib/data";
import { timeLabel } from "@/lib/domain";
import { compressPhoto } from "@/lib/compress";
import { MAX_TASK_PHOTOS } from "@/lib/task-photos";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { ErrorMessage, post } from "./controls";
type SelectedPhoto = { file: File; preview: string };
export function TaskCard({
  task,
  canComplete = false,
  gallery = false,
}: {
  task: Task;
  canComplete?: boolean;
  gallery?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedPhoto[]>([]);
  const selectedRef = useRef<SelectedPhoto[]>([]);
  const busyRef = useRef(false);
  const [activePhoto, setActivePhoto] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const selection = useRef(0);
  const done = !!task.completedAt;
  const photo = task.photoId
    ? `/api/photos/${task.category}/${task.photoId}`
    : null;
  const photos = photo
    ? Array.from(
        {
          length: Math.min(MAX_TASK_PHOTOS, Math.max(1, task.photoCount ?? 1)),
        },
        (_, index) => (index ? `${photo}?index=${index}` : photo),
      )
    : [];
  useEffect(
    () => () => {
      selection.current++;
      selectedRef.current.forEach(({ preview }) =>
        URL.revokeObjectURL(preview),
      );
    },
    [],
  );
  function updateSelected(next: SelectedPhoto[]) {
    selectedRef.current = next;
    setSelected(next);
  }
  function clearSelected() {
    selectedRef.current.forEach(({ preview }) => URL.revokeObjectURL(preview));
    updateSelected([]);
  }
  function removePhoto(index: number) {
    if (busyRef.current) return;
    URL.revokeObjectURL(selectedRef.current[index].preview);
    updateSelected(selectedRef.current.filter((_, i) => i !== index));
    setError("");
  }
  async function choose(files: File[]) {
    if (!files.length || busyRef.current) return;
    if (selectedRef.current.length + files.length > MAX_TASK_PHOTOS) {
      setError(
        "Можно прикрепить максимум 4 фотографии. Удалите лишние или выберите меньше снимков.",
      );
      return;
    }
    const version = ++selection.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const added: SelectedPhoto[] = [];
    try {
      for (const file of files) {
        const compressed = await compressPhoto(file);
        added.push({
          file: compressed,
          preview: URL.createObjectURL(compressed),
        });
      }
      if (version === selection.current)
        updateSelected([...selectedRef.current, ...added]);
      else added.forEach(({ preview }) => URL.revokeObjectURL(preview));
    } catch {
      added.forEach(({ preview }) => URL.revokeObjectURL(preview));
      if (version === selection.current)
        setError("Не удалось обработать фото. Выберите JPEG, PNG или WebP.");
    } finally {
      if (version === selection.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  const full = selected.length >= MAX_TASK_PHOTOS;
  const pickerDisabled = busy || full;
  async function complete() {
    if (busyRef.current || !selectedRef.current.length) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const data = new FormData();
    data.set("category", task.category);
    data.set("id", task.id);
    selectedRef.current.forEach(({ file }) => data.append("photos[]", file));
    try {
      await post("/api/complete", data);
      setOpen(false);
      clearSelected();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      router.refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className={`task-card ${done ? "task-done" : ""}`}
        onClick={() => {
          setError("");
          setActivePhoto(0);
          setOpen(true);
        }}
      >
        <span className={`task-icon ${done ? "done" : ""}`}>
          {done ? <Check size={18} /> : <Camera size={18} />}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block font-medium leading-snug">{task.title}</span>
          <span className="mt-2 block text-xs text-muted-foreground">
            {done
              ? `Выполнено · ${timeLabel(task.completedAt!)}${photos.length > 1 ? ` · Фото: ${photos.length}` : ""}`
              : "Не выполнено · Фото обязательно"}
          </span>
          {task.assignees && (
            <span className="mt-2 block text-xs text-muted-foreground">
              {task.assignees.join(", ")}
            </span>
          )}
        </span>
        <ChevronRight size={17} className="shrink-0 text-muted-foreground" />
      </button>
      {gallery && photos.length > 0 && (
        <div className={photos.length > 1 ? "grid grid-cols-2 gap-2" : ""}>
          {photos.map((src, index) => (
            <a
              key={src}
              href={src}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-2xl"
            >
              <img
                src={src}
                alt={`${task.title} — фото ${index + 1}`}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
            </a>
          ))}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle>{task.title}</DialogTitle>
          <DialogDescription>
            {done
              ? `Выполнено · ${timeLabel(task.completedAt!)}`
              : "Добавьте от 1 до 4 фотографий для завершения задачи."}
          </DialogDescription>
          {done && photos.length ? (
            <div className="space-y-3">
              <img
                src={photos[activePhoto] ?? photos[0]}
                alt={`Фото ${activePhoto + 1}: ${task.title}`}
                className="max-h-[55dvh] w-full rounded-2xl object-contain"
              />
              {photos.length > 1 && (
                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="outline"
                    className="size-12 px-0"
                    aria-label="Предыдущее фото"
                    disabled={activePhoto === 0}
                    onClick={() => setActivePhoto((i) => i - 1)}
                  >
                    <ChevronLeft size={20} />
                  </Button>
                  <p
                    className="text-sm text-muted-foreground"
                    aria-live="polite"
                  >
                    Фото {activePhoto + 1} из {photos.length}
                  </p>
                  <Button
                    variant="outline"
                    className="size-12 px-0"
                    aria-label="Следующее фото"
                    disabled={activePhoto >= photos.length - 1}
                    onClick={() => setActivePhoto((i) => i + 1)}
                  >
                    <ChevronRight size={20} />
                  </Button>
                </div>
              )}
            </div>
          ) : canComplete ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Фотографии: {selected.length} из {MAX_TASK_PHOTOS}
              </p>
              {selected.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {selected.map(({ preview }, index) => (
                    <div
                      key={preview}
                      className="relative overflow-hidden rounded-2xl border border-border"
                    >
                      <img
                        src={preview}
                        alt={`Предпросмотр фотографии ${index + 1}`}
                        className="aspect-square w-full object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Удалить фото ${index + 1}`}
                        disabled={busy}
                        onClick={() => removePhoto(index)}
                        className="absolute right-1 top-1 flex size-11 items-center justify-center rounded-full bg-white/95 shadow-sm disabled:opacity-50"
                      >
                        <X size={19} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label
                  className={`photo-picker ${pickerDisabled ? "pointer-events-none opacity-50" : ""}`}
                >
                  <Camera size={22} />
                  Сделать фото
                  <input
                    disabled={pickerDisabled}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      void choose(Array.from(e.target.files ?? []));
                      e.target.value = "";
                    }}
                  />
                </label>
                <label
                  className={`photo-picker ${pickerDisabled ? "pointer-events-none opacity-50" : ""}`}
                >
                  <ImagePlus size={22} />
                  Выбрать фото
                  <input
                    disabled={pickerDisabled}
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      void choose(Array.from(e.target.files ?? []));
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <Button
                className="w-full"
                disabled={!selected.length || busy}
                onClick={complete}
              >
                {busy && <Loader2 size={18} className="animate-spin" />}
                Подтвердить выполнение
              </Button>
            </div>
          ) : (
            <p className="empty">Не выполнено</p>
          )}
          <ErrorMessage message={error} />
        </DialogContent>
      </Dialog>
    </>
  );
}
