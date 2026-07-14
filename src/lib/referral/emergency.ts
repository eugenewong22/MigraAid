/**
 * Emergency & support directory. Static data so it renders instantly and can be
 * cached for offline use (a worker in distress may have no data connection).
 *
 * Government emergency numbers (999/995) are stable; NGO hotlines should be
 * verified against each organisation before launch.
 */
export type EmergencyCategory = "urgent" | "government" | "ngo";

export interface EmergencyContact {
  name: string;
  number: string;
  category: EmergencyCategory;
  note?: string;
}

export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  { name: "Police", number: "999", category: "urgent" },
  { name: "Ambulance / Fire", number: "995", category: "urgent" },
  { name: "Non-emergency ambulance", number: "1777", category: "urgent" },
  {
    name: "MOM (Ministry of Manpower)",
    number: "1800 339 5505",
    category: "government",
    note: "Work permit, salary, workplace safety",
  },
  {
    name: "TADM (salary & disputes)",
    number: "1800 342 1800",
    category: "government",
  },
  {
    name: "HOME Helpline",
    number: "1800 797 7977",
    category: "ngo",
    note: "Migrant worker support",
  },
  { name: "TWC2", number: "+65 6297 7564", category: "ngo" },
  {
    name: "HealthServe",
    number: "+65 3138 4443",
    category: "ngo",
    note: "Medical care & counselling",
  },
];

/** Turns a display number into a tel: href. */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^+\d]/g, "")}`;
}
