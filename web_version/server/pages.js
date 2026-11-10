import { fileNameProblem } from './tables.js';

// What each page of a project looks like when it opens in ScratchJr, for the
// admin page to draw without starting ScratchJr: the background, and from the
// bottom up the characters and text where they stand, with how many blocks
// each character's scripts have.
//
// It is read from ScratchJr's PROJECTS.JSON:
//   {pages: ['page 1', ...], 'page 1': {md5, sprites, layers, 'Cat 1': {...}}, ...}
// Anything not recognised is left out rather than refused, since all this does
// is draw a picture.

// ScratchJr makes 4 at most.
const MAX_PAGES = 10;

const number = (value, fallback = 0) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const fileName = value => (typeof value === 'string' && !fileNameProblem(value) ? value : null);
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

// The blocks in one script, counting those inside a repeat
// ([type, argument, x, y, [blocks inside]]).
function countBlocks(strip) {
  if (!Array.isArray(strip)) return 0;
  let count = 0;
  for (const block of strip) {
    if (Array.isArray(block) && typeof block[0] === 'string') count += 1 + countBlocks(block[4]);
  }
  return count;
}

// One character or text, from Sprite.getSpriteData or getTextBoxData.
// x and y are its centre on ScratchJr's 480 by 360 stage; cx and cy are half
// its width and height, as ScratchJr measured them.
function describeItem(id, data) {
  if (!data || typeof data !== 'object') return null;
  const place = {id, shown: data.shown !== false, x: number(data.xcoor), y: number(data.ycoor), cx: number(data.cx), cy: number(data.cy)};
  if (data.type === 'text') {
    return {...place, type: 'text', text: text(data.str, 200), color: text(data.color, 40) || '#000000', size: Math.min(200, Math.max(4, number(data.fontsize, 36)))};
  }
  if (data.type !== 'sprite') return null;
  const scripts = Array.isArray(data.scripts) ? data.scripts : [];
  return {
    ...place,
    type: 'sprite',
    name: text(data.name, 80),
    image: fileName(data.md5),
    w: number(data.w),
    h: number(data.h),
    scale: number(data.scale, 1),
    angle: number(data.angle),
    flip: data.flip === true,
    blocks: scripts.reduce((count, strip) => count + countBlocks(strip), 0),
  };
}

// The pages of a project, or null when its JSON can't be read.
export function describePages(json) {
  let project;
  try { project = JSON.parse(json); } catch { return null; }
  if (!project || typeof project !== 'object' || !Array.isArray(project.pages)) return null;

  return project.pages.slice(0, MAX_PAGES).map((pageId, index) => {
    const page = typeof pageId === 'string' && Object.hasOwn(project, pageId) && project[pageId] && typeof project[pageId] === 'object' ? project[pageId] : {};
    // layers is the order ScratchJr draws them in, bottom first; sprites is the
    // order they were added, which also has any a layer list missed.
    const ids = [...(Array.isArray(page.layers) ? page.layers : []), ...(Array.isArray(page.sprites) ? page.sprites : [])];
    const items = [...new Set(ids.filter(id => typeof id === 'string' && Object.hasOwn(page, id)))]
      .map(id => describeItem(id, page[id]))
      .filter(Boolean);
    const characters = items.filter(item => item.type === 'sprite');
    return {
      number: index + 1,
      background: fileName(page.md5),
      items,
      characters: characters.length,
      blocks: characters.reduce((count, character) => count + character.blocks, 0),
    };
  });
}

// Every picture the pages use, by file name.
export function pictureNames(pages) {
  const names = new Set();
  for (const page of pages) {
    if (page.background) names.add(page.background);
    for (const item of page.items) if (item.image) names.add(item.image);
  }
  return [...names];
}
