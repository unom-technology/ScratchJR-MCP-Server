// For the teacher: give a student a new password.
//   npm run reset-password -- <username> <new password>
// Logs the student out everywhere; their projects are not touched.

import '../server/config.js';
import { hashPassword, normalizeUsername, passwordProblem } from '../server/auth.js';

const [rawName, password] = process.argv.slice(2);
const username = normalizeUsername(rawName);
if (!username || !password) {
  console.error('Usage: npm run reset-password -- <username> <new password>');
  process.exit(1);
}
const problem = passwordProblem(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({where: {username}});
  if (!user) {
    const names = (await prisma.user.findMany({select: {username: true}, orderBy: {username: 'asc'}})).map(u => u.username);
    console.error(`There is no student called "${username}".` + (names.length ? ` Students: ${names.join(', ')}` : ''));
    process.exitCode = 1;
  } else {
    await prisma.$transaction([
      prisma.user.update({where: {id: user.id}, data: {passwordHash: await hashPassword(password)}}),
      prisma.session.deleteMany({where: {userId: user.id}}),
    ]);
    console.log(`New password set for ${username}.`);
  }
} finally {
  await prisma.$disconnect();
}
