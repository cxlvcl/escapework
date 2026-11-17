import Image from "next/image";
import { existsSync } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { LoginForm } from "@/components/controls";
export const dynamic = "force-dynamic";
export default async function Login() {
  if (await currentUser()) redirect("/");
  const logo = existsSync(
    path.join(process.cwd(), "public/images/escape-restaurant-logo.png"),
  );
  return (
    <main className="login-page">
      <div className="login-wrap">
        <div className="logo-space">
          {logo && (
            <Image
              src="/images/escape-restaurant-logo.png"
              alt="ESCAPE RESTAURANT"
              width={686}
              height={698}
              priority
              unoptimized
            />
          )}
        </div>
        <h1>Вход</h1>
        <LoginForm />
      </div>
    </main>
  );
}
