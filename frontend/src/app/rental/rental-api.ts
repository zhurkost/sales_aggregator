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
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Не удалось выполнить запрос.");
  return body as T;
}
