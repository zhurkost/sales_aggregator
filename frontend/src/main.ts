import { bootstrapApplication } from "@angular/platform-browser";
import {
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from "@angular/core";
import { registerLocaleData } from "@angular/common";
import { provideHttpClient, withFetch, withInterceptors } from "@angular/common/http";
import { provideRouter, withHashLocation } from "@angular/router";
import localeRu from "@angular/common/locales/ru";
import { AppComponent } from "./app/app.component";
import { rentalInterceptor } from "./app/rental/rental-api";
import { routes } from "./app/app.routes";
registerLocaleData(localeRu);
bootstrapApplication(AppComponent, {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection(),
    { provide: LOCALE_ID, useValue: "ru" },
    provideHttpClient(withFetch(), withInterceptors([rentalInterceptor])),
    // #/rental: the server and nginx serve one page, no fallback for other paths.
    provideRouter(routes, withHashLocation()),
  ],
}).catch(console.error);
