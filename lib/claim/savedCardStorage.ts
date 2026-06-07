// lib/claim/savedCardStorage.ts

import AsyncStorage from "@react-native-async-storage/async-storage";
import { type SavedClaimCard } from "./savedCard";

const STORAGE_KEY = "clashroom:saved_cards:v1";

function isValidSavedCard(record: unknown): record is SavedClaimCard {
  if (!record || typeof record !== "object") return false;
  const r = record as Record<string, unknown>;
  return (
    r.schemaVersion === 1 &&
    typeof r.id === "string" &&
    typeof r.text === "string" &&
    typeof r.savedAt === "number"
  );
}

export async function loadSavedCards(): Promise<SavedClaimCard[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSavedCard);
  } catch (e) {
    if (__DEV__) console.warn("[savedCardStorage] load failed", e);
    return [];
  }
}

export async function persistSavedCards(cards: SavedClaimCard[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch (e) {
    if (__DEV__) console.warn("[savedCardStorage] persist failed", e);
  }
}
