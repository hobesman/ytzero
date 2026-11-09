import type { Language } from "./types";

type Messages = {
  appUpdates: string; installedVersion: string; appBuild: string; appLocalBuild: string;
  updateAvailable: string; updateAvailableHint: string; updateUpToDate: string;
  updateChecking: string; updateCheckFailed: string; checkForUpdates: string;
};

export const appUpdateMessages: Record<Language, Messages> = {
  en: {
    appUpdates: "App updates", installedVersion: "Installed version", appBuild: "Build {build}", appLocalBuild: "Local build",
    updateAvailable: "Update available", updateAvailableHint: "Build {build} is ready. Download it, then open the file to install it.",
    updateUpToDate: "Up to date", updateChecking: "Checking for updates…", updateCheckFailed: "Couldn't check for updates.", checkForUpdates: "Check for updates",
  },
  pl: {
    appUpdates: "Aktualizacje aplikacji", installedVersion: "Zainstalowana wersja", appBuild: "Kompilacja {build}", appLocalBuild: "Kompilacja lokalna",
    updateAvailable: "Dostępna aktualizacja", updateAvailableHint: "Kompilacja {build} jest gotowa. Pobierz ją, a potem otwórz plik, aby ją zainstalować.",
    updateUpToDate: "Aplikacja jest aktualna", updateChecking: "Sprawdzanie aktualizacji…", updateCheckFailed: "Nie udało się sprawdzić aktualizacji.", checkForUpdates: "Sprawdź aktualizacje",
  },
  de: {
    appUpdates: "App-Updates", installedVersion: "Installierte Version", appBuild: "Build {build}", appLocalBuild: "Lokaler Build",
    updateAvailable: "Update verfügbar", updateAvailableHint: "Build {build} ist bereit. Lade ihn herunter und öffne dann die Datei, um ihn zu installieren.",
    updateUpToDate: "Auf dem neuesten Stand", updateChecking: "Suche nach Updates…", updateCheckFailed: "Updates konnten nicht geprüft werden.", checkForUpdates: "Nach Updates suchen",
  },
  fr: {
    appUpdates: "Mises à jour de l’application", installedVersion: "Version installée", appBuild: "Build {build}", appLocalBuild: "Build local",
    updateAvailable: "Mise à jour disponible", updateAvailableHint: "Le build {build} est prêt. Téléchargez-le, puis ouvrez le fichier pour l’installer.",
    updateUpToDate: "À jour", updateChecking: "Recherche de mises à jour…", updateCheckFailed: "Impossible de rechercher les mises à jour.", checkForUpdates: "Rechercher des mises à jour",
  },
  es: {
    appUpdates: "Actualizaciones de la aplicación", installedVersion: "Versión instalada", appBuild: "Compilación {build}", appLocalBuild: "Compilación local",
    updateAvailable: "Actualización disponible", updateAvailableHint: "La compilación {build} está lista. Descárgala y abre el archivo para instalarla.",
    updateUpToDate: "Actualizada", updateChecking: "Buscando actualizaciones…", updateCheckFailed: "No se pudieron buscar actualizaciones.", checkForUpdates: "Buscar actualizaciones",
  },
  "pt-BR": {
    appUpdates: "Atualizações do aplicativo", installedVersion: "Versão instalada", appBuild: "Build {build}", appLocalBuild: "Build local",
    updateAvailable: "Atualização disponível", updateAvailableHint: "O build {build} está pronto. Baixe-o e abra o arquivo para instalá-lo.",
    updateUpToDate: "Atualizado", updateChecking: "Procurando atualizações…", updateCheckFailed: "Não foi possível procurar atualizações.", checkForUpdates: "Procurar atualizações",
  },
  ru: {
    appUpdates: "Обновления приложения", installedVersion: "Установленная версия", appBuild: "Сборка {build}", appLocalBuild: "Локальная сборка",
    updateAvailable: "Доступно обновление", updateAvailableHint: "Сборка {build} готова. Скачайте её, затем откройте файл, чтобы установить.",
    updateUpToDate: "Установлена последняя версия", updateChecking: "Проверка обновлений…", updateCheckFailed: "Не удалось проверить обновления.", checkForUpdates: "Проверить обновления",
  },
  ja: {
    appUpdates: "アプリのアップデート", installedVersion: "インストール済みのバージョン", appBuild: "ビルド {build}", appLocalBuild: "ローカルビルド",
    updateAvailable: "アップデートがあります", updateAvailableHint: "ビルド {build} を利用できます。ダウンロードしてからファイルを開き、インストールしてください。",
    updateUpToDate: "最新の状態です", updateChecking: "アップデートを確認中…", updateCheckFailed: "アップデートを確認できませんでした。", checkForUpdates: "アップデートを確認",
  },
  hu: {
    appUpdates: "Alkalmazásfrissítések", installedVersion: "Telepített verzió", appBuild: "{build}. build", appLocalBuild: "Helyi build",
    updateAvailable: "Frissítés érhető el", updateAvailableHint: "A(z) {build}. build elkészült. Töltsd le, majd nyisd meg a fájlt a telepítéshez.",
    updateUpToDate: "Naprakész", updateChecking: "Frissítések keresése…", updateCheckFailed: "Nem sikerült frissítéseket keresni.", checkForUpdates: "Frissítések keresése",
  },
};
