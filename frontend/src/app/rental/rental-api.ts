export type * from "./rental-models";

export async function rentalApi<T>(
  workspace: string,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await fetch("/api/workspace/rental/" + path, {
    method: data === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Autopost-Workspace": workspace,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  // A proxy (nginx 502/504) answers with HTML or an empty body, not with JSON.
  const text = await response.text();
  let body: { error?: unknown } | null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `Сервер временно недоступен (код ${response.status}). Изменения сохранятся при следующей попытке.`,
    );
  }
  if (!response.ok)
    throw new Error(
      typeof body?.error === "string" && body.error
        ? body.error
        : "Не удалось выполнить запрос.",
    );
  return body as T;
}
