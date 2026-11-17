export const MAX_TASK_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const MAX_PHOTO_REQUEST_BYTES = 13 * 1024 * 1024;

// Legacy rows store one private file reference; multiple references use a JSON list.
export function photoPaths(value?: string | null): string[] {
  if (!value) return [];
  if (!value.startsWith("[")) return [value];
  const paths: unknown = JSON.parse(value);
  if (
    !Array.isArray(paths) ||
    paths.length < 1 ||
    paths.length > MAX_TASK_PHOTOS ||
    paths.some((path) => typeof path !== "string" || !path)
  )
    throw new Error("Invalid stored photo references");
  return paths;
}

export function encodePhotoPaths(paths: string[]): string {
  if (paths.length < 1 || paths.length > MAX_TASK_PHOTOS)
    throw new Error("Invalid photo count");
  return paths.length === 1 ? paths[0] : JSON.stringify(paths);
}
