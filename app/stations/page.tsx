import { pageUser } from "@/lib/auth";
import { stationList, currentStats } from "@/lib/data";
import { Shell } from "@/components/shell";
import { PageHeading, StationGrid } from "@/components/display";
export default async function Stations() {
  const user = await pageUser("monitor");
  const [stations, stats] = await Promise.all([stationList(), currentStats()]);
  return (
    <Shell user={user} active="stations">
      <PageHeading
        eyebrow="Кухня"
        title="Станции"
        description="Общий чек-лист и холодильники каждого цеха."
      />
      <StationGrid stations={stations} stats={stats.stations} />
    </Shell>
  );
}
