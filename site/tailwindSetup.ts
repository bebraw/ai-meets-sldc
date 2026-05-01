import typography from "@tailwindcss/typography";
import meta from "./meta.json" with { type: "json" };

export default {
  content: ["./site/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: meta.colors,
      fontFamily: {
        headline: ["Finlandica Headline", "Georgia", "serif"],
        text: ["Finlandica Text", "Georgia", "serif"],
      },
    },
  },
  plugins: [typography],
};
