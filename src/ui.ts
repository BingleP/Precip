export function addLog(message: string, eventLogEl?: HTMLElement | null): void {
  const container = eventLogEl || document.querySelector("#event-log");
  if (!container) return;
  const item = document.createElement("li");
  const text = document.createElement("span");
  const timestamp = document.createElement("time");
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  text.textContent = message;
  timestamp.textContent = time;
  item.append(text, timestamp);
  container.prepend(item);

  while (container.children.length > 7) {
    container.lastElementChild?.remove();
  }
}

export function showToast(
  message: string,
  type = "info",
  duration = 3000,
): void {
  const container = document.querySelector("#toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("visible")));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function escapeHTML(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function normalizeSearchText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^\w\s,]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function formatLocationLabel(location: { name?: string; admin?: string; country?: string }): string {
  return [location.name, location.admin, location.country].filter(Boolean).join(", ");
}

export function spinner(): string {
  return `<span class="spinner"></span>`;
}

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

export function selectTab(tabId: string): void {
  document.querySelectorAll(".tab-button").forEach((btn) => {
    const isActive = (btn as HTMLElement).dataset.tab === tabId;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  // Keep the dropdown's toggle label in sync with the selected section.
  const menuLabel = document.querySelector("#tab-menu-label");
  if (menuLabel) {
    menuLabel.textContent = tabId.charAt(0).toUpperCase() + tabId.slice(1);
  }
  document.querySelector("#tab-menu-list")?.classList.remove("open");
  document.querySelector("#tab-menu-toggle")?.setAttribute("aria-expanded", "false");

  document.querySelectorAll(".data-section").forEach((section) => {
    section.classList.toggle("active", (section as HTMLElement).dataset.section === tabId);
  });
  const panel = document.querySelector("#data-panel");
  if (panel) {
    panel.classList.remove("collapsed");
    document.querySelector(".app-shell")?.classList.add("panel-expanded");
  }
}

export function togglePanel(): void {
  const panel = document.querySelector("#data-panel");
  if (!panel) return;
  const wasCollapsed = panel.classList.toggle("collapsed");
  document.querySelector(".app-shell")?.classList.toggle("panel-expanded", !wasCollapsed);
}

export function prepareCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(260, Math.round(rect.height));

  // Full devicePixelRatio on a 3x phone means a multi-megapixel canvas that is
  // redrawn on every pan frame. Cap the backing store so redraw cost stays
  // predictable without a visible quality loss for a map.
  const rawRatio = window.devicePixelRatio || 1;
  const MAX_BACKING_PIXELS = 3_000_000;
  const budgetRatio = Math.sqrt(MAX_BACKING_PIXELS / Math.max(1, width * height));
  const pixelRatio = Math.max(1, Math.min(rawRatio, 2, budgetRatio));

  const scaledWidth = Math.round(width * pixelRatio);
  const scaledHeight = Math.round(height * pixelRatio);

  if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { width, height };
}
