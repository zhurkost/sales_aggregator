import {
  HttpClient,
  HttpContext,
  HttpContextToken,
  HttpErrorResponse,
  type HttpInterceptorFn,
} from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { catchError, firstValueFrom, throwError } from "rxjs";

export type * from "./rental-models";

const BASE = "/api/workspace/rental/";

/** Carries the HTTP status so callers can tell a revision conflict from an outage. */
export class RentalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The cabinet a request belongs to, fixed when the request is made. */
export const RENTAL_WORKSPACE = new HttpContextToken<string>(() => "");

/** What the user reads for a failed request: the server's message, or an outage. */
export function rentalError(response: HttpErrorResponse): RentalApiError {
  const body = response.error;
  // A proxy (nginx 502/504) answers with HTML or an empty body, not with JSON.
  if (body === null || typeof body !== "object" || body instanceof Error)
    return new RentalApiError(
      `Сервер временно недоступен (код ${response.status}). Изменения сохранятся при следующей попытке.`,
      response.status,
    );
  const message = (body as { error?: unknown }).error;
  return new RentalApiError(
    typeof message === "string" && message ? message : "Не удалось выполнить запрос.",
    response.status,
  );
}

/** Every rental request carries its cabinet; every failure becomes a {@link RentalApiError}. */
export const rentalInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(BASE)) return next(request);
  return next(
    request.clone({
      setHeaders: {
        "Content-Type": "application/json",
        "X-Autopost-Workspace": request.context.get(RENTAL_WORKSPACE),
      },
    }),
  ).pipe(
    catchError((error: unknown) =>
      throwError(() => (error instanceof HttpErrorResponse ? rentalError(error) : error)),
    ),
  );
};

/** The rental API of the server: a GET without data, a POST with it. */
@Injectable({ providedIn: "root" })
export class RentalApi {
  private readonly http = inject(HttpClient);

  request<T>(workspace: string, path: string, data?: unknown): Promise<T> {
    const context = new HttpContext().set(RENTAL_WORKSPACE, workspace);
    return firstValueFrom(
      data === undefined
        ? this.http.get<T>(BASE + path, { context })
        : this.http.post<T>(BASE + path, data, { context }),
    );
  }
}

/** Address of a stored photo for an image element; the session cookie selects the cabinet. */
export function rentalPhotoUrl(draft: string, photo: string) {
  return `${BASE}drafts/${encodeURIComponent(draft)}/photos/${encodeURIComponent(photo)}`;
}
