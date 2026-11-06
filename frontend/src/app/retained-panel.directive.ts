import { Directive, EmbeddedViewRef, Input, OnDestroy, TemplateRef, ViewContainerRef } from "@angular/core";

/** Keep visited forms in memory without leaving their controls or IDs in the document. */
@Directive({ selector: "[retainedPanel]", standalone: true })
export class RetainedPanelDirective implements OnDestroy {
  private view?: EmbeddedViewRef<unknown>;
  constructor(private template: TemplateRef<unknown>, private container: ViewContainerRef) {}
  @Input() set retainedPanel(active: boolean) {
    if (!active) {
      if (this.container.length) this.container.detach();
    } else if (!this.view) {
      this.view = this.container.createEmbeddedView(this.template);
    } else if (!this.container.length) {
      this.container.insert(this.view);
    }
  }
  ngOnDestroy() { if (this.view && !this.view.destroyed) this.view.destroy(); }
}
