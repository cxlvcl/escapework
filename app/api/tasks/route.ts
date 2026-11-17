import { z } from "zod";
import { apiError, apiSuccess, checkOrigin, requireUser } from "@/lib/auth";
import { forward } from "@/lib/forward";
const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    stationId: z.uuid(),
    title: z.string().trim().min(1).max(300),
    taskType: z.enum(["main", "individual"]),
  }),
  z.object({
    action: z.literal("rename"),
    id: z.uuid(),
    title: z.string().trim().min(1).max(300),
  }),
  z.object({ action: z.literal("delete"), id: z.uuid() }),
  z.object({
    action: z.literal("move"),
    id: z.uuid(),
    direction: z.enum(["up", "down"]),
  }),
]);
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await requireUser("manage");
    const input = inputSchema.parse(await request.json());
    return apiSuccess(await forward(request, "task", input));
  } catch (e) {
    return apiError(e);
  }
}
