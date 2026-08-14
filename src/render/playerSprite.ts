import { mixHex } from './biome';
import {
  calculatePlayerPose,
  type PlayerPose,
  type Vec2,
} from './playerPose';

export const PLAYER_COLORS = {
  face: '#d9dddc',
  uniform: '#151820',
  uniformLight: '#303640',
  joint: '#6f7479',
  chest: '#7f1f28',
  chestLight: '#a9363e',
  visor: '#171015',
  indicator: '#e64747',
  weapon: '#353a40',
} as const;

type PlayerPalette = { [Key in keyof typeof PLAYER_COLORS]: string };

const polygon = (
  ctx: CanvasRenderingContext2D,
  points: readonly Vec2[],
  color: string,
): void => {
  if (points.length < 3) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  ctx.fill();
};

const line = (
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  color: string,
  width: number,
): void => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
};

const drawJoint = (
  ctx: CanvasRenderingContext2D,
  center: Vec2,
  radius: number,
  color: string,
): void => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
};

const midpointWithBend = (from: Vec2, to: Vec2, bend: number): Vec2 => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: (from.x + to.x) / 2 - (dy / length) * bend,
    y: (from.y + to.y) / 2 + (dx / length) * bend,
  };
};

const drawLeg = (
  ctx: CanvasRenderingContext2D,
  hip: Vec2,
  knee: Vec2,
  foot: Vec2,
  facing: 1 | -1,
  palette: PlayerPalette,
  rear: boolean,
): void => {
  const ankle = { x: foot.x, y: foot.y - 0.13 };
  line(ctx, hip, knee, rear ? palette.uniform : palette.uniformLight, 0.17);
  line(ctx, knee, ankle, palette.uniform, 0.15);
  drawJoint(ctx, knee, 0.075, palette.joint);
  drawJoint(ctx, ankle, 0.052, palette.joint);
  polygon(ctx, [
    { x: ankle.x - facing * 0.07, y: ankle.y + 0.01 },
    { x: ankle.x + facing * 0.07, y: ankle.y + 0.01 },
    { x: foot.x + facing * 0.16, y: foot.y },
    { x: foot.x - facing * 0.08, y: foot.y },
  ], palette.uniformLight);
};

const drawTorsoArmor = (
  ctx: CanvasRenderingContext2D,
  pose: PlayerPose,
  facing: 1 | -1,
  palette: PlayerPalette,
): void => {
  const rearShoulder = {
    x: pose.neck.x - facing * 0.27,
    y: pose.neck.y + 0.12,
  };
  const frontShoulder = {
    x: pose.neck.x + facing * 0.31,
    y: pose.neck.y + 0.1,
  };
  const rearWaist = { x: pose.hip.x - facing * 0.13, y: pose.hip.y - 0.03 };
  const frontWaist = { x: pose.hip.x + facing * 0.14, y: pose.hip.y - 0.02 };

  polygon(ctx, [
    rearShoulder,
    { x: pose.neck.x - facing * 0.1, y: pose.neck.y - 0.02 },
    { x: pose.neck.x + facing * 0.11, y: pose.neck.y - 0.02 },
    frontShoulder,
    frontWaist,
    { x: pose.hip.x + facing * (0.2 + pose.coatSwing), y: pose.hip.y + 0.26 },
    { x: pose.hip.x + facing * 0.015, y: pose.hip.y + 0.18 },
    { x: pose.hip.x - facing * (0.19 - pose.coatSwing), y: pose.hip.y + 0.25 },
    rearWaist,
  ], palette.uniform);

  polygon(ctx, [
    { x: pose.neck.x - facing * 0.14, y: pose.neck.y + 0.13 },
    { x: pose.neck.x + facing * 0.19, y: pose.neck.y + 0.11 },
    { x: pose.hip.x + facing * 0.1, y: pose.hip.y - 0.16 },
    { x: pose.hip.x - facing * 0.09, y: pose.hip.y - 0.17 },
  ], palette.chest);

  polygon(ctx, [
    { x: pose.neck.x + facing * 0.02, y: pose.neck.y + 0.16 },
    { x: pose.neck.x + facing * 0.17, y: pose.neck.y + 0.14 },
    { x: pose.hip.x + facing * 0.08, y: pose.hip.y - 0.23 },
    { x: pose.hip.x + facing * 0.005, y: pose.hip.y - 0.25 },
  ], palette.chestLight);
};

