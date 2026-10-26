import type { Listing } from "./listing.ts";
import type { Job } from "./platforms.ts";
export type Photo = { id: string; name: string; type: string; dataUrl: string };
export type Profile = { id: string; login: string; name: string };
export type AdRecord = {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  text: string;
  listing: Listing;
  photos: Photo[];
  selected: string[];
  prepared: boolean;
  categoryConfirmed: boolean;
  categoryOverrides?: import('./taxonomy.ts').CategoryOverrides;
  archived: boolean;
  jobs: Job[];
  batchId?: string;
  externalId?: string;
  photoRefs?: string[];
  events: { at: string; message: string }[];
};
export type AdSummary = Omit<AdRecord, "photos" | "text"> & {
  photoCount: number;
};
export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      response.status === 413
        ? "Слишком большой файл или набор фото."
        : "Сервис временно недоступен. Попробуйте ещё раз.",
    );
  }
  if (!response.ok)
    throw new Error(
      (result as { error?: string }).error || "Не удалось выполнить действие.",
    );
  return result as T;
}
export function newRecord(listing: Listing, text = ""): AdRecord {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    text,
    listing,
    photos: [],
    selected: [],
    prepared: false,
    categoryConfirmed: false,
    archived: false,
    jobs: [],
    events: [],
  };
}
export function extension(
  type: string,
  payload?: unknown,
  timeout = 12000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const listener = (e: MessageEvent) => {
      if (
        e.source !== window ||
        e.origin !== location.origin ||
        e.data?.source !== "autopost-extension" ||
        e.data.requestId !== requestId ||
        e.data.type !== "RESPONSE"
      )
        return;
      clearTimeout(timer);
      window.removeEventListener("message", listener);
      const r = e.data.payload || {};
      if (e.data.error || r.error)
        reject(new Error(String(e.data.error || r.error)));
      else resolve(r);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", listener);
      reject(
        new Error(
          "Расширение не ответило. Установите версию 0.4.0 и обновите страницу.",
        ),
      );
    }, timeout);
    window.addEventListener("message", listener);
    window.postMessage(
      { source: "autopost-app", type, requestId, payload },
      location.origin,
    );
  });
}
export function download(
  name: string,
  content: BlobPart,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function optimizePhoto(file: File): Promise<Photo> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Фото: JPG, PNG или WebP, до 20 МБ.");
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / image.width, 1600 / image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  let quality = 0.8;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > 300000 && quality > 0.3) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrl.length > 350000)
    throw new Error("Уменьшите разрешение фотографии.");
  return {
    id: crypto.randomUUID(),
    name: (file.name || "photo.png").replace(/\.[^.]+$/, ".jpg"),
    type: "image/jpeg",
    dataUrl,
  };
}
