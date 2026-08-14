import { describe, expect, it } from 'vitest';
import * as playerSprite from './playerSprite';
import {
  calculatePlayerPose,
  PLAYER_DRAW_HEIGHT_TILES,
  type Vec2,
} from './playerPose';

type Operation = {
  name: string;
  args: number[];
  fillStyle?: string;
  strokeStyle?: string;
  path?: Vec2[];
};

class RecordingContext {
  operations: Operation[] = [];
  depth = 0;
  minDepth = 0;
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  globalAlpha = 1;
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  private currentPath: Vec2[] = [];

  private record(name: string, args: number[] = []): Operation {
    const operation = {
      name,
      args,
      fillStyle: typeof this.fillStyle === 'string' ? this.fillStyle : undefined,
      strokeStyle: typeof this.strokeStyle === 'string' ? this.strokeStyle : undefined,
    };
    this.operations.push(operation);
    return operation;
  }

  save(): void {
    this.depth += 1;
    this.record('save');
  }

  restore(): void {
    this.depth -= 1;
    this.minDepth = Math.min(this.minDepth, this.depth);
    this.record('restore');
  }

  translate(x: number, y: number): void { this.record('translate', [x, y]); }
  scale(x: number, y: number): void { this.record('scale', [x, y]); }
  beginPath(): void {
    this.currentPath = [];
    this.record('beginPath');
  }
  closePath(): void { this.record('closePath'); }
  moveTo(x: number, y: number): void {
    this.currentPath.push({ x, y });
    this.record('moveTo', [x, y]);
  }
  lineTo(x: number, y: number): void {
    this.currentPath.push({ x, y });
    this.record('lineTo', [x, y]);
  }
  arc(x: number, y: number, radius: number, start: number, end: number): void {
    this.record('arc', [x, y, radius, start, end]);
  }
  fill(): void {
    this.record('fill').path = this.currentPath.map((point) => ({ ...point }));
  }
  stroke(): void { this.record('stroke'); }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.record('fillRect', [x, y, width, height]);
  }
}

type DrawPlayer = (
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ppt: number,
  facing: 1 | -1,
  walkPhase: number,
  aimAngle: number,
  ambientColor: string,
  timeSec: number,
) => void;

const drawPlayer = playerSprite.drawPlayer as DrawPlayer;

const hexChannels = (color: string): number[] => {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
};

