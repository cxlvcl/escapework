"use client";
import { Button } from "@/components/ui/button";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="login-page">
      <div className="card max-w-md">
        <h1 className="text-2xl">Не удалось загрузить страницу</h1>
        <p className="my-5 text-sm text-muted-foreground">
          Попробуйте ещё раз. Если ошибка повторяется, обратитесь к су-шефу.
        </p>
        <Button onClick={reset}>Повторить</Button>
      </div>
    </main>
  );
}
