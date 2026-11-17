import { z } from "zod";
import { apiError, apiSuccess, checkOrigin, requireUser } from "@/lib/auth";
import { forward } from "@/lib/forward";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await requireUser("shift");
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("open"), stationId: z.uuid() }),
        z.object({ action: z.literal("close") }),
      ])
      .parse(await request.json());
    return apiSuccess(await forward(request, "shift", input));
  } catch (e) {
    return apiError(e);
  }
}
