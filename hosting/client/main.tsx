import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../../app/page";
import Stations from "../../app/stations/page";
import Station from "../../app/stations/[id]/page";
import Additional from "../../app/additional/page";
import Statistics from "../../app/statistics/page";
import Activity from "../../app/activity/page";
import Users from "../../app/users/page";
import Profile from "../../app/profile/page";
import { CompletedView } from "../../components/completed-view";
import Login from "./login";
import { resetReads, read, ReadError } from "./auth";
import { navigate, Redirect } from "./navigation";
async function load() {
  resetReads();
  // Start independent reads together; page functions reuse the same promises.
  const view = (
    {
      "/additional": "additional",
      "/users": "users",
      "/activity": "activity",
    } as Record<string, string>
  )[location.pathname.replace(/\/$/, "")];
  if (view) void read(view).catch(() => {});
  const searchParams = Promise.resolve(
    Object.fromEntries(new URLSearchParams(location.search)),
  );
  switch (location.pathname.replace(/\/$/, "") || "/") {
    case "/":
      return Home({ searchParams });
    case "/login":
      return Login();
    case "/stations":
      return Stations();
    case "/additional":
      return Additional({ searchParams });
    case "/statistics":
      return Statistics({ searchParams });
    case "/activity":
      return Activity();
    case "/users":
      return Users();
    case "/profile":
      return Profile();
    case "/completed":
      return CompletedView({});
    case "/photos":
      return CompletedView({ gallery: true, date: (await searchParams).date });
    default: {
      const match = location.pathname.match(/^\/stations\/([^/]+)\/?$/);
      if (match) return Station({ params: Promise.resolve({ id: match[1] }) });
      throw new Error("Страница не найдена.");
    }
  }
}
function App() {
  const [content, setContent] = useState<ReactNode>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false,
      running = false,
      pending = false,
      revision = 0;
    const refresh = async () => {
      pending = true;
      if (running) return;
      running = true;
      while (pending && !stopped) {
        pending = false;
        const version = revision;
        try {
          const node = await load();
          if (!stopped && version === revision) {
            setContent(node);
            setError("");
          }
        } catch (e) {
          if (!stopped && version === revision) {
            if (e instanceof Redirect) navigate(e.href, true);
            else if (e instanceof ReadError && e.status === 401)
              navigate("/login", true);
            else
              setError(
                e instanceof Error
                  ? e.message
                  : "Не удалось загрузить страницу.",
              );
          }
        }
      }
      running = false;
    };
    const change = () => {
      revision++;
      setContent(null);
      setError("");
      window.scrollTo(0, 0);
      void refresh();
    };
    window.addEventListener("escape:navigate", change);
    window.addEventListener("popstate", change);
    window.addEventListener("escape:refresh", refresh);
    void refresh();
    return () => {
      stopped = true;
      window.removeEventListener("escape:navigate", change);
      window.removeEventListener("popstate", change);
      window.removeEventListener("escape:refresh", refresh);
    };
  }, []);
  return (
    <>
      {error && (
        <div role="alert" className="card m-5">
          {error}
          <button
            className="ml-4 underline"
            onClick={() => window.dispatchEvent(new Event("escape:refresh"))}
          >
            Повторить
          </button>
        </div>
      )}
      {content ||
        (!error && (
          <p role="status" className="p-8">
            Загрузка…
          </p>
        ))}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
