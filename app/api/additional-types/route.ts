import { z } from "zod";
import { apiError, apiSuccess, checkOrigin, requireUser } from "@/lib/auth";
import { forward } from "@/lib/forward";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await requireUser("manage");
    const data = z
      .object({
        id: z.uuid().optional(),
        title: z.string().trim().min(1).max(300),
        isActive: z.boolean(),
      })
      .parse(await request.json());
    return apiSuccess(await forward(request, "additionalType", data));
  } catch (e) {
    return apiError(e);
  }
}
