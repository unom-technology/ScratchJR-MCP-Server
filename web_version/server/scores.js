import express from 'express';
import { BadRequest } from './store.js';
import { parseId } from './tables.js';
import { NOT_DELETED } from './access.js';

// Scores: a teacher or admin gives one of their students' projects a score
// out of a total they choose, such as 45 out of 50, and a comment. The
// student sees it on their My Projects. Who may score whom is the same as who
// may see whom (access.js).

export const MAX_OUT_OF = 1000;
export const MAX_COMMENT = 1000;

export const SCORE_FIELDS = {
  projectId: true, points: true, outOf: true, comment: true, projectMtime: true, updatedAt: true,
  scoredBy: {select: {id: true, username: true, fullName: true}},
};

// What a page is told about a score, or null for none. Given the project's
// MTIME now, it also says whether the project changed after it was scored;
// students are not told that.
export function publicScore(score, projectMtime) {
  if (!score) return null;
  const result = {
    points: score.points,
    outOf: score.outOf,
    comment: score.comment || '',
    scoredBy: score.scoredBy ? {id: score.scoredBy.id, name: score.scoredBy.fullName || score.scoredBy.username} : null,
    scoredAt: score.updatedAt.toISOString(),
  };
  if (projectMtime !== undefined) result.changedSince = (score.projectMtime ?? null) !== (projectMtime ?? null);
  return result;
}

const wholeNumber = value => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(n) ? n : null;
};

// Checks a score as the admin page sends it: {points, outOf, comment}.
export function scoreData(body) {
  const outOf = wholeNumber(body?.outOf);
  if (outOf === null || outOf < 1 || outOf > MAX_OUT_OF) throw new BadRequest(`The total must be a whole number from 1 to ${MAX_OUT_OF}.`);
  const points = wholeNumber(body?.points);
  if (points === null || points < 0 || points > outOf) throw new BadRequest(`The score must be a whole number from 0 to ${outOf}.`);
  const raw = body?.comment ?? '';
  if (typeof raw !== 'string') throw new BadRequest('The comment must be text.');
  const comment = raw.replace(/\r\n?/g, '\n').trim();
  if (comment.length > MAX_COMMENT) throw new BadRequest(`Keep the comment to ${MAX_COMMENT} characters or fewer.`);
  return {points, outOf, comment: comment || null};
}

// A student's scores on the projects they still have, by project ID.
export async function scoresOf(prisma, userId) {
  const rows = await prisma.score.findMany({
    where: {userId, project: {is: NOT_DELETED}},
    orderBy: {projectId: 'asc'},
    select: SCORE_FIELDS,
  });
  return rows.map(row => ({projectId: row.projectId, ...publicScore(row)}));
}

// The admin API's scoring part. student is admin.js's check that :studentId
// is a student this person may see.
export function createScoreRouter({prisma, student}) {
  const router = express.Router();

  async function project(req, res, next) {
    const localId = parseId(req.params.projectId);
    req.project = localId && await prisma.project.findFirst({
      where: {userId: req.student.id, localId, ...NOT_DELETED},
      select: {localId: true, mtime: true},
    });
    if (!req.project) return res.status(404).json({error: 'There is no such project.'});
    next();
  }

  // Scoring again replaces the score, and the newest scorer's name goes on it.
  router.put('/students/:studentId/projects/:projectId/score', student, project, async (req, res) => {
    const values = {...scoreData(req.body), projectMtime: req.project.mtime, scoredById: req.user.id};
    const key = {userId: req.student.id, projectId: req.project.localId};
    const score = await prisma.score.upsert({
      where: {userId_projectId: key},
      create: {...key, ...values},
      update: values,
      select: SCORE_FIELDS,
    });
    res.json({score: publicScore(score, req.project.mtime)});
  });

  router.delete('/students/:studentId/projects/:projectId/score', student, project, async (req, res) => {
    await prisma.score.deleteMany({where: {userId: req.student.id, projectId: req.project.localId}});
    res.json({score: null});
  });

  // For the student's My Projects, opened by a teacher to look at.
  router.get('/students/:studentId/scores', student, async (req, res) => {
    res.json({scores: await scoresOf(prisma, req.student.id)});
  });

  return router;
}
