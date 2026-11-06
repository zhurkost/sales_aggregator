import { Component, OnInit, OnDestroy, ChangeDetectionStrategy } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RetainedPanelDirective } from "./retained-panel.directive";
import { IconComponent } from "./icon.component";
import { RentalEditorComponent } from "./rental/rental-editor.component";
import type { RentalProfile } from "./rental/rental-profile-defaults";
import { EXTENSION_VERSION, extensionVersionOK, type Profile } from "../../../lib/workspace";
import { WorkspaceGateway } from "./workspace.gateway";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [FormsModule, IconComponent, RentalEditorComponent, RetainedPanelDirective],
  templateUrl: "./app.component.html",
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AppComponent implements OnInit, OnDestroy {
  constructor(private workspace: WorkspaceGateway = new WorkspaceGateway()) {}
  readonly deals = [{ id: "rent", label: "Аренда квартир" }, { id: "sale", label: "Продажа квартир" }] as const;
  deal: "rent" | "sale" = "rent";
  tabKey(event: KeyboardEvent, index: number) {
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 :
      ["ArrowLeft", "ArrowRight"].includes(event.key) ? 1 - index : -1;
    if (next < 0) return;
    event.preventDefault();
    this.deal = this.deals[next].id;
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  ready = false;
  unavailable = false;
  profile: Profile | null = null;
  profiles: Profile[] = [];
  settings: RentalProfile = {};
  authMode: "login" | "register" = "login";
  login = "";
  password = "";
  name = "";
  busy = "";
  toast = "";
  ext = false;
  extensionStatus = "Проверяем подключение…";
  showExtension = false;
  readonly version = EXTENSION_VERSION;
  private alive = true;
  private toastTimer?: ReturnType<typeof setTimeout>;

  ngOnInit() {
    void this.session();
    window.addEventListener("message", this.onMessage);
    window.addEventListener("focus", this.onFocus);
  }
  ngOnDestroy() {
    this.alive = false;
    clearTimeout(this.toastTimer);
    window.removeEventListener("message", this.onMessage);
    window.removeEventListener("focus", this.onFocus);
    this.workspace.clearContext();
  }
  notify(message: string) {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ""), 9000);
  }
  async guard(action: () => Promise<unknown>, label: string) {
    if (this.busy) return;
    this.busy = label;
    try { await action(); }
    catch (e) { this.notify(e instanceof Error ? e.message : "Не удалось выполнить действие."); }
    finally { this.busy = ""; }
  }
  async session() {
    try {
      const result = await this.workspace.session();
      if (!this.alive) return;
      this.profiles = result.profiles;
      this.login = result.profiles[0]?.login || "";
      this.authMode = result.profiles.length ? "login" : "register";
      if (result.profile) await this.enter(result.profile);
      else { this.profile = null; this.settings = {}; this.workspace.clearContext(); }
      this.unavailable = false;
    } catch { this.unavailable = true; }
    finally { this.ready = true; }
  }
  async authenticate() {
    await this.guard(async () => {
      const result = await this.workspace.authenticate(this.authMode, {
        login: this.login, password: this.password, name: this.name,
      });
      this.password = "";
      await this.enter(result.profile);
    }, "Входим…");
  }
  private async enter(profile: Profile) {
    const settings = await this.workspace.settings(profile);
    if (!this.alive) return;
    this.settings = settings;
    this.deal = "rent";
    this.profile = profile;
    void this.checkExtension();
  }
  async logout() {
    await this.guard(async () => {
      await this.workspace.logout();
      this.profile = null;
      this.settings = {};
      this.ext = false;
      await this.session();
    }, "Выходим…");
  }
  async checkExtension() {
    try {
      const result = await this.workspace.pingExtension();
      if (!this.alive) return;
      this.ext = extensionVersionOK(result.version);
      this.extensionStatus = this.ext
        ? "Расширение " + result.version + " подключено."
        : "Обновите расширение до " + this.version + ".";
    } catch (e) {
      if (!this.alive) return;
      this.ext = false;
      this.extensionStatus = e instanceof Error ? e.message : "Нет связи с расширением.";
    }
  }
  private onFocus = () => { if (this.profile) void this.checkExtension(); };
  private onMessage = (event: MessageEvent) => {
    if (this.profile && event.source === window && event.origin === location.origin &&
        event.data?.source === "autopost-extension" && event.data.type === "READY")
      void this.checkExtension();
  };
}
