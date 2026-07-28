// Shared Tailwind Configuration — سجل الديون
// This file is loaded by all HTML pages for consistent design tokens.
window.sharedTailwindConfig = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "on-tertiary-fixed": "#40000a",
        "background": "#f9f9ff",
        "on-surface": "#141b2b",
        "on-secondary-fixed": "#151c27",
        "surface-container-highest": "#dce2f7",
        "surface-dim": "#d3daef",
        "on-surface-variant": "#3e4941",
        "surface": "#f9f9ff",
        "on-secondary-fixed-variant": "#404754",
        "surface-container-lowest": "#ffffff",
        "on-error-container": "#93000a",
        "primary-fixed-dim": "#7adaa3",
        "tertiary-container": "#b4565a",
        "primary-container": "#1b8354",
        "outline": "#6e7a71",
        "surface-tint": "#006d42",
        "primary": "#006840",
        "tertiary-fixed-dim": "#ffb3b3",
        "on-primary-fixed": "#002111",
        "surface-bright": "#f9f9ff",
        "error-container": "#ffdad6",
        "surface-variant": "#dce2f7",
        "secondary-fixed": "#dce2f3",
        "tertiary": "#953e43",
        "surface-container-high": "#e1e8fd",
        "on-tertiary-fixed-variant": "#7c2b31",
        "surface-container-low": "#f1f3ff",
        "surface-container": "#e9edff",
        "on-primary": "#ffffff",
        "error": "#ba1a1a",
        "tertiary-fixed": "#ffdad9",
        "on-primary-fixed-variant": "#005231",
        "secondary-fixed-dim": "#c0c7d6",
        "inverse-surface": "#293040",
        "secondary": "#585f6c",
        "outline-variant": "#becabf",
        "on-background": "#141b2b",
        "secondary-container": "#dce2f3",
        "on-tertiary": "#ffffff",
        "on-secondary-container": "#5e6572",
        "on-error": "#ffffff",
        "primary-fixed": "#96f6bd",
        "inverse-on-surface": "#edf0ff",
        "on-tertiary-container": "#fff8f8",
        "inverse-primary": "#7adaa3",
        "on-secondary": "#ffffff",
        "on-primary-container": "#ebffef"
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "12px",
        xl: "16px",
        full: "9999px"
      },
      spacing: {
        md: "16px",
        "container-margin": "20px",
        xl: "32px",
        base: "4px",
        gutter: "16px",
        lg: "24px",
        xs: "4px",
        sm: "8px"
      },
      fontFamily: {
        "display-lg-mobile": ["IBM Plex Sans Arabic"],
        "display-lg": ["IBM Plex Sans Arabic"],
        "label-md": ["IBM Plex Sans Arabic"],
        "label-sm": ["IBM Plex Sans Arabic"],
        "headline-sm": ["IBM Plex Sans Arabic"],
        "headline-md": ["IBM Plex Sans Arabic"],
        "body-lg": ["IBM Plex Sans Arabic"],
        "body-md": ["IBM Plex Sans Arabic"]
      },
      fontSize: {
        "display-lg-mobile": ["26px", { lineHeight: "34px", fontWeight: "700" }],
        "display-lg": ["30px", { lineHeight: "40px", fontWeight: "700" }],
        "label-md": ["14px", { lineHeight: "20px", fontWeight: "500" }],
        "label-sm": ["12px", { lineHeight: "16px", fontWeight: "500" }],
        "headline-sm": ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "headline-md": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "body-lg": ["18px", { lineHeight: "28px", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }]
      }
    }
  }
};

// Auto-apply config if Tailwind is loaded
if (typeof tailwind !== 'undefined') {
  tailwind.config = window.sharedTailwindConfig;
}
