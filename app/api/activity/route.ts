import { apiError, apiSuccess, requireUser } from "@/lib/auth";
import { activityView } from "@/lib/data";
export async function GET() {
  try {
    await requireUser("activity");
    return apiSuccess(await activityView());
  } catch (e) {
    return apiError(e);
  }
}
