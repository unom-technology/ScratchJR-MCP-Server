import express from 'express';
import { fileNameProblem, parseId } from './tables.js';
import { NOT_DELETED, SECTION_FIELDS, SECTION_ORDER, STUDENT_FIELDS, projectTotals, visibleSections, visibleStudents, withTotals } from './access.js';
import { describePages, pictureNames } from './pages.js';
import { SCORE_FIELDS, createScoreRouter, publicScore } from './scores.js';
import { createManageRouter } from './manage.js';

// The admin page's API, for teachers and admins; app.js lets nobody else in.
// This file reads: the students someone may see (access.js), their projects
// and each project's pages, and what the ScratchJr app needs to open one to
// look at. Scoring is in scores.js, for teachers and admins. Making and
// changing accounts and sections is in manage.js, for admins only.

// A project's THUMBNAIL column is JSON: {"pagecount": 3, "md5": "13_244e....png"}.
function thumbnailInfo(value) {
  try {
    const info = JSON.parse(value);
    return {
      name: typeof info.md5 === 'string' && !fileNameProblem(info.md5) ? info.md5 : null,
      pages: Number.isInteger(info.pagecount) ? info.pagecount : null,
    };
  } catch {
    return {name: null, pages: null};
  }
}

// MTIME is ScratchJr's own "last changed", in milliseconds; updatedAt is when
// the server last received the row, for a project that has none.
function changedAt(project) {
  const ms = Number(project.mtime);
  return (Number.isFinite(ms) && ms > 0 ? new Date(ms) : project.updatedAt).toISOString();
}

const PROJECT_FIELDS = {localId: true, name: true, mtime: true, thumbnail: true, isgift: true, updatedAt: true, score: {select: SCORE_FIELDS}};

function projectSummary(row) {
  const thumbnail = thumbnailInfo(row.thumbnail);
  return {
    id: row.localId, name: row.name || '', changedAt: changedAt(row), thumbnail: thumbnail.name, pages: thumbnail.pages,
    isGift: row.isgift === 1, score: publicScore(row.score, row.mtime),
  };
}

// What a picture is served as. A student's file could be anything under any
// name, so only these, and never as a page that runs script.
const PICTURE_TYPES = {png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg'};
const PICTURE_POLICY = 'default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; sandbox';

function sendPicture(res, contents, type) {
  // Files are kept as ScratchJr hands them over: base64, a data URL, or now and
  // then plain SVG text.
  const body = contents.startsWith('<') ? Buffer.from(contents, 'utf8')
    : Buffer.from(contents.startsWith('data:') ? contents.slice(contents.indexOf(',') + 1) : contents, 'base64');
  res.set('Content-Security-Policy', PICTURE_POLICY);
  res.type(type).send(body);
}

export function createAdminRouter({prisma, store}) {
  const router = express.Router();

  // Finds the student in :studentId among those this person may see, or answers 404.
  async function student(req, res, next) {
    const id = parseId(req.params.studentId);
    req.student = id && await prisma.user.findFirst({where: {id, ...visibleStudents(req.user)}, select: STUDENT_FIELDS});
    if (!req.student) return res.status(404).json({error: 'There is no such student in your sections.'});
    next();
  }

  // Where the admin page finds each picture the pages use: the student's own
  // drawings and photos here, and ScratchJr's characters and backgrounds in the app.
  async function pictureUrls(studentId, pages) {
    const names = pictureNames(pages);
    const own = new Set((await prisma.mediaFile.findMany({where: {userId: studentId, name: {in: names}}, select: {name: true}})).map(f => f.name));
    const url = name => {
      if (!name) return null;
      return own.has(name) ? `/api/admin/students/${studentId}/images/${encodeURIComponent(name)}` : `/app/svglibrary/${encodeURIComponent(name)}`;
    };
    return pages.map(page => ({
      ...page,
      background: url(page.background),
      items: page.items.map(item => (item.type === 'sprite' ? {...item, image: url(item.image)} : item)),
    }));
  }

  // Sections to filter by: a teacher's own, or every section for an admin.
  router.get('/sections', async (req, res) => {
    const sections = await prisma.section.findMany({
      where: visibleSections(req.user),
      orderBy: SECTION_ORDER,
      select: {
        ...SECTION_FIELDS,
        _count: {select: {students: true}},
        teachers: {select: {id: true, username: true, fullName: true}, orderBy: {username: 'asc'}},
      },
    });
    res.json({sections: sections.map(({_count, ...s}) => ({...s, studentCount: _count.students}))});
  });

  router.get('/students', async (req, res) => {
    const students = await prisma.user.findMany({where: visibleStudents(req.user), orderBy: {username: 'asc'}, select: STUDENT_FIELDS});
    res.json({students: withTotals(students, await projectTotals(prisma))});
  });

  router.get('/students/:studentId', student, async (req, res) => {
    const rows = await prisma.project.findMany({where: {userId: req.student.id, ...NOT_DELETED}, select: PROJECT_FIELDS});
    const projects = rows.map(projectSummary);
    projects.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
    res.json({student: req.student, projects});
  });

  // One project, with each of its pages to draw. pages is null when the
  // project can't be read that way; it still opens in ScratchJr.
  router.get('/students/:studentId/projects/:projectId', student, async (req, res) => {
    const localId = parseId(req.params.projectId);
    const row = localId && await prisma.project.findFirst({
      where: {userId: req.student.id, localId, ...NOT_DELETED},
      select: {...PROJECT_FIELDS, json: true},
    });
    if (!row) return res.status(404).json({error: 'There is no such project.'});
    const pages = describePages(row.json);
    res.json({student: req.student, project: projectSummary(row), pages: pages && await pictureUrls(req.student.id, pages)});
  });

  // What the ScratchJr app builds its tables from, as /api/state is for a student.
  router.get('/students/:studentId/state', student, async (req, res) => {
    const {id, username, fullName} = req.student;
    res.json({student: {id, username, fullName}, ...await store.snapshot(id)});
  });

  router.get('/students/:studentId/files/:name', student, async (req, res) => {
    const contents = await store.file(req.student.id, req.params.name);
    if (contents === null) return res.status(404).json({error: 'No such file.'});
    res.type('text/plain').send(contents);
  });

  // A project's picture for its card. PNG only, which is what ScratchJr makes
  // thumbnails as.
  router.get('/students/:studentId/thumbnails/:name', student, async (req, res) => {
    const contents = /\.png$/.test(req.params.name) ? await store.file(req.student.id, req.params.name) : null;
    if (contents === null) return res.status(404).json({error: 'No such picture.'});
    sendPicture(res, contents, PICTURE_TYPES.png);
  });

  // A character or background the student drew, for drawing their pages.
  router.get('/students/:studentId/images/:name', student, async (req, res) => {
    const type = PICTURE_TYPES[(/\.([a-z]+)$/.exec(req.params.name) || [])[1]];
    const contents = type ? await store.file(req.student.id, req.params.name) : null;
    if (contents === null) return res.status(404).json({error: 'No such picture.'});
    sendPicture(res, contents, type);
  });

  router.use(createScoreRouter({prisma, student}));
  router.use(createManageRouter({prisma}));

  return router;
}
