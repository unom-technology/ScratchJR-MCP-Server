// Who may see whom. An admin sees every student; a teacher sees only the
// students in the sections they teach, so a teacher of Grade 4 Trust and
// Grade 3 Faithfulness sees those two classes and nobody else. A student with
// no section yet is seen by admins only.

export function visibleStudents(user) {
  if (user.role === 'admin') return {role: 'student'};
  return {role: 'student', section: {is: {teachers: {some: {id: user.id}}}}};
}

export function visibleSections(user) {
  return user.role === 'admin' ? {} : {teachers: {some: {id: user.id}}};
}

// ScratchJr marks a deleted project rather than removing its row.
export const NOT_DELETED = {OR: [{deleted: null}, {deleted: {not: 'YES'}}]};

export const SECTION_FIELDS = {id: true, grade: true, name: true};
export const SECTION_ORDER = [{grade: 'asc'}, {name: 'asc'}];

// What lists show about a student.
export const STUDENT_FIELDS = {
  id: true, username: true, fullName: true, grade: true, createdAt: true, lastLoginAt: true,
  section: {select: SECTION_FIELDS},
};

// How many projects each account has, how many of those are scored, and when
// one last changed, by user ID. Small queries over every account: a school's
// worth of rows is cheap, and they need no list of IDs, which SQLite limits
// the length of.
export async function projectTotals(prisma) {
  const [projects, scores] = await Promise.all([
    prisma.project.groupBy({by: ['userId'], where: NOT_DELETED, _count: {_all: true}, _max: {updatedAt: true}}),
    prisma.score.groupBy({by: ['userId'], where: {project: {is: NOT_DELETED}}, _count: {_all: true}}),
  ]);
  const scored = new Map(scores.map(s => [s.userId, s._count._all]));
  return new Map(projects.map(t => [t.userId, {projectCount: t._count._all, scoredCount: scored.get(t.userId) || 0, lastChangeAt: t._max.updatedAt}]));
}

export function withTotals(accounts, totals) {
  return accounts.map(a => ({...a, ...(totals.get(a.id) || {projectCount: 0, scoredCount: 0, lastChangeAt: null})}));
}
