import { z } from "zod";
import { apiError, requireUser, sessionToken } from "@/lib/auth";
import { googleCall } from "@/services/google-client";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ category: string; id: string }> },
) {
  try {
    await requireUser();
    const input = z
      .object({
        category: z.enum(["station", "refrigerator", "additional"]),
        id: z.uuid(),
      })
      .parse(await params);
    const photo = await googleCall<{ base64: string; mimeType: string }>(
      "getPhoto",
      {
        ...input,
        index: z.coerce
          .number()
          .int()
          .min(0)
          .max(3)
          .parse(new URL(request.url).searchParams.get("index") ?? 0),
      },
      await sessionToken(),
    );
    return new Response(Buffer.from(photo.base64, "base64"), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
