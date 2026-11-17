"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { dateLabel, dateOffset } from "@/lib/domain";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function PhotoArchivePicker({
  today,
  oldestDate,
  selectedDate,
}: {
  today: string;
  oldestDate: string;
  selectedDate: string;
}) {
  const latestDate = dateOffset(today, -1);
  const archived = selectedDate !== today;
  const highlighted = archived ? selectedDate : latestDate;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(highlighted.slice(0, 7));
  const selectedButton = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const first = `${month}-01`;
  const weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const nextMonth = dateOffset(`${month}-28`, 4).slice(0, 7);
  const last = dateOffset(`${nextMonth}-01`, -1);
  const cellCount = Math.ceil((weekday + Number(last.slice(-2))) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) =>
    dateOffset(first, index - weekday),
  );
  const monthLabel = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${first}T12:00:00Z`));
  return (
    <div className="mb-6 flex flex-wrap gap-3">
      <Button asChild variant={archived ? "outline" : "default"}>
        <Link href="/photos" aria-current={!archived ? "page" : undefined}>
          Сегодня
        </Link>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (value) setMonth(highlighted.slice(0, 7));
          setOpen(value);
        }}
      >
        <DialogTrigger asChild>
          <Button variant={archived ? "default" : "outline"}>
            <CalendarDays size={18} />
            Архив фотографий
          </Button>
        </DialogTrigger>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            selectedButton.current?.focus();
          }}
        >
          <DialogTitle>Архив фотографий</DialogTitle>
          <DialogDescription>
            Выберите дату за последние 32 завершённых рабочих дня: с{" "}
            {dateLabel(oldestDate)} по {dateLabel(latestDate)}.
          </DialogDescription>
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              className="size-11 min-h-11 px-0"
              aria-label="Предыдущий месяц"
              disabled={month <= oldestDate.slice(0, 7)}
              onClick={() => setMonth(dateOffset(first, -1).slice(0, 7))}
            >
              <ChevronLeft size={20} />
            </Button>
            <p className="text-sm font-medium capitalize" aria-live="polite">
              {monthLabel}
            </p>
            <Button
              variant="ghost"
              className="size-11 min-h-11 px-0"
              aria-label="Следующий месяц"
              disabled={month >= latestDate.slice(0, 7)}
              onClick={() => setMonth(nextMonth)}
            >
              <ChevronRight size={20} />
            </Button>
          </div>
          <table
            className="w-full table-fixed text-center text-sm"
            aria-label="Выбор даты фотографий"
          >
            <thead>
              <tr>
                {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
                  <th
                    key={day}
                    scope="col"
                    className="h-9 font-normal text-muted-foreground"
                  >
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: cellCount / 7 }, (_, week) => (
                <tr key={week}>
                  {cells.slice(week * 7, week * 7 + 7).map((day) => {
                    const inMonth = day.slice(0, 7) === month;
                    const disabled =
                      !inMonth || day < oldestDate || day > latestDate;
                    return (
                      <td key={day} className="p-0.5">
                        <button
                          type="button"
                          disabled={disabled}
                          ref={day === highlighted ? selectedButton : undefined}
                          aria-label={`${dateLabel(day)} ${day.slice(0, 4)}`}
                          aria-pressed={day === highlighted}
                          data-date={day}
                          className={`h-11 w-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-25 ${day === highlighted ? "bg-black text-white" : "hover:bg-neutral-100"} ${!inMonth ? "invisible" : ""}`}
                          onClick={() => {
                            setOpen(false);
                            router.push(`/photos?date=${day}`);
                          }}
                        >
                          {Number(day.slice(-2))}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Рабочий день — с 04:00 до 04:00 МСК следующего дня.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
