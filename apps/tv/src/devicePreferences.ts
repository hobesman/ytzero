/** Device-only preferences; never sent to the instance or included in its backups. */
export const OPEN_DETAILS_KEY = "ytzero.tv.open-details";
type Store = { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void> };
export const loadOpenDetails = async (store: Store, legacy?: Store): Promise<boolean> => {
  let value = await store.getItemAsync(OPEN_DETAILS_KEY);
  if (value === null && legacy) {
    value = await legacy.getItemAsync(OPEN_DETAILS_KEY);
    if (value === "true" || value === "false") await store.setItemAsync(OPEN_DETAILS_KEY, value);
  }
  return value === "true";
};
export const saveOpenDetails = (store: Store, value: boolean): Promise<void> => store.setItemAsync(OPEN_DETAILS_KEY, String(value));
export const shouldPlayVideo = (openDetails: boolean, explicit?: boolean): boolean => explicit ?? !openDetails;

/** The phone layout (Android phones only). Unset follows the device: on for phones; an explicit choice wins. */
export const PHONE_LAYOUT_KEY = "ytzero.tv.phone-layout";
export const loadPhoneLayout = async (store: Store, deviceDefault: boolean): Promise<boolean> => {
  const value = await store.getItemAsync(PHONE_LAYOUT_KEY);
  return value === "true" ? true : value === "false" ? false : deviceDefault;
};
export const savePhoneLayout = (store: Store, value: boolean): Promise<void> => store.setItemAsync(PHONE_LAYOUT_KEY, String(value));
