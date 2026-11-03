// happy-dom has no layout engine: getClientRects() always returns one rect.
// Browsers return none for detached elements and inside display:none or [hidden],
// which is what the extension's visibility check relies on.
module.exports = function layout(window) {
  window.Element.prototype.getClientRects = function () {
    if (!this.isConnected) return [];
    for (let e = this; e; e = e.parentElement)
      if (e.hasAttribute("hidden") || window.getComputedStyle(e).display === "none")
        return [];
    return [this.getBoundingClientRect()];
  };
  return window;
};
