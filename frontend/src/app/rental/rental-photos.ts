import { optimizePhoto, type Photo } from "../../../../lib/workspace";

export async function addRentalPhotos(
  current: Photo[],
  files: File[],
): Promise<Photo[]> {
  if (current.length + files.length > 12)
    throw new Error("Можно передать до 12 фотографий за один запуск.");
  const added = [];
  for (const file of files) added.push(await optimizePhoto(file));
  return [...current, ...added];
}
