// AG Grid (Community, MIT) set up once: modules and a theme built from ClaimPack's own tokens, light and dark.
import { AllCommunityModule, ModuleRegistry, colorSchemeDarkBlue, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

const base = {
  fontFamily: "Public Sans, system-ui, sans-serif",
  fontSize: 14,
  headerFontWeight: 600,
  borderRadius: 4,
  wrapperBorderRadius: 8,
  rowVerticalPaddingScale: 1.25,
  spacing: 7,
};

export const lightTheme = themeQuartz.withParams({
  ...base,
  backgroundColor: "#ffffff",
  foregroundColor: "#18212f",
  borderColor: "#d9dee5",
  headerBackgroundColor: "#eef1f4",
  headerTextColor: "#48546a",
  rowHoverColor: "#f4f6f8",
  selectedRowBackgroundColor: "rgba(242, 194, 48, 0.18)",
  accentColor: "#1d3b6e",
});

export const darkTheme = themeQuartz.withPart(colorSchemeDarkBlue).withParams({
  ...base,
  backgroundColor: "#161d27",
  foregroundColor: "#e6eaf0",
  borderColor: "#273242",
  headerBackgroundColor: "#1b2430",
  headerTextColor: "#b4bdca",
  rowHoverColor: "#1b2430",
  selectedRowBackgroundColor: "rgba(227, 181, 43, 0.16)",
  accentColor: "#c9d8f5",
});

export function gridTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? darkTheme : lightTheme;
}
