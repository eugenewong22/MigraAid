/**
 * Emergency & support directory. Static data so it renders instantly and can be
 * cached for offline use (a worker in distress may have no data connection).
 *
 * Contacts were verified against government/organisation websites on
 * 2026-07-14 and should be re-checked as part of the content review cycle.
 */
export type EmergencyCategory = "urgent" | "government" | "ngo";

export interface EmergencyContact {
  /** Stable key for translated name/note lookups (emergency.contacts.<id>.*). */
  id: string;
  /** English source name (also the fallback in messages/en.json). */
  name: string;
  number: string;
  href?: string;
  category: EmergencyCategory;
  /** English source note; presence signals the row has a translated note. */
  note?: string;
}

export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  { id: "police", name: "Police", number: "999", category: "urgent" },
  {
    id: "policeSms",
    name: "Police emergency SMS",
    number: "70999",
    href: "sms:70999",
    category: "urgent",
    note: "If it is unsafe to speak or you cannot speak",
  },
  { id: "ambulanceFire", name: "Ambulance / Fire", number: "995", category: "urgent" },
  {
    id: "nonEmergencyAmbulance",
    name: "Non-emergency ambulance",
    number: "1777",
    category: "urgent",
  },
  {
    id: "mom",
    name: "MOM (Ministry of Manpower)",
    number: "+65 6438 5122",
    category: "government",
    note: "Work permit, salary, workplace safety",
  },
  {
    id: "home",
    name: "HOME Helpline",
    number: "+65 6341 5535",
    category: "ngo",
    note: "Migrant worker support",
  },
  { id: "twc2", name: "TWC2 Helpline", number: "1800 888 1515", category: "ngo" },
  {
    id: "healthserve",
    name: "HealthServe",
    number: "+65 3129 5000",
    category: "ngo",
    note: "Medical care & counselling",
  },
];

/** Turns a display number into a tel: href. */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^+\d]/g, "")}`;
}

export function contactHref(contact: EmergencyContact): string {
  return contact.href ?? telHref(contact.number);
}
