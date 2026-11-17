import "dotenv/config";
import { z } from "zod";
import { hashPassword } from "../lib/password";
import { googleCall } from "../services/google-client";
async function main() {
  const input = z
    .object({
      BOOTSTRAP_SOUS_CHEF_NAME: z.string().trim().min(1),
      BOOTSTRAP_SOUS_CHEF_LOGIN: z.string().trim().min(1),
      BOOTSTRAP_SOUS_CHEF_PASSWORD: z.string().min(8).max(128),
    })
    .parse(process.env);
  const result = await googleCall<{ created: boolean }>("bootstrap", {
    name: input.BOOTSTRAP_SOUS_CHEF_NAME,
    login: input.BOOTSTRAP_SOUS_CHEF_LOGIN,
    passwordHash: await hashPassword(input.BOOTSTRAP_SOUS_CHEF_PASSWORD),
  });
  console.log(
    result.created
      ? "Первый су-шеф создан в Google Sheets."
      : "Су-шеф уже существует. Аккаунт не изменён.",
  );
}
main().catch(() => {
  console.error(
    "Bootstrap не выполнен. Проверьте Google env и BOOTSTRAP_ENABLED в Script Properties.",
  );
  process.exitCode = 1;
});
