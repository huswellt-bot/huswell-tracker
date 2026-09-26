export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "huswell-theme";

export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var theme = window.localStorage.getItem("${THEME_STORAGE_KEY}");
    var root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme === "dark" ? "dark" : "light";
  } catch (_error) {
    document.documentElement.style.colorScheme = "light";
  }
})();
`;
