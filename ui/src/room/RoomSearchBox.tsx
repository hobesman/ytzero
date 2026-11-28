import { useEffect, useState, type FormEvent } from "react";
import { Mic, Search } from "lucide-react";
import { useI18n } from "../i18n";
import { Button, IconButton, Input } from "../components/ui";
import { useVoiceSearch } from "./useVoiceSearch";

/**
 * The room page's search field: large for touch, with a microphone where the
 * browser can hear (a spoken search runs straight away). Where it can't, the
 * keyboard's own microphone key still types by voice.
 */
export function RoomSearchBox({ value, placeholder, onSearch }: { value: string; placeholder: string; onSearch: (query: string) => void }) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const voice = useVoiceSearch(locale, (text) => { setDraft(text); onSearch(text); });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) onSearch(draft.trim());
  };
  const listening = voice.state === "listening";
  return <form className="room-search" role="search" onSubmit={submit}>
    <div className="room-search__row">
      <Input size="lg" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={listening ? t("roomVoiceListening") : placeholder}
        aria-label={placeholder} enterKeyHint="search" />
      {voice.supported ? <IconButton size="lg" type="button" variant={listening ? "primary" : "secondary"} busy={listening} aria-pressed={listening}
        label={t("roomVoiceSearch")} icon={<Mic />} onClick={voice.start} /> : null}
      <Button size="lg" type="submit" leadingIcon={<Search />}>{t("search")}</Button>
    </div>
    {voice.state === "failed" ? <p className="room-search__note" role="status">{t("roomVoiceFailed")}</p> : null}
  </form>;
}
