import { Component, Input } from "@angular/core";
@Component({
  selector: "app-icon",
  standalone: true,
  template: `<svg
    [attr.width]="size"
    [attr.height]="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path [attr.d]="paths[name] || paths['file']" />
  </svg>`,
  styles: [
    `
      :host {
        display: inline-flex;
        flex-shrink: 0;
        vertical-align: middle;
      }
    `,
  ],
})
export class IconComponent {
  @Input() name = "file";
  @Input() size = 18;
  paths: Record<string, string> = {
    file: "M8 3H5v18h14V7l-4-4H8M14 3v5h5M8 12h8M8 16h5",
    layers: "m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5",
    user: "M20 21v-2a7 7 0 0 0-14 0v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
    globe:
      "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2c6 6 6 14 0 20-6-6-6-14 0-20",
    sparkles: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
    logout: "M9 3H3v18h6M10 12h11m-4-4 4 4-4 4",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    close: "m6 6 12 12M6 18 18 6",
  };
}
