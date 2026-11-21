// Language-neutral data shared by every translation.
// Arrays are aligned with the item order in each i18n file.
window.SHARED = {
  langs: [
    ["en", "English (US)"], ["ko", "한국어"], ["ja", "日本語"], ["zh", "简体中文"],
    ["hi", "हिन्दी"], ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"]
  ],
  theoryImg: [null, null, null, "ohm", null, "series_parallel", "kirchhoff", "ac_wave", null, "power_triangle",
    "capacitor", "inductor", null, "three_phase", "star_delta", "transformer", null, "rectifier", "earthing", "breakers",
    "motor", null, null, "induction"],
  installImg: ["switch", "two_way", "outlet", "kwh", "panel", "panel", "fan", "doorbell", "changeover", "ups",
    null, null, null, "cctv", null],
  solarImg: ["solar", "solar_string", null, null, null, null, null],
  toolEmoji: ["🪛", "🔌", "📟", "✂️", "🗜️", "🔧", "🔨", "📏", "🔦", "🪜", "🧰", "🔩", "🪚", "🔥", "🧵", "🪝", "🎚️", "⚡", "🧪", "📐"],
  safetyEmoji: ["🔒", "🧪", "🧤", "🥽", "👢", "💧", "🪜", "🔥", "⚠️", "🚑", "🧯", "🧠"],
  sections: [
    { id: "theory",  color: "#2F80ED", icon: "M13 2L4 14h7l-1 8 9-12h-7z" },
    { id: "install", color: "#F2994A", icon: "M4 20h16M6 20V10l6-6 6 6v10M10 20v-6h4v6" },
    { id: "calc",    color: "#27AE60", icon: "M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM8 6h8v3H8zM8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0" },
    { id: "tools",   color: "#9B51E0", icon: "M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.1-.6-.6-2.1z" },
    { id: "safety",  color: "#EB5757", icon: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5zM9 12l2 2 4-4" },
    { id: "terms",   color: "#00A3A3", icon: "M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11" },
    { id: "solar",   color: "#E0B000", icon: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 110 8 4 4 0 010-8z" },
    { id: "quiz",    color: "#D6336C", icon: "M9 9a3 3 0 115 2.2c-1 .7-2 1.3-2 2.8M12 18h0M12 2a10 10 0 110 20 10 10 0 010-20z" }
  ]
};
