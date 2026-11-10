import express from 'express';
import {
  ROLES, cleanText, fullNameProblem, gradeProblem, hashPassword, normalizeUsername, passwordProblem,
  sectionNameProblem, toGrade, usernameProblem,
} from './auth.js';
import { BadRequest } from './store.js';
import { parseId } from './tables.js';
import { SECTION_FIELDS, SECTION_ORDER, projectTotals, withTotals } from './access.js';

// Admins only: making, changing and deleting accounts of every role, and the
// sections students are in and teachers teach.

const ACCOUNT_FIELDS = {
  id: true, username: true, fullName: true, role: true, grade: true, createdAt: true, lastLoginAt: true,
  section: {select: SECTION_FIELDS},
  teaching: {select: SECTION_FIELDS, orderBy: SECTION_ORDER},
};

const sectionLabel = section => `Grade ${section.grade} ${section.name}`;

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({error: 'Only admins can do this.'});
  next();
}

// Prisma's "already taken" for a unique field.
const isTaken = error => error?.code === 'P2002';

export function createManageRouter({prisma}) {
  const router = express.Router();

  async function findAccount(value) {
    const id = parseId(value);
    return id && prisma.user.findUnique({where: {id}, select: ACCOUNT_FIELDS});
  }

  // Checks an account as the admin page sends it, and turns it into Prisma
  // data. existing is the account being changed, or null for a new one: then
  // every field is needed, and otherwise only those sent change. Whatever the
  // role ends up as decides the rest, so a student keeps no teaching sections
  // and a teacher no grade or section.
  async function accountData(body, existing) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest('Nothing to save.');
    const sent = key => Object.prototype.hasOwnProperty.call(body, key);
    const data = {};

    if (!existing || sent('username')) {
      data.username = normalizeUsername(body.username);
      const problem = usernameProblem(data.username);
      if (problem) throw new BadRequest(problem);
    }
    if (!existing || sent('fullName')) {
      data.fullName = cleanText(body.fullName);
      const problem = fullNameProblem(data.fullName);
      if (problem) throw new BadRequest(problem);
    }
    // Left empty when editing, the password stays as it is.
    if (!existing || (sent('password') && body.password !== '' && body.password !== null)) {
      const problem = passwordProblem(body.password);
      if (problem) throw new BadRequest(problem);
      data.passwordHash = await hashPassword(body.password);
    }

    const role = !existing || sent('role') ? body.role : existing.role;
    if (!ROLES.includes(role)) throw new BadRequest('Pick a role: student, teacher or admin.');
    data.role = role;

    let sectionId = null;
    let teachingIds = [];
    if (role === 'student') {
      const grade = sent('grade') ? (body.grade === null || body.grade === '' ? null : toGrade(body.grade)) : existing?.grade ?? null;
      // An account from before grades were asked for may stay without one.
      if (grade !== null || !existing) {
        const problem = gradeProblem(grade);
        if (problem) throw new BadRequest(problem);
      }
      data.grade = grade;
      const wantsSection = sent('sectionId') ? body.sectionId !== null && body.sectionId !== '' : Boolean(existing?.section);
      if (wantsSection) {
        sectionId = sent('sectionId') ? parseId(body.sectionId) : existing.section.id;
        const section = sectionId && await prisma.section.findUnique({where: {id: sectionId}});
        if (!section) throw new BadRequest('That section does not exist any more. Reload the page.');
        if (grade === null) throw new BadRequest('Pick the student\'s grade before their section.');
        if (section.grade !== grade) throw new BadRequest(`${sectionLabel(section)} is a Grade ${section.grade} section, and this student is in Grade ${grade}.`);
      }
    } else {
      data.grade = null;
      if (role === 'teacher') {
        const ids = sent('teachingIds') ? body.teachingIds : (existing?.teaching || []).map(s => s.id);
        if (!Array.isArray(ids)) throw new BadRequest('teachingIds must be a list.');
        teachingIds = [...new Set(ids.map(parseId))];
        if (teachingIds.includes(null)) throw new BadRequest('That is not a section.');
        if (await prisma.section.count({where: {id: {in: teachingIds}}}) !== teachingIds.length) {
          throw new BadRequest('One of those sections does not exist any more. Reload the page.');
        }
      }
    }

    const sections = teachingIds.map(id => ({id}));
    if (existing) {
      data.section = sectionId ? {connect: {id: sectionId}} : {disconnect: true};
      data.teaching = {set: sections};
    } else {
      if (sectionId) data.section = {connect: {id: sectionId}};
      if (sections.length) data.teaching = {connect: sections};
    }
    return data;
  }

  // ---------------------------------------------------------------- accounts

  router.get('/accounts', adminOnly, async (req, res) => {
    const accounts = await prisma.user.findMany({orderBy: {username: 'asc'}, select: ACCOUNT_FIELDS});
    res.json({accounts: withTotals(accounts, await projectTotals(prisma))});
  });

  router.post('/accounts', adminOnly, async (req, res) => {
    const data = await accountData(req.body, null);
    try {
      const account = await prisma.user.create({data, select: ACCOUNT_FIELDS});
      res.status(201).json({account});
    } catch (error) {
      if (isTaken(error)) throw new BadRequest('That username is taken. Pick another one.', 409);
      throw error;
    }
  });

  router.patch('/accounts/:accountId', adminOnly, async (req, res) => {
    const existing = await findAccount(req.params.accountId);
    if (!existing) return res.status(404).json({error: 'There is no such account.'});
    const data = await accountData(req.body, existing);
    // So there is always an admin: nobody can take their own admin role away.
    if (existing.id === req.user.id && data.role !== existing.role) {
      throw new BadRequest('You can\'t change your own role. Another admin can.');
    }
    let account;
    try {
      account = await prisma.user.update({where: {id: existing.id}, data, select: ACCOUNT_FIELDS});
    } catch (error) {
      if (isTaken(error)) throw new BadRequest('That username is taken. Pick another one.', 409);
      throw error;
    }
    // A new password logs the account out everywhere, except the admin's own
    // browser when it is their own password.
    if (data.passwordHash) await prisma.session.deleteMany({where: {userId: existing.id, id: {not: req.sessionId}}});
    res.json({account});
  });

  router.delete('/accounts/:accountId', adminOnly, async (req, res) => {
    const existing = await findAccount(req.params.accountId);
    if (!existing) return res.status(404).json({error: 'There is no such account.'});
    if (existing.id === req.user.id) throw new BadRequest('You can\'t delete your own account. Another admin can.');
    // Their projects, characters, files and logins go with it (onDelete: Cascade).
    await prisma.user.delete({where: {id: existing.id}});
    res.json({deleted: existing.id});
  });

  // ---------------------------------------------------------------- sections

  router.post('/sections', adminOnly, async (req, res) => {
    const grade = toGrade(req.body?.grade);
    const name = cleanText(req.body?.name);
    const problem = gradeProblem(grade) || sectionNameProblem(name);
    if (problem) throw new BadRequest(problem);
    try {
      const section = await prisma.section.create({data: {grade, name}, select: SECTION_FIELDS});
      res.status(201).json({section});
    } catch (error) {
      if (isTaken(error)) throw new BadRequest(`Grade ${grade} already has a section called ${name}.`, 409);
      throw error;
    }
  });

  // Renaming only: moving a section to another grade would leave its
  // students in a grade they are not in.
  router.patch('/sections/:sectionId', adminOnly, async (req, res) => {
    const id = parseId(req.params.sectionId);
    const existing = id && await prisma.section.findUnique({where: {id}});
    if (!existing) return res.status(404).json({error: 'There is no such section.'});
    const name = cleanText(req.body?.name);
    const problem = sectionNameProblem(name);
    if (problem) throw new BadRequest(problem);
    try {
      const section = await prisma.section.update({where: {id}, data: {name}, select: SECTION_FIELDS});
      res.json({section});
    } catch (error) {
      if (isTaken(error)) throw new BadRequest(`Grade ${existing.grade} already has a section called ${name}.`, 409);
      throw error;
    }
  });

  // Its students are left with no section (onDelete: SetNull), for an admin
  // to place again, and its teachers stop seeing them.
  router.delete('/sections/:sectionId', adminOnly, async (req, res) => {
    const id = parseId(req.params.sectionId);
    const existing = id && await prisma.section.findUnique({where: {id}});
    if (!existing) return res.status(404).json({error: 'There is no such section.'});
    await prisma.section.delete({where: {id}});
    res.json({deleted: id});
  });

  return router;
}