const isBoundedAmbientMix = (
  actual: string,
  base: string,
  ambient: string,
  maximum: number,
): boolean => {
  if (!/^#[0-9a-f]{6}$/i.test(actual)) return false;
  const actualChannels = hexChannels(actual);
  const baseChannels = hexChannels(base);
  const ambientChannels = hexChannels(ambient);
  return actualChannels.every((channel, index) => {
    const baseChannel = baseChannels[index];
    const ambientChannel = ambientChannels[index];
    const low = Math.min(baseChannel, ambientChannel);
    const high = Math.max(baseChannel, ambientChannel);
    const maxDelta = Math.abs(ambientChannel - baseChannel) * maximum + 1;
    return channel >= low && channel <= high && Math.abs(channel - baseChannel) <= maxDelta;
  });
};

const drawnStyles = (context: RecordingContext): string[] =>
  context.operations.flatMap((operation) => {
    if (operation.name === 'fill' || operation.name === 'fillRect') {
      return operation.fillStyle ? [operation.fillStyle] : [];
    }
    if (operation.name === 'stroke') {
      return operation.strokeStyle ? [operation.strokeStyle] : [];
    }
    return [];
  });

const distance = (first: Vec2, second: Vec2): number =>
  Math.hypot(second.x - first.x, second.y - first.y);

const dot = (vector: Vec2, direction: Vec2): number =>
  vector.x * direction.x + vector.y * direction.y;

const distanceToAxis = (point: Vec2, origin: Vec2, direction: Vec2): number =>
  Math.abs(
    (point.x - origin.x) * direction.y -
    (point.y - origin.y) * direction.x,
  );

const segmentsProperlyIntersect = (
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
): boolean => {
  const side = (first: Vec2, second: Vec2, point: Vec2): number =>
    (second.x - first.x) * (point.y - first.y) -
    (second.y - first.y) * (point.x - first.x);
  return side(a, b, c) * side(a, b, d) < 0 &&
    side(c, d, a) * side(c, d, b) < 0;
};

describe('player sprite', () => {
  it('publishes the mechanical player palette', () => {
    expect(
      (playerSprite as unknown as { PLAYER_COLORS: unknown }).PLAYER_COLORS,
    ).toEqual({
      face: '#d9dddc',
      uniform: '#151820',
      uniformLight: '#303640',
      joint: '#6f7479',
      chest: '#7f1f28',
      chestLight: '#a9363e',
      visor: '#171015',
      indicator: '#e64747',
      weapon: '#353a40',
    });
  });

  it('anchors pose-space feet to the bottom of the unchanged physics body', () => {
    const context = new RecordingContext();

    drawPlayer(
      context as unknown as CanvasRenderingContext2D,
      20,
      30,
      16,
      1,
      0.5,
      0,
      '#203040',
      1.25,
    );

    expect(context.operations).toContainEqual(
      expect.objectContaining({ name: 'translate', args: [20, 44] }),
    );
  });

  it('draws each identity component with only bounded ambient tinting', () => {
    const context = new RecordingContext();
    const ambient = '#000000';

    drawPlayer(
      context as unknown as CanvasRenderingContext2D,
      0,
      0,
      24,
      1,
      0.7,
      -Math.PI / 4,
      ambient,
      0.8,
    );

    const styles = drawnStyles(context);
    for (const [name, base, maximum] of [
      ['face', playerSprite.PLAYER_COLORS.face, 0.12],
      ['chest', playerSprite.PLAYER_COLORS.chest, 0.12],
      ['visor', playerSprite.PLAYER_COLORS.visor, 0.12],
      ['indicator', playerSprite.PLAYER_COLORS.indicator, 0.12],
      ['joint', playerSprite.PLAYER_COLORS.joint, 0.3],
      ['weapon', playerSprite.PLAYER_COLORS.weapon, 0.3],
    ] as const) {
      expect(
        styles.some((actual) => isBoundedAmbientMix(actual, base, ambient, maximum)),
        `${name} component was not drawn`,
      ).toBe(true);
    }
  });

  it('balances canvas state and exercises filled and stroked component paths', () => {
    const context = new RecordingContext();

    drawPlayer(
      context as unknown as CanvasRenderingContext2D,
      12,
      18,
      20,
      -1,
      Math.PI / 2,
      Math.PI * 0.75,
      '#506070',
      2,
    );

    expect(context.depth).toBe(0);
    expect(context.minDepth).toBe(0);
    expect(context.operations.some(({ name }) => name === 'fill')).toBe(true);
    expect(context.operations.some(({ name }) => name === 'stroke')).toBe(true);
  });

  it('keeps the two-handed weapon aligned in every facing and aim quadrant', () => {
    const ambient = '#000000';
    for (const facing of [1, -1] as const) {
      for (const angle of [
        -Math.PI * 0.75,
        -Math.PI * 0.25,
        Math.PI * 0.25,
        Math.PI * 0.75,
      ]) {
        const context = new RecordingContext();
        expect(() => {
          drawPlayer(
            context as unknown as CanvasRenderingContext2D,
            100,
            80,
            18,
            facing,
            1.2,
            angle,
            ambient,
            3.5,
          );
        }).not.toThrow();
        for (const operation of context.operations) {
          expect(operation.args.every(Number.isFinite)).toBe(true);
        }

        const pose = calculatePlayerPose(facing, 1.2, angle, 3.5);
        const aim = { x: Math.cos(angle), y: Math.sin(angle) };
        const weaponPaths = context.operations
          .filter(({ name, fillStyle, path }) =>
            name === 'fill' &&
            path &&
            fillStyle &&
            isBoundedAmbientMix(
              fillStyle,
              playerSprite.PLAYER_COLORS.weapon,
              ambient,
              0.3,
            ),
          )
          .map(({ path }) => path!);
        const barrel = weaponPaths.find((path) => path.length === 5);
        expect(barrel, 'weapon barrel polygon was not drawn').toBeDefined();

        const muzzleTip = barrel!.reduce((furthest, point) =>
          dot(
            { x: point.x - pose.weaponHand.x, y: point.y - pose.weaponHand.y },
            aim,
          ) > dot(
            { x: furthest.x - pose.weaponHand.x, y: furthest.y - pose.weaponHand.y },
            aim,
          ) ? point : furthest,
        );
        const muzzleVector = {
          x: muzzleTip.x - pose.weaponHand.x,
          y: muzzleTip.y - pose.weaponHand.y,
        };
        expect(dot(muzzleVector, aim) / Math.hypot(muzzleVector.x, muzzleVector.y))
          .toBeCloseTo(1, 6);

        const jointArcs = context.operations.filter(({ name, fillStyle, args }) =>
          name === 'arc' &&
          Math.abs(args[2] - 0.046) < 1e-9 &&
          fillStyle !== undefined &&
          isBoundedAmbientMix(
            fillStyle,
            playerSprite.PLAYER_COLORS.joint,
            ambient,
            0.3,
          ),
        );
        const supportJoint = jointArcs.reduce((closest, operation) => {
          const point = { x: operation.args[0], y: operation.args[1] };
          const closestPoint = { x: closest.args[0], y: closest.args[1] };
          return distance(point, pose.supportHand) < distance(closestPoint, pose.supportHand)
            ? operation
            : closest;
        });
        const supportCenter = {
          x: supportJoint.args[0],
          y: supportJoint.args[1],
        };
        expect(distanceToAxis(supportCenter, pose.weaponHand, aim)).toBeCloseTo(0, 6);

        const supportProjection = dot({
          x: supportCenter.x - pose.weaponHand.x,
          y: supportCenter.y - pose.weaponHand.y,
        }, aim);
        const barrelProjections = barrel!.map((point) => dot({
          x: point.x - pose.weaponHand.x,
          y: point.y - pose.weaponHand.y,
        }, aim));
        expect(supportProjection).toBeGreaterThanOrEqual(Math.min(...barrelProjections));
        expect(supportProjection).toBeLessThanOrEqual(Math.max(...barrelProjections));
      }
    }
  });

  it('draws left-facing feet as simple hard-edged polygons', () => {
    const context = new RecordingContext();
    const ambient = '#000000';

    drawPlayer(
      context as unknown as CanvasRenderingContext2D,
      0,
      0,
      16,
      -1,
      Math.PI / 2,
      0,
      ambient,
      0,
    );

    const footPolygons = context.operations
      .filter(({ name, fillStyle, path }) =>
        name === 'fill' &&
        path?.length === 4 &&
        Math.min(...path.map(({ y }) => y)) > -0.3 &&
        fillStyle !== undefined &&
        isBoundedAmbientMix(
          fillStyle,
          playerSprite.PLAYER_COLORS.uniformLight,
          ambient,
          0.3,
        ),
      )
      .map(({ path }) => path!);

    expect(footPolygons).toHaveLength(2);
    for (const [first, second, third, fourth] of footPolygons) {
      expect(segmentsProperlyIntersect(first, second, third, fourth)).toBe(false);
      expect(segmentsProperlyIntersect(second, third, fourth, first)).toBe(false);
    }
  });

  it('keeps the hard silhouette grounded inside its configured height across gait and bob', () => {
    const phases = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    const times = [0, Math.PI / (2 * 2.2), (3 * Math.PI) / (2 * 2.2)];

    for (const facing of [1, -1] as const) {
      for (const phase of phases) {
        for (const timeSec of times) {
          const context = new RecordingContext();
          drawPlayer(
            context as unknown as CanvasRenderingContext2D,
            0,
            0,
            16,
            facing,
            phase,
            0,
            '#000000',
            timeSec,
          );

          const pathY = context.operations
            .filter(({ name }) => name === 'moveTo' || name === 'lineTo')
            .map(({ args }) => args[1]);
          expect(Math.min(...pathY)).toBeGreaterThanOrEqual(-PLAYER_DRAW_HEIGHT_TILES);
          expect(Math.max(...pathY)).toBeLessThanOrEqual(0);
        }
      }
    }
  });
});
