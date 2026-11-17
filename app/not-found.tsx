import Link from "next/link";
export default function NotFound() {
  return (
    <main className="login-page">
      <div className="card">
        <h1>Страница не найдена</h1>
        <Link className="mt-6 inline-block underline" href="/">
          На главную
        </Link>
      </div>
    </main>
  );
}
