import { pageUser } from "@/lib/auth";
import {
  additionalTasks,
  stationList,
  stationTasks,
  fridgeTasks,
  photosView,
} from "@/lib/data";
import { dateLabel } from "@/lib/domain";
import { Shell } from "./shell";
import { PageHeading } from "./display";
import { TaskCard } from "./task-card";
import { PhotoArchivePicker } from "./photo-archive-picker";
export async function CompletedView({
  gallery = false,
  date,
}: {
  gallery?: boolean;
  date?: string;
}) {
  const user = await pageUser("monitor");
  const photos = gallery ? await photosView(date) : null;
  const stations = photos?.stations ?? (await stationList());
  const archived = photos && photos.date !== photos.today;
  const groups = photos
    ? stations.map((station) => ({
        name: station.name,
        tasks: photos.tasks.filter((t) => t.stationId === station.id),
      }))
    : await Promise.all(
        stations.map(async (station) => ({
          name: station.name,
          tasks: [
            ...(await stationTasks(station.id)),
            ...(await fridgeTasks(station.id)),
          ].filter((t) => t.completedAt),
        })),
      );
  groups.push({
    name: "Дополнительные задачи",
    tasks: photos
      ? photos.tasks.filter((t) => t.category === "additional")
      : (await additionalTasks()).filter((t) => t.completedAt),
  });
  return (
    <Shell user={user} active={gallery ? "photos" : "completed"}>
      <PageHeading
        eyebrow={
          photos
            ? `${archived ? "Архив" : "Сегодня"} · ${dateLabel(photos.date)} ${photos.date.slice(0, 4)}`
            : "Сегодня"
        }
        title={gallery ? "Фотографии" : "Выполненные задачи"}
        description={
          gallery
            ? "Фотографии выполненных задач. Рабочий день — с 04:00 до 04:00 МСК."
            : "Результаты выполнения задач кухни с фото-подтверждением."
        }
      />
      {photos && (
        <PhotoArchivePicker
          today={photos.today}
          oldestDate={photos.oldestDate}
          selectedDate={photos.date}
        />
      )}
      {groups.every((g) => !g.tasks.length) && (
        <p className="empty">
          {gallery
            ? "За этот рабочий день фотографий нет."
            : "Выполненных задач на сегодня пока нет."}
        </p>
      )}
      {groups
        .filter((g) => g.tasks.length)
        .map((g) => (
          <section className="section" key={g.name}>
            <h2 className="mb-4">{g.name}</h2>
            <div className={gallery ? "gallery-grid" : "task-list"}>
              {g.tasks.map((t) => (
                <div key={`${t.category}:${t.photoId ?? t.id}`}>
                  <TaskCard
                    task={{
                      ...t,
                      title: t.refrigeratorNumber
                        ? `№${t.refrigeratorNumber} · ${t.title}`
                        : t.title,
                    }}
                    gallery={gallery}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
    </Shell>
  );
}
