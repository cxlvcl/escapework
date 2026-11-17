export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Загрузка"
      className="mx-auto max-w-4xl space-y-6 p-8"
    >
      <div className="skeleton h-10 w-1/2" />
      <div className="skeleton h-60" />
      <div className="skeleton h-24" />
      <div className="skeleton h-24" />
    </div>
  );
}
