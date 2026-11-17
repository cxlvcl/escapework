import { z } from "zod";
import { apiError, apiSuccess, checkOrigin, requireUser } from "@/lib/auth";
import { forward } from "@/lib/forward";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await requireUser("manage");
    const input = z
      .object({ typeId: z.uuid(), userIds: z.array(z.uuid()).min(1).max(200) })
      .parse(await request.json());
    return apiSuccess(await forward(request, "assignAdditional", input));
  } catch (e) {
    return apiError(e);
  }
}
