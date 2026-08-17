const root = document.documentElement;
const langButtons = [...document.querySelectorAll(".lang button")];
const titles = {
  zh: "Symphoneer — 本地优先的 Coding Agent 交付工作台",
  en: "Symphoneer — a local-first coding agent delivery workbench",
};

function setLang(lang) {
  const next = lang === "en" ? "en" : "zh";
  root.dataset.lang = next;
  root.lang = next === "en" ? "en" : "zh-CN";
  document.title = titles[next];
  for (const button of langButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.lang === next));
  }
  localStorage.setItem("symphoneer-lang", next);
}

const saved = localStorage.getItem("symphoneer-lang");
if (saved === "en" || saved === "zh") setLang(saved);

for (const button of langButtons) {
  button.addEventListener("click", () => setLang(button.dataset.lang));
}

for (const button of document.querySelectorAll(".copy")) {
  const original = button.innerHTML;
  button.addEventListener("click", async () => {
    const text = button.getAttribute("data-copy") ?? "";
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = root.dataset.lang === "en" ? "Copied" : "已复制";
      window.setTimeout(() => {
        button.innerHTML = original;
      }, 1600);
    } catch {
      button.textContent = root.dataset.lang === "en" ? "Copy failed" : "复制失败";
      window.setTimeout(() => {
        button.innerHTML = original;
      }, 1600);
    }
  });
}