const drawHead = (
  ctx: CanvasRenderingContext2D,
  pose: PlayerPose,
  facing: 1 | -1,
  palette: PlayerPalette,
): void => {
  const { head } = pose;
  polygon(ctx, [
    { x: head.x - facing * 0.15, y: head.y - 0.13 },
    { x: head.x + facing * 0.13, y: head.y - 0.15 },
    { x: head.x + facing * 0.19, y: head.y - 0.04 },
    { x: head.x + facing * 0.13, y: head.y + 0.17 },
    { x: head.x - facing * 0.11, y: head.y + 0.16 },
    { x: head.x - facing * 0.18, y: head.y + 0.02 },
  ], palette.uniform);

  polygon(ctx, [
    { x: head.x - facing * 0.015, y: head.y - 0.1 },
    { x: head.x + facing * 0.13, y: head.y - 0.08 },
    { x: head.x + facing * 0.12, y: head.y + 0.1 },
    { x: head.x - facing * 0.045, y: head.y + 0.11 },
    { x: head.x - facing * 0.085, y: head.y + 0.02 },
  ], palette.face);

  polygon(ctx, [
    { x: head.x - facing * 0.025, y: head.y - 0.045 },
    { x: head.x + facing * 0.145, y: head.y - 0.035 },
    { x: head.x + facing * 0.135, y: head.y + 0.015 },
    { x: head.x - facing * 0.035, y: head.y + 0.005 },
  ], palette.visor);

  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = pose.indicator;
  polygon(ctx, [
    { x: head.x - facing * 0.12, y: head.y + 0.03 },
    { x: head.x - facing * 0.075, y: head.y + 0.03 },
    { x: head.x - facing * 0.075, y: head.y + 0.075 },
    { x: head.x - facing * 0.12, y: head.y + 0.075 },
  ], palette.indicator);
  ctx.globalAlpha = previousAlpha;
};

const drawArm = (
  ctx: CanvasRenderingContext2D,
  shoulder: Vec2,
  hand: Vec2,
  bend: number,
  palette: PlayerPalette,
  rear: boolean,
): void => {
  const elbow = midpointWithBend(shoulder, hand, bend);
  line(ctx, shoulder, elbow, rear ? palette.uniform : palette.uniformLight, 0.13);
  drawJoint(ctx, elbow, 0.063, palette.joint);
  line(ctx, elbow, hand, palette.uniform, 0.115);
  drawJoint(ctx, hand, 0.046, palette.joint);
};

const pointAlong = (origin: Vec2, direction: Vec2, distance: number): Vec2 => ({
  x: origin.x + direction.x * distance,
  y: origin.y + direction.y * distance,
});

const weaponDirection = (pose: PlayerPose): Vec2 => {
  const dx = pose.muzzle.x - pose.weaponHand.x;
  const dy = pose.muzzle.y - pose.weaponHand.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
};

const supportContactOnWeapon = (pose: PlayerPose): Vec2 => {
  const direction = weaponDirection(pose);
  const supportOffset = {
    x: pose.supportHand.x - pose.weaponHand.x,
    y: pose.supportHand.y - pose.weaponHand.y,
  };
  const alongWeapon = supportOffset.x * direction.x + supportOffset.y * direction.y;
  return pointAlong(pose.weaponHand, direction, alongWeapon);
};

const offsetPoint = (
  origin: Vec2,
  direction: Vec2,
  along: number,
  normal: Vec2,
  across: number,
): Vec2 => ({
  x: origin.x + direction.x * along + normal.x * across,
  y: origin.y + direction.y * along + normal.y * across,
});

