import { CompletedView } from "@/components/completed-view";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  return <CompletedView gallery date={(await searchParams).date} />;
}
