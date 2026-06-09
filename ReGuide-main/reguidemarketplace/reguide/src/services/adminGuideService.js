const ADMIN_GUIDE_STATE_KEY = "reguideAdminGuideState";

function getStoredGuideState() {
  try {
    const raw = localStorage.getItem(ADMIN_GUIDE_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredGuideState(state) {
  localStorage.setItem(ADMIN_GUIDE_STATE_KEY, JSON.stringify(state || {}));
}

function toGuideKey(guideId) {
  return String(guideId || "");
}

function patchGuideState(guideId, partial) {
  const key = toGuideKey(guideId);
  if (!key) return;

  const state = getStoredGuideState();
  const previous = state[key] || {};
  const previousFlagCount = Number(previous?.flagCount || 0);
  const nextFlagCount = Number(partial?.flagCount ?? previousFlagCount);

  state[key] = {
    suspended: Boolean(previous?.suspended),
    flagged: Boolean(previous?.flagged),
    flagCount: Number.isFinite(nextFlagCount) ? Math.max(0, nextFlagCount) : 0,
    removedFromBrowse: Boolean(previous?.removedFromBrowse),
    updatedAt: previous?.updatedAt || null,
    ...partial,
    flagged: Boolean(partial?.flagged ?? previous?.flagged),
    removedFromBrowse: Boolean(
      partial?.removedFromBrowse ??
      previous?.removedFromBrowse ??
      (Number.isFinite(nextFlagCount) ? nextFlagCount >= 4 : false)
    ),
    updatedAt: new Date().toISOString(),
  };

  saveStoredGuideState(state);
  window.dispatchEvent(new Event("reguide-guides-updated"));
}

export function getGuideAdminStateMap() {
  return getStoredGuideState();
}

export async function setGuideSuspended(guideId, suspended) {
  patchGuideState(guideId, { suspended: Boolean(suspended) });
}

export async function setGuideFlagged(guideId, flagged) {
  const state = getStoredGuideState();
  const key = toGuideKey(guideId);
  const previous = state[key] || {};
  const currentCount = Number(previous?.flagCount || 0);
  const nextCount = Boolean(flagged) ? currentCount + 1 : Math.max(0, currentCount - 1);
  patchGuideState(guideId, {
    flagged: nextCount > 0,
    flagCount: nextCount,
    removedFromBrowse: nextCount >= 4,
  });
}

export async function incrementGuideFlagCount(guideId) {
  const state = getStoredGuideState();
  const key = toGuideKey(guideId);
  const previous = state[key] || {};
  const nextCount = Number(previous?.flagCount || 0) + 1;

  patchGuideState(guideId, {
    flagged: true,
    flagCount: nextCount,
    removedFromBrowse: nextCount >= 4,
  });

  return {
    flagCount: nextCount,
    removedFromBrowse: nextCount >= 4,
  };
}

export function getGuideFlagCount(guideId) {
  const state = getStoredGuideState();
  const key = toGuideKey(guideId);
  return Number(state?.[key]?.flagCount || 0);
}

export function isGuideRemovedFromBrowse(guideId) {
  const state = getStoredGuideState();
  const key = toGuideKey(guideId);
  const item = state?.[key];
  if (!item) return false;
  return Boolean(item?.removedFromBrowse) || Number(item?.flagCount || 0) >= 4;
}

export function getSuspendedGuideIdSet() {
  const state = getStoredGuideState();
  return new Set(
    Object.entries(state)
      .filter(([, value]) => Boolean(value?.suspended))
      .map(([key]) => String(key))
  );
}

export function getRemovedGuideIdSet() {
  const state = getStoredGuideState();
  return new Set(
    Object.entries(state)
      .filter(([, value]) => Boolean(value?.removedFromBrowse) || Number(value?.flagCount || 0) >= 4)
      .map(([key]) => String(key))
  );
}
