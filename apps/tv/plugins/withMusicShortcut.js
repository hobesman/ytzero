// Adds a "Music" shortcut to the Android app icon (long press). It opens the
// app with ytzero://music, which starts it in music mode. Labels follow the
// app's languages; see src/music/musicMessages.ts for the in-app copy.
const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const labels = {
  "": { short: "Music", long: "Play music" },
  pl: { short: "Muzyka", long: "Odtwarzaj muzykę" },
  de: { short: "Musik", long: "Musik abspielen" },
  fr: { short: "Musique", long: "Écouter de la musique" },
  es: { short: "Música", long: "Escuchar música" },
  "pt-rBR": { short: "Música", long: "Ouvir música" },
  ru: { short: "Музыка", long: "Слушать музыку" },
  ja: { short: "音楽", long: "音楽を再生" },
  hu: { short: "Zene", long: "Zene lejátszása" },
};

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "\\'").replace(/"/g, '\\"');

const shortcutsXml = (pkg) => `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut
    android:shortcutId="music"
    android:enabled="true"
    android:icon="@drawable/ytzero_shortcut_music"
    android:shortcutShortLabel="@string/ytzero_shortcut_music_short"
    android:shortcutLongLabel="@string/ytzero_shortcut_music_long">
    <intent
      android:action="android.intent.action.VIEW"
      android:data="ytzero://music"
      android:targetPackage="${pkg}"
      android:targetClass="${pkg}.MainActivity" />
  </shortcut>
</shortcuts>
`;

// A music note on the accent circle, drawn like the app's other icons.
const iconXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="48dp" android:height="48dp" android:viewportWidth="48" android:viewportHeight="48">
  <path android:fillColor="#4D8CFF" android:pathData="M24,0a24,24 0,1 1,0 48a24,24 0,1 1,0 -48z" />
  <path android:fillColor="#FFFFFF" android:pathData="M20,14L34,11.5L34,29.5A4.5,4.5 0,1 1,31 25.3L31,16.4L23,17.9L23,32.5A4.5,4.5 0,1 1,20 28.3Z" />
</vector>
`;

module.exports = function withMusicShortcut(config) {
  config = withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    activity["meta-data"] = (activity["meta-data"] ?? []).filter((entry) => entry.$["android:name"] !== "android.app.shortcuts");
    activity["meta-data"].push({ $: { "android:name": "android.app.shortcuts", "android:resource": "@xml/ytzero_shortcuts" } });
    return mod;
  });
  return withDangerousMod(config, ["android", (mod) => {
    const res = path.join(mod.modRequest.platformProjectRoot, "app", "src", "main", "res");
    const write = (dir, file, text) => {
      fs.mkdirSync(path.join(res, dir), { recursive: true });
      fs.writeFileSync(path.join(res, dir, file), text);
    };
    const pkg = mod.android?.package ?? "app.ytzero.tv";
    write("xml", "ytzero_shortcuts.xml", shortcutsXml(pkg));
    write("drawable", "ytzero_shortcut_music.xml", iconXml);
    for (const [qualifier, label] of Object.entries(labels)) {
      write(qualifier ? `values-${qualifier}` : "values", "ytzero_shortcut_strings.xml", `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="ytzero_shortcut_music_short">${escape(label.short)}</string>
  <string name="ytzero_shortcut_music_long">${escape(label.long)}</string>
</resources>
`);
    }
    return mod;
  }]);
};
