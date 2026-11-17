export async function compressPhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Не удалось обработать фотографию.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.7));
    let blob = await encode("image/webp");
    if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg");
    if (!blob || blob.size > 3 * 1024 * 1024)
      throw new Error("Не удалось сжать фотографию. Выберите другой снимок.");
    return new File(
      [blob],
      blob.type === "image/webp" ? "photo.webp" : "photo.jpg",
      { type: blob.type },
    );
  } finally {
    bitmap.close();
  }
}
