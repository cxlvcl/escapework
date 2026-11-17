import type { AnchorHTMLAttributes } from "react";
export class Redirect extends Error {
  constructor(public href: string) {
    super("Redirect");
  }
}
export function redirect(href: string): never {
  throw new Redirect(href);
}
export function notFound(): never {
  throw new Error("Страница не найдена.");
}
export function navigate(href: string, replace = false) {
  if (!href.startsWith("/") || href.startsWith("//")) return;
  if (replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  window.dispatchEvent(new Event("escape:navigate"));
}
const router = {
  push: (href: string) => navigate(href),
  replace: (href: string) => navigate(href, true),
  refresh: () => window.dispatchEvent(new Event("escape:refresh")),
};
export function useRouter() {
  return router;
}
export default function Link({
  href = "/",
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          !props.target &&
          href.startsWith("/") &&
          !href.startsWith("//")
        ) {
          event.preventDefault();
          navigate(href);
        }
      }}
    />
  );
}
