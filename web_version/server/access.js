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

// How many projects each account has, and when one last changed, by user ID.
// One small query over every account: a school's worth of rows is cheap, and
// it needs no list of IDs, which SQLite limits the length of.
export async function projectTotals(prisma) {
  const totals = await prisma.project.groupBy({
    by: ['userId'], where: NOT_DELETED, _count: {_all: true}, _max: {updatedAt: true},
  });
  return new Map(totals.map(t => [t.userId, {projectCount: t._count._all, lastChangeAt: t._max.updatedAt}]));
}

export function withTotals(accounts, totals) {
  return accounts.map(a => ({...a, ...(totals.get(a.id) || {projectCount: 0, lastChangeAt: null})}));
}
