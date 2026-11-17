import { apiError, apiSuccess, requireUser } from "@/lib/auth";
import { photosView } from "@/lib/data";
export async function GET(request: Request) {
  try {
    await requireUser("monitor");
    return apiSuccess(
      await photosView(
        new URL(request.url).searchParams.get("date") ?? undefined,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
