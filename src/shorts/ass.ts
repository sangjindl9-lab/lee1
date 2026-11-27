/** ASS 자막(타이포그래피) 빌더 — 씬별 텍스트 레이아웃을 영상에 직접 굽습니다. */
import type { ShortScript } from './types.ts';
import type { Theme } from './png.ts';

export interface TimelineItem {
  index: number;
  start: number;
  duration: number;
}

export interface SceneOverlay {
  icon: { size: number; x: number; y: number } | null;
  shot: { height: number; x: number; y: number } | null;
}

const W = 1080;

function assColor(rgb: [number, number, number], alpha = 0): string {
  const hex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  return `&H${hex(alpha)}${hex(rgb[2])}${hex(rgb[1])}${hex(rgb[0])}`;
}

function timecode(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total - Math.floor(total)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.min(99, cs)).padStart(2, '0')}`;
}

function assEscape(text: string): string {
  return text
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .join('\\N');
}

function wrap(text: string, maxChars: number): string {
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if ([...candidate].length > maxChars && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

/** 씬 역할별 아이콘·스크린샷 위치 (ffmpeg overlay 와 ASS 좌표를 맞춥니다) */
export function sceneOverlay(role: string, hasIcon: boolean, hasShot: boolean): SceneOverlay {
  const icon = (size: number, x: number, y: number): SceneOverlay['icon'] => (hasIcon ? { size, x, y } : null);
  switch (role) {
    case 'hook':
      return { icon: icon(196, 812, 176), shot: hasShot ? { height: 600, x: 0, y: 1000 } : null };
    case 'solution':
      return { icon: icon(176, 84, 1560), shot: null };
    case 'proof':
      return { icon: null, shot: hasShot ? { height: 900, x: 0, y: 700 } : null };
    case 'cta':
      return { icon: icon(320, 380, 430), shot: null };
    default:
      return { icon: null, shot: null };
  }
}

export interface AssOptions {
  script: ShortScript;
  theme: Theme;
  timeline: TimelineItem[];
  hasIcon: boolean;
  hasShot: boolean;
  fontFamily: string;
}

export function buildAss(options: AssOptions): { content: string; overlays: SceneOverlay[] } {
  const { script, theme, timeline, hasIcon, hasShot, fontFamily } = options;
  const accent = theme.accents[0];
  const accent2 = theme.accents[1] ?? theme.accents[0];
  const accentAss = assColor(accent);
  const accent2Ass = assColor(accent2);
  const white = '&H00FFFFFF';
  const soft = assColor([217, 222, 235]);
  const dim = assColor([150, 160, 180]);

  const style = (
    name: string,
    size: number,
    color: string,
    bold: boolean,
    outline: number,
    shadow: number,
    alignment: number,
    spacing = 0,
    borderStyle = 1,
  ): string =>
    `Style: ${name},${fontFamily},${size},${color},&H000000FF,&H00101014,&H96000000,${bold ? -1 : 0},0,0,0,100,100,${spacing},0,${borderStyle},${outline},${shadow},${alignment},70,70,60,1`;

  const styles = [
    style('Kicker', 36, accentAss, true, 2, 1, 7, 3),
    style('Headline', 96, white, true, 7, 3, 7, -1),
    style('HeadlineS', 80, white, true, 6, 3, 7, -1),
    style('Cta', 84, white, true, 6, 3, 5, -1),
    style('CtaSub', 38, soft, false, 3, 2, 5, 0),
    style('Sub', 42, soft, false, 3, 2, 7, 0),
    style('Bullet', 46, white, false, 3, 2, 7, 0),
    style('StatValue', 78, accentAss, true, 3, 2, 7, -1),
    style('StatLabel', 30, soft, false, 2, 1, 7, 1),
    style('Brand', 44, white, true, 3, 2, 7, 0),
    style('Badge', 30, white, true, 22, 0, 7, 2, 3),
    style('Small', 28, dim, false, 2, 0, 7, 0),
  ];

  const events: string[] = [];
  const overlays: SceneOverlay[] = [];

  timeline.forEach((slot, i) => {
    const scene = script.scenes[i];
    if (!scene) return;
    const overlay = sceneOverlay(scene.role, hasIcon, hasShot);
    overlays.push(overlay);
    const start = slot.start + 0.28;
    const end = slot.start + slot.duration - 0.18;
    const dur = Math.max(0.8, end - start);
    const fade = `\\fad(260,220)`;
    const push = (styleName: string, text: string, pos: string, extra = ''): void => {
      if (!text.trim()) return;
      events.push(
        `Dialogue: 0,${timecode(start)},${timecode(end)},${styleName},,0,0,0,,{\\an7\\pos(${pos})${fade}${extra}}${assEscape(text)}`,
      );
    };

    switch (scene.role) {
      case 'hook': {
        push('Kicker', scene.kicker.toUpperCase(), `84,236`);
        events.push(
          `Dialogue: 0,${timecode(start)},${timecode(end)},Kicker,,0,0,0,,{\\an7\\pos(84,292)\\p1\\c${accentAss}\\fad(260,220)}m 0 0 l 132 0 l 132 9 l 0 9`,
        );
        const hookText = wrap(scene.headline, 9);
        const hookLines = hookText.split('\n').length;
        push('Headline', hookText, `76,372`, `\\move(76,392,76,372,0,420)`);
        push('Sub', wrap(scene.sub, 20), `84,${372 + hookLines * 108 + 48}`);
        events.push(
          `Dialogue: 0,${timecode(start + 0.2)},${timecode(end)},Badge,,0,0,0,,{\\an7\\pos(84,1668)\\bord26\\3c${accent2Ass}\\4c&H00000000&\\fad(260,220)}15초 요약`,
        );
        push('Small', 'EUM SOFTWORKS · SHORTS', `84,1792`);
        break;
      }
      case 'problem': {
        push('Kicker', 'PROBLEM', `84,236`);
        events.push(
          `Dialogue: 0,${timecode(start)},${timecode(end)},Kicker,,0,0,0,,{\\an7\\pos(84,292)\\p1\\c${assColor([240, 90, 90])}\\fad(260,220)}m 0 0 l 132 0 l 132 9 l 0 9`,
        );
        const problemText = wrap(scene.headline, 11);
        const problemLines = problemText.split('\n').length;
        push('HeadlineS', problemText, `76,420`, `\\move(76,440,76,420,0,420)`);
        push('Sub', wrap(scene.sub, 22), `84,${420 + problemLines * 92 + 52}`);
        events.push(
          `Dialogue: 0,${timecode(start + 0.25)},${timecode(end)},Badge,,0,0,0,,{\\an7\\pos(84,1512)\\bord26\\3c&H00303030&\\fad(260,220)}BEFORE`,
        );
        break;
      }
      case 'solution': {
        push('Kicker', 'SOLUTION', `84,236`);
        events.push(
          `Dialogue: 0,${timecode(start)},${timecode(end)},Kicker,,0,0,0,,{\\an7\\pos(84,292)\\p1\\c${accentAss}\\fad(260,220)}m 0 0 l 132 0 l 132 9 l 0 9`,
        );
        const solutionText = wrap(scene.headline, 11);
        const solutionLines = solutionText.split('\n').length;
        push('HeadlineS', solutionText, `76,400`, `\\move(76,420,76,400,0,420)`);
        let y = 400 + solutionLines * 92 + 70;
        for (const bullet of scene.bullets.slice(0, 3)) {
          events.push(
            `Dialogue: 0,${timecode(start + 0.35)},${timecode(end)},Bullet,,0,0,0,,{\\an7\\pos(84,${y})\\fad(260,220)}${assEscape('✓  ' + wrap(bullet, 17))}`,
          );
          y += 108;
        }
        if (overlay.icon) {
          push('Brand', script.appName, `${overlay.icon.x + overlay.icon.size + 32},${overlay.icon.y + 48}`);
          push('Small', '무료 · 설치 1분', `${overlay.icon.x + overlay.icon.size + 32},${overlay.icon.y + 108}`);
        }
        break;
      }
      case 'proof': {
        push('Kicker', 'WHY EUM', `84,236`);
        events.push(
          `Dialogue: 0,${timecode(start)},${timecode(end)},Kicker,,0,0,0,,{\\an7\\pos(84,292)\\p1\\c${accentAss}\\fad(260,220)}m 0 0 l 132 0 l 132 9 l 0 9`,
        );
        push('HeadlineS', scene.headline, `76,380`);
        const columns = 3;
        const colWidth = W / columns;
        scene.stats.slice(0, 3).forEach((stat, idx) => {
          const cx = colWidth * idx + colWidth / 2;
          events.push(
            `Dialogue: 0,${timecode(start + 0.3 + idx * 0.12)},${timecode(end)},StatValue,,0,0,0,,{\\an5\\pos(${Math.round(cx)},1650)\\fad(240,200)}${assEscape(stat.value)}`,
          );
          events.push(
            `Dialogue: 0,${timecode(start + 0.3 + idx * 0.12)},${timecode(end)},StatLabel,,0,0,0,,{\\an5\\pos(${Math.round(cx)},1722)\\fad(240,200)}${assEscape(stat.label)}`,
          );
        });
        if (!overlay.shot) {
          push('Sub', wrap(scene.sub || script.appName + ' 하나면 충분합니다', 22), `84,760`);
        }
        break;
      }
      case 'cta': {
        const iconBottom = overlay.icon ? overlay.icon.y + overlay.icon.size : 460;
        if (overlay.icon) {
          events.push(
            `Dialogue: 0,${timecode(start)},${timecode(end)},Brand,,0,0,0,,{\\an5\\pos(540,${iconBottom + 54})\\fad(260,220)}${assEscape(script.appName)}`,
          );
        } else {
          events.push(
            `Dialogue: 0,${timecode(start)},${timecode(end)},Brand,,0,0,0,,{\\an5\\pos(540,${iconBottom + 54})\\fad(260,220)}${assEscape(script.appName)}`,
          );
        }
        const ctaText = wrap(scene.headline, 10);
        const ctaLines = ctaText.split('\n').length;
        const ctaTop = iconBottom + 190;
        events.push(
          `Dialogue: 0,${timecode(start + 0.15)},${timecode(end)},Cta,,0,0,0,,{\\an5\\pos(540,${ctaTop})\\fad(260,220)}${assEscape(ctaText)}`,
        );
        const pillY = ctaTop + ctaLines * 100 / 2 + 90;
        events.push(
          `Dialogue: 0,${timecode(start + 0.3)},${timecode(end)},Badge,,0,0,0,,{\\an5\\pos(540,${pillY})\\bord26\\3c${accentAss}\\fad(260,220)}PLAY STORE`,
        );
        events.push(
          `Dialogue: 0,${timecode(start + 0.35)},${timecode(end)},CtaSub,,0,0,0,,{\an5\pos(540,${pillY + 66})\fad(260,220)}${assEscape(wrap(scene.sub, 24))}`,
        );
        push('Small', 'eum softworks · 이음 앱 홍보센터', `84,1800`);        break;
      }
      default:
        break;
    }
    void dur;
  });

  const content = `[Script Info]
; 이음 쇼츠 스튜디오
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
  return { content, overlays };
}
