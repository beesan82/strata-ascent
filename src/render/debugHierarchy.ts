import type { Camera } from '../core/camera';
import {
  regionAt, sectorAt, districtAt, roomAt,
  SECTOR_SIZE, DISTRICT_SIZE, ROOM_SIZE,
} from '../world/hierarchy';

const SYSTEM_HUE: Record<string, number> = {
  water: 200, power: 50, habitation: 130, disposal: 20, foundry: 340,
};

/**
 * 階層グリッドを半透明で重ねて可視化する。
 * region=系統色の room 塗り、district=状態色の枠、sector=ハブ十字、HUD=現在地情報。
 */
export function drawHierarchyDebug(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  seed: number,
  w: number,
  h: number,
  ppt: number,
): void {
  const toX = (wx: number) => (wx - cam.x) * ppt + w / 2;
  const toY = (wy: number) => (wy - cam.y) * ppt + h / 2;
  const x0 = cam.x - w / ppt / 2, x1 = cam.x + w / ppt / 2;
  const y0 = cam.y - h / ppt / 2, y1 = cam.y + h / ppt / 2;

  ctx.save();
  ctx.globalAlpha = 0.5;

  for (let rmy = Math.floor(y0 / ROOM_SIZE); rmy <= Math.floor(y1 / ROOM_SIZE); rmy++) {
    for (let rmx = Math.floor(x0 / ROOM_SIZE); rmx <= Math.floor(x1 / ROOM_SIZE); rmx++) {
      const wx = rmx * ROOM_SIZE, wy = rmy * ROOM_SIZE;
      const room = roomAt(seed, wx, wy);
      if (!room.present) continue;
      const hue = SYSTEM_HUE[regionAt(seed, wx, wy).system] ?? 0;
      ctx.fillStyle = `hsla(${hue}, 60%, 50%, ${0.25 + room.decay * 0.4})`;
      ctx.fillRect(toX(wx), toY(wy), ROOM_SIZE * ppt, ROOM_SIZE * ppt);
    }
  }

  ctx.lineWidth = 1;
  for (let dy = Math.floor(y0 / DISTRICT_SIZE); dy <= Math.floor(y1 / DISTRICT_SIZE); dy++) {
    for (let dx = Math.floor(x0 / DISTRICT_SIZE); dx <= Math.floor(x1 / DISTRICT_SIZE); dx++) {
      const wx = dx * DISTRICT_SIZE, wy = dy * DISTRICT_SIZE;
      const d = districtAt(seed, wx, wy);
      ctx.strokeStyle = d.state === 'active' ? '#fff' : d.state === 'ruined' ? '#888' : '#a33';
      ctx.strokeRect(toX(wx), toY(wy), DISTRICT_SIZE * ppt, DISTRICT_SIZE * ppt);
    }
  }

  ctx.strokeStyle = '#ff0';
  ctx.lineWidth = 2;
  for (let sy = Math.floor(y0 / SECTOR_SIZE); sy <= Math.floor(y1 / SECTOR_SIZE); sy++) {
    for (let sx = Math.floor(x0 / SECTOR_SIZE); sx <= Math.floor(x1 / SECTOR_SIZE); sx++) {
      const s = sectorAt(seed, sx * SECTOR_SIZE, sy * SECTOR_SIZE);
      const hx = toX(sx * SECTOR_SIZE + s.hubX);
      const hy = toY(sy * SECTOR_SIZE + s.hubY);
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy); ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8); ctx.lineTo(hx, hy + 8);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0f0';
  ctx.font = '12px monospace';
  const region = regionAt(seed, cam.x, cam.y);
  const d = districtAt(seed, cam.x, cam.y);
  ctx.fillText(`region(${region.rx},${region.ry}) sys=${region.system} district=${d.facilityType}/${d.state}`, 12, h - 16);
  ctx.restore();
}
