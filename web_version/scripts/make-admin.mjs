// For the server PC: the first admin account, or a way back in if no admin
// can log in. After that, admins make teachers and other admins on the admin page.
//   npm run make-admin -- <username> <password>   create it, or make an existing account an admin with this password
//   npm run make-admin -- <username>              make an existing account an admin, keeping its password
//   npm run make-admin -- <username> --remove     make it a student again
//   npm run make-admin                            list the admin accounts

import '../server/config.js';
import { hashPassword, normalizeUsername, passwordProblem, usernameProblem } from '../server/auth.js';

const args = process.argv.slice(2);
const remove = args.includes('--remove');
const [rawName, password] = args.filter(a => a !== '--remove');
const username = normalizeUsername(rawName);

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

// An admin has no grade, section or sections to teach.
const ADMIN = {role: 'admin', grade: null, section: {disconnect: true}, teaching: {set: []}};

try {
  if (!username) {
    const admins = (await prisma.user.findMany({where: {role: 'admin'}, select: {username: true}, orderBy: {username: 'asc'}})).map(u => u.username);
    console.log('Usage: npm run make-admin -- <username> [password]');
    console.log('       npm run make-admin -- <username> --remove');
    console.log(admins.length ? `Admin accounts: ${admins.join(', ')}` : 'There are no admin accounts yet.');
  } else if (password !== undefined && passwordProblem(password)) {
    fail(passwordProblem(password));
  } else {
    const user = await prisma.user.findUnique({where: {username}});
    if (remove) {
      if (!user) fail(`There is no account called "${username}".`);
      else {
        await prisma.user.update({where: {id: user.id}, data: {role: 'student', teaching: {set: []}}});
        console.log(`${username} is a student account again.`);
      }
    } else if (!user) {
      if (usernameProblem(username)) fail(usernameProblem(username));
      else if (password === undefined) fail(`There is no account called "${username}". To create it, add a password: npm run make-admin -- ${username} <password>`);
      else {
        await prisma.user.create({data: {username, role: 'admin', passwordHash: await hashPassword(password)}});
        console.log(`Created the admin account ${username}. Log in with it to open the admin page, and add your full name there.`);
      }
    } else if (password === undefined) {
      await prisma.user.update({where: {id: user.id}, data: ADMIN});
      console.log(`${username} is now an admin.`);
    } else {
      // A new password also logs the account out everywhere, as reset-password does.
      await prisma.$transaction([
        prisma.user.update({where: {id: user.id}, data: {...ADMIN, passwordHash: await hashPassword(password)}}),
        prisma.session.deleteMany({where: {userId: user.id}}),
      ]);
      console.log(`${username} is now an admin, with the new password.`);
    }
  }
} finally {
  await prisma.$disconnect();
}
