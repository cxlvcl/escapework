import { apiError, apiSuccess, checkOrigin, destroySession } from "@/lib/auth";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await destroySession();
    return apiSuccess();
  } catch (e) {
    return apiError(e);
  }
}
