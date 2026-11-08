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

/** Download in the user's browser; servers that prohibit cross-origin access need a local file. */
export async function importRentalPhotoLinks(current: Photo[], links: string[]): Promise<Photo[]> {
  if (current.length + links.length > 12)
    throw new Error("Можно передать до 12 фотографий за один запуск.");
  const added: Photo[] = [];
  for (const link of links) {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Для фотографий нужны прямые ссылки HTTPS.");
    try {
      const response = await fetch(url, {credentials:"omit", referrerPolicy:"no-referrer", signal:AbortSignal.timeout(15000)});
      const mime = (response.headers.get("content-type") || "").split(";")[0];
      if (!response.ok || !["image/jpeg", "image/png", "image/webp"].includes(mime) || !response.body)
        throw new Error("Не удалось получить изображение.");
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      try {
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 20 * 1024 * 1024) throw new Error("Фото превышает 20 МБ.");
          chunks.push(new Uint8Array(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      const file = new File(chunks, url.pathname.split("/").pop() || "photo", {type:mime});
      added.push({...await optimizePhoto(file), sourceUrl:link});
    } catch {
      throw new Error("Не удалось загрузить фото по ссылке. Скачайте его и добавьте через «＋ Фото»; затем удалите эту ссылку из карточки.");
    }
  }
  return [...current, ...added];
}
