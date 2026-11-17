import sharp from "sharp";
import { z } from "zod";
import {
  apiError,
  apiSuccess,
  AppError,
  checkOrigin,
  requireUser,
} from "@/lib/auth";
import { forward } from "@/lib/forward";
import {
  MAX_TASK_PHOTOS,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_REQUEST_BYTES,
} from "@/lib/task-photos";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await requireUser("complete");
    if (Number(request.headers.get("content-length")) > MAX_PHOTO_REQUEST_BYTES)
      throw new AppError("Фотографии слишком большие.", 413);
    const form = await request.formData();
    const data = z
      .object({
        category: z.enum(["station", "refrigerator", "additional"]),
        id: z.uuid(),
      })
      .parse({ category: form.get("category"), id: form.get("id") });
    const multiple = form.getAll("photos[]");
    const legacy = form.getAll("photo");
    if (multiple.length && legacy.length)
      throw new AppError("Передайте один список фотографий.");
    const files = multiple.length ? multiple : legacy;
    if (files.length < 1 || files.length > MAX_TASK_PHOTOS)
      throw new AppError("Прикрепите от 1 до 4 фотографий.");
    const outputs: string[] = [];
    for (const file of files) {
      if (!(file instanceof File) || !file.size)
        throw new AppError(
          "Не удалось загрузить фотографию. Выберите снимок повторно.",
        );
      if (
        !["image/webp", "image/jpeg"].includes(file.type) ||
        file.size > MAX_PHOTO_BYTES
      )
        throw new AppError("Выберите сжатую фотографию WebP или JPEG до 3 МБ.");
      let output: Buffer;
      try {
        const image = sharp(Buffer.from(await file.arrayBuffer()), {
          limitInputPixels: 40_000_000,
        });
        const meta = await image.metadata();
        if (
          !["webp", "jpeg"].includes(meta.format ?? "") ||
          (meta.pages ?? 1) > 1
        )
          throw new Error("Invalid image");
        output = await image
          .rotate()
          .resize({
            width: 1600,
            height: 1600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 70 })
          .toBuffer();
        if (output.length > MAX_PHOTO_BYTES) throw new Error("Photo too large");
      } catch {
        throw new AppError(
          "Не удалось прочитать фотографию. Выберите другой снимок.",
        );
      }
      outputs.push(output.toString("base64"));
    }
    return apiSuccess(
      await forward(request, "complete", {
        ...data,
        mimeType: "image/webp",
        photosBase64: outputs,
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
