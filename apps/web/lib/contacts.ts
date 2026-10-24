/**
 * Picking a customer out of the phone's address book.
 *
 * Nearly every job here starts with a stranger ringing up, and the person
 * booking it is usually holding the phone they rang. The Contact Picker gets
 * the name, the number and sometimes the address across without anybody
 * typing them, which is three chances to make a typo removed.
 *
 * It exists on Chrome for Android and nowhere else that matters here — not on
 * a desktop, not in Safari — so everything below is a progressive
 * enhancement. The button is simply absent where the API is not, and the
 * fields are typed as they always were.
 *
 * Two things the specification insists on and are easy to miss: it needs a
 * secure context and a real tap (an ordinary click handler is fine), and it
 * refuses outright if asked for a property the device does not offer. So the
 * list is intersected with `getProperties()` rather than assumed — `address`
 * in particular is missing on plenty of builds.
 */

export type ContactProperty = 'name' | 'tel' | 'email' | 'address';

type PickedAddress = {
  addressLine?: string[];
  city?: string;
  region?: string;
  postalCode?: string;
};

type PickedContact = {
  name?: string[];
  tel?: string[];
  email?: string[];
  address?: PickedAddress[];
};

type ContactsManager = {
  select: (props: ContactProperty[], options?: { multiple?: boolean }) => Promise<PickedContact[]>;
  getProperties: () => Promise<ContactProperty[]>;
};

const manager = (): ContactsManager | null => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  if (!('contacts' in navigator) || !('ContactsManager' in window)) return null;
  return (navigator as Navigator & { contacts: ContactsManager }).contacts;
};

/**
 * Whether this browser can offer the address book at all.
 *
 * Call it from an effect, never while rendering: the server has no navigator,
 * so deciding during render means the server says no, the browser says yes,
 * and React throws the markup away with a hydration error.
 */
export const canPickContact = () => manager() !== null;

export type ContactPick = {
  name: string;
  phone: string;
  address1: string;
  city: string;
  state: string;
  postal: string;
};

/**
 * Opens the picker. Returns null when the person backs out of it, which is
 * not an error and must not look like one.
 */
export async function pickContact(): Promise<ContactPick | null> {
  const contacts = manager();
  if (!contacts) return null;

  const wanted: ContactProperty[] = ['name', 'tel', 'address'];
  let available: ContactProperty[];
  try {
    available = await contacts.getProperties();
  } catch {
    // Older implementations lack getProperties; name and tel are the two
    // every one of them has.
    available = ['name', 'tel'];
  }
  const asking = wanted.filter((p) => available.includes(p));
  if (asking.length === 0) return null;

  let picked: PickedContact[];
  try {
    picked = await contacts.select(asking, { multiple: false });
  } catch {
    // Cancelled, or refused for want of a user gesture. Either way there is
    // nothing to report — the form stays exactly as it was.
    return null;
  }

  const one = picked[0];
  if (!one) return null;

  const address = one.address?.[0];
  return {
    name: one.name?.[0]?.trim() ?? '',
    phone: one.tel?.[0]?.trim() ?? '',
    address1: address?.addressLine?.filter(Boolean).join(', ').trim() ?? '',
    city: address?.city?.trim() ?? '',
    state: address?.region?.trim() ?? '',
    postal: address?.postalCode?.trim() ?? '',
  };
}
