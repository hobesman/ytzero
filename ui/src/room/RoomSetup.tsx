import { useEffect, useState, type FormEvent } from "react";
import { Link2 } from "lucide-react";
import { useI18n } from "../i18n";
import { Alert, Button, Chip, Dialog, Field, Inline, Input, SelectMenu, Stack, Text } from "../components/ui";
import { roomApi, type AlexaRooms, type HomeAssistantPlayers, type RoomPairResult } from "./roomApi";
import { findRoom, roomPath } from "./roomState";

/**
 * Out-of-the-way setup, opened by holding the room name: which room this
 * tablet shows, which Home Assistant Echo is that room's, and one-tap pairing.
 */
export function RoomSetup({ open, onOpenChange, homeRoom, rooms, onChooseRoom, onChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeRoom: string | null;
  rooms: AlexaRooms | null;
  onChooseRoom: (room: string) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(homeRoom ?? "");
  const [players, setPlayers] = useState<HomeAssistantPlayers | null>(null);
  const [entityError, setEntityError] = useState<string | null>(null);
  const [savingEntity, setSavingEntity] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [paired, setPaired] = useState<RoomPairResult | { error: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(homeRoom ?? "");
    setPaired(null);
    setEntityError(null);
    roomApi.homeAssistant().then(setPlayers, (error) => setPlayers({ enabled: false, reason: error instanceof Error ? error.message : String(error), mediaPlayers: [] }));
  }, [homeRoom, open]);

  const room = homeRoom ? findRoom(rooms, homeRoom) : null;
  const entity = room?.homeAssistant?.entity ?? "";
  const choose = (event?: FormEvent) => {
    event?.preventDefault();
    const chosen = name.replace(/\s+/g, " ").trim();
    if (chosen) onChooseRoom(chosen);
  };
  const setEntity = (next: string) => {
    if (!homeRoom) return;
    setSavingEntity(true);
    setEntityError(null);
    roomApi.setEntity(homeRoom, next || null).then(onChanged, (error) => setEntityError(error instanceof Error ? error.message : String(error)))
      .finally(() => setSavingEntity(false));
  };
  const pair = () => {
    if (!homeRoom) return;
    setPairing(true);
    setPaired(null);
    roomApi.pair(homeRoom).then(setPaired, (error) => setPaired({ error: error instanceof Error ? error.message : String(error) }))
      .finally(() => { setPairing(false); onChanged(); });
  };

  const options = [
    { value: "", label: t("roomSetupEchoNone") },
    ...(players?.mediaPlayers ?? []).map((player) => ({ value: player.entity, label: player.name ?? player.entity, searchText: player.entity })),
  ];
  if (entity && !options.some((option) => option.value === entity)) options.push({ value: entity, label: entity, searchText: entity });

  return <Dialog open={open} onOpenChange={onOpenChange} title={t("roomSetupTitle")} closeLabel={t("close")} className="room-setup"
    footer={<Button onClick={() => onOpenChange(false)}>{t("close")}</Button>}>
    <Stack gap={5}>
      <Text tone="secondary" size="sm">{t("roomSetupHint")}</Text>
      <form onSubmit={choose}>
        <Field label={t("roomSetupRoom")} hint={t("roomSetupRoomHint", { path: roomPath(name.trim() || "Kitchen") })}>
          <Inline gap={2} wrap={false}>
            <Input size="lg" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} aria-label={t("roomSetupRoom")} />
            <Button size="lg" variant="primary" type="submit" disabled={!name.trim() || name.trim() === homeRoom}>{t("save")}</Button>
          </Inline>
        </Field>
        {rooms?.rooms.length ? <Inline gap={2} className="room-setup__rooms">
          {rooms.rooms.map((item) => <Chip key={item.room} active={item.room.toLowerCase() === name.trim().toLowerCase()} onClick={() => setName(item.room)}>{item.room}</Chip>)}
        </Inline> : null}
      </form>
      {homeRoom ? <>
        <Field label={t("roomSetupEcho", { room: homeRoom })} hint={t("roomSetupEchoHint")} error={entityError ?? undefined}>
          {players && !players.enabled
            ? <Alert variant="warning">{t("roomSetupEchoUnavailable", { reason: players.reason ?? "" })}</Alert>
            : <SelectMenu value={entity} options={options} onChange={setEntity} label={t("roomSetupEcho", { room: homeRoom })}
              disabled={!players || savingEntity} searchable={options.length > 8} searchPlaceholder={t("search")} floating />}
        </Field>
        <Field label={t("roomSetupPair")} hint={t("roomSetupPairHint")}>
          <div>
            <Button size="lg" leadingIcon={<Link2 />} busy={pairing} disabled={pairing || !entity} onClick={pair}>
              {pairing ? t("roomSetupPairing") : t("roomSetupPair")}
            </Button>
          </div>
        </Field>
        {paired && "error" in paired ? <Alert variant="danger">{paired.error}</Alert> : null}
        {paired && "paired" in paired && paired.paired.length ? <Alert variant="success">{t("roomSetupPaired", { skills: paired.paired.join(", ") })}</Alert> : null}
        {paired && "failed" in paired && paired.failed.length ? <Alert variant="warning">
          {t("roomSetupPairFailed", { reasons: paired.failed.map((item) => `${item.skill}: ${item.reason}`).join("; ") })}
        </Alert> : null}
      </> : null}
    </Stack>
  </Dialog>;
}
