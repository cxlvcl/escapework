import { currentUser } from "./auth";
import { redirect } from "./navigation";
import { LoginForm } from "../../components/controls";
export default async function Login() {
  if (await currentUser()) redirect("/");
  return (
    <main className="login-page">
      <div className="login-wrap">
        <div className="logo-space">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/escape-restaurant-logo.png"
            alt="ESCAPE RESTAURANT"
            width={686}
            height={698}
          />
        </div>
        <h1>Вход</h1>
        <LoginForm />
      </div>
    </main>
  );
}
