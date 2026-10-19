export function displayY(bodyY: number, bodyHeight: number): number {
  return Math.round(bodyY + bodyHeight);
}

/** HUD の「高度」(§6.5)。Y は下向き正なので符号を反転し、上へ登るほど増える(タイル単位) */
export function displayAltitude(bodyY: number, bodyHeight: number): number {
  return -displayY(bodyY, bodyHeight);
}

/** 到達した最高階層。落下で現在の階層が下がっても減らない */
export function highestLayer(prev: number, current: number): number {
  return Math.max(prev, current);
}
