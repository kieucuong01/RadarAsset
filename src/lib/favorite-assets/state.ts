import type { WatchlistItemResponse } from "@/lib/backend/types";

export type FavoriteUiState = {
  removeCandidateId: string | null;
  removingId: string | null;
};

export const initialFavoriteState: FavoriteUiState = {
  removeCandidateId: null,
  removingId: null,
};

export type FavoriteUiAction =
  | { type: "removeRequested"; favoriteId: string }
  | { type: "removeCancelled" }
  | { type: "removeStarted"; favoriteId: string }
  | { type: "removeFinished" };

export function favoriteReducer(state: FavoriteUiState, action: FavoriteUiAction): FavoriteUiState {
  if (action.type === "removeRequested") return { ...state, removeCandidateId: action.favoriteId };
  if (action.type === "removeCancelled") return initialFavoriteState;
  if (action.type === "removeStarted") {
    return { removeCandidateId: action.favoriteId, removingId: action.favoriteId };
  }
  return initialFavoriteState;
}

export function favoriteActionState(item: WatchlistItemResponse) {
  const label = {
    ready: "Ready",
    loading: "Loading data",
    stale: "Stale",
    unavailable: "Unavailable",
  }[item.datasetState];
  const canBacktest = item.datasetState === "ready" && item.backtestableTimeframes.length > 0;
  return {
    canBacktest,
    backtestHref: canBacktest ? `/quant-lab?symbols=${encodeURIComponent(item.sym)}` : null,
    label,
  };
}