const drawWeapon = (
  ctx: CanvasRenderingContext2D,
  pose: PlayerPose,
  palette: PlayerPalette,
): void => {
  const direction = weaponDirection(pose);
  const normal = { x: -direction.y, y: direction.x };
  const supportContact = supportContactOnWeapon(pose);
  const supportAlong =
    (supportContact.x - pose.weaponHand.x) * direction.x +
    (supportContact.y - pose.weaponHand.y) * direction.y;
  const rearExtent = Math.min(-0.13, supportAlong - 0.035);

  polygon(ctx, [
    offsetPoint(pose.weaponHand, direction, rearExtent, normal, -0.075),
    offsetPoint(pose.muzzle, direction, 0.04, normal, -0.075),
    offsetPoint(pose.muzzle, direction, 0.08, normal, 0),
    offsetPoint(pose.muzzle, direction, 0.04, normal, 0.075),
    offsetPoint(pose.weaponHand, direction, rearExtent, normal, 0.075),
  ], palette.weapon);
  polygon(ctx, [
    offsetPoint(pose.weaponHand, direction, -0.08, normal, 0.03),
    offsetPoint(pose.weaponHand, direction, 0.03, normal, 0.03),
    offsetPoint(pose.weaponHand, direction, -0.04, normal, 0.26),
    offsetPoint(pose.weaponHand, direction, -0.15, normal, 0.22),
  ], palette.weapon);
  line(
    ctx,
    pointAlong(pose.weaponHand, direction, 0.06),
    pointAlong(pose.muzzle, direction, 0.025),
    palette.uniformLight,
    0.025,
  );
};

const drawArmsWeapon = (
  ctx: CanvasRenderingContext2D,
  pose: PlayerPose,
  facing: 1 | -1,
  palette: PlayerPalette,
): void => {
  drawArm(
    ctx,
    pose.weaponShoulder,
    pose.weaponHand,
    facing * -0.06,
    palette,
    false,
  );
  drawWeapon(ctx, pose, palette);
};

const drawAccents = (
  ctx: CanvasRenderingContext2D,
  pose: PlayerPose,
  facing: 1 | -1,
  palette: PlayerPalette,
): void => {
  line(ctx,
    { x: pose.head.x + facing * 0.13, y: pose.head.y - 0.14 },
    { x: pose.head.x + facing * 0.18, y: pose.head.y + 0.02 },
    palette.face,
    0.025,
  );
  line(ctx,
    { x: pose.neck.x + facing * 0.23, y: pose.neck.y + 0.12 },
    { x: pose.hip.x + facing * 0.12, y: pose.hip.y - 0.06 },
    palette.uniformLight,
    0.028,
  );
  line(ctx,
    { x: pose.neck.x + facing * 0.04, y: pose.neck.y + 0.17 },
    { x: pose.hip.x + facing * 0.075, y: pose.hip.y - 0.24 },
    palette.chestLight,
    0.022,
  );
};

const tintPalette = (ambientColor: string): PlayerPalette => ({
  face: mixHex(PLAYER_COLORS.face, ambientColor, 0.1),
  uniform: mixHex(PLAYER_COLORS.uniform, ambientColor, 0.25),
  uniformLight: mixHex(PLAYER_COLORS.uniformLight, ambientColor, 0.25),
  joint: mixHex(PLAYER_COLORS.joint, ambientColor, 0.22),
  chest: mixHex(PLAYER_COLORS.chest, ambientColor, 0.1),
  chestLight: mixHex(PLAYER_COLORS.chestLight, ambientColor, 0.1),
  visor: mixHex(PLAYER_COLORS.visor, ambientColor, 0.08),
  indicator: mixHex(PLAYER_COLORS.indicator, ambientColor, 0.08),
  weapon: mixHex(PLAYER_COLORS.weapon, ambientColor, 0.22),
});

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ppt: number,
  facing: 1 | -1,
  walkPhase: number,
  aimAngle: number,
  ambientColor: string,
  timeSec: number,
): void {
  const pose = calculatePlayerPose(facing, walkPhase, aimAngle, timeSec);
  const palette = tintPalette(ambientColor);
  const supportContact = supportContactOnWeapon(pose);

  ctx.save();
  ctx.translate(px, py + 0.875 * ppt);
  ctx.scale(ppt, ppt);

  drawLeg(ctx, pose.hip, pose.rightKnee, pose.rightFoot, facing, palette, true);
  drawArm(
    ctx,
    pose.supportShoulder,
    supportContact,
    facing * 0.07,
    palette,
    true,
  );
  drawTorsoArmor(ctx, pose, facing, palette);
  drawLeg(ctx, pose.hip, pose.leftKnee, pose.leftFoot, facing, palette, false);
  drawHead(ctx, pose, facing, palette);
  drawArmsWeapon(ctx, pose, facing, palette);
  drawAccents(ctx, pose, facing, palette);

  ctx.restore();
}
